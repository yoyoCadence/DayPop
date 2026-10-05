import { expect, test as base, type Page } from '@playwright/test';
import { backupData } from './fixtures/backupData';
import { buildProductionUpdates, startProductionUpdateSite, type ProductionUpdateSite } from './fixtures/productionUpdateSite';
import { agendaRow, calendarViewButton, monitorBrowser, tabButton } from './support';

const test = base.extend<{ site: ProductionUpdateSite }, {
  artifacts: Awaited<ReturnType<typeof buildProductionUpdates>>;
}>({
  artifacts: [async ({ browserName }, provide) => { await provide(await buildProductionUpdates(browserName)); }, { scope: 'worker', timeout: 120_000 }],
  site: async ({ artifacts, context }, provide) => {
    const site = await startProductionUpdateSite(artifacts);
    try { await provide(site); } finally { await context.setOffline(false); await site.close(); }
  },
});

const guestKey = 'daypop.user-data';
const seenKey = 'daypop.release-notes-seen';
const fixedInstant = '2026-09-30T04:00:00.000Z';
const guestBytes = JSON.stringify({ schemaVersion: 4, revision: 7, updatedAt: fixedInstant, data: backupData });

async function assertGuestUi(page: Page, petName: string, holiday: string) {
  await expect(page.locator('.dp-viewport')).toBeVisible();
  await tabButton(page, '設定').click();
  await expect(page.getByLabel('寵物名字')).toHaveValue(petName);
  await expect(page.getByRole('button', { name: /暖陽/ })).toHaveAttribute('aria-pressed', 'true');
  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, '備份晨會')).toHaveCount(1);
  await expect(agendaRow(page, '備份改期晨會')).toHaveCount(1);
  await expect(agendaRow(page, '備份夜班')).toHaveCount(2);
  await expect(agendaRow(page, holiday)).toHaveCount(3);
}

test('已快取 production 遊客 App 離線另開頁、編輯及 reload 保存，恢復連線可檢查更新', async ({ page, context, site }) => {
  const assertWarmPageClean = monitorBrowser(page);
  const externalRequests: string[] = [];
  context.on('request', (request) => {
    if (new URL(request.url()).origin !== site.origin) externalRequests.push(request.url());
  });
  await page.clock.setFixedTime(new Date(fixedInstant));
  // Seed only this setup page; a new page/reload must read the durable bytes.
  await page.goto(`${site.origin}/setup.html`);
  await page.evaluate(({ guestKey, guestBytes, seenKey, version }) => {
    localStorage.setItem(guestKey, guestBytes);
    localStorage.setItem(seenKey, version);
  }, { guestKey, guestBytes, seenKey, version: site.currentVersion });
  await page.goto(`${site.origin}/DayPop/`);
  await expect(page.locator('.dp-viewport')).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
  // The first navigation downloads JS before registration. Explicitly warm a
  // controlled online navigation; this case claims only already-cached assets.
  await page.reload();
  await assertGuestUi(page, '備份夥伴', '備份假期');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const index = site.builds.get(site.currentVersion)!.get('/index.html')!.toString();
  const bundles = [...index.matchAll(/(?:src|href)="([^"]+\/assets\/[^"?]+\.(?:js|css))"/g)].map((match) => match[1]);
  expect(bundles.some((path) => path.endsWith('.js'))).toBe(true);
  expect(bundles.some((path) => path.endsWith('.css'))).toBe(true);
  await expect.poll(() => page.evaluate(async ({ cacheName, bundles }) => {
    const cache = await caches.open(cacheName);
    return Promise.all(bundles.map(async (path) => Boolean(await cache.match(path))));
  }, { cacheName: `daypop-app-shell-${site.currentVersion}`, bundles })).toEqual(bundles.map(() => true));
  expect(await page.evaluate((key) => localStorage.getItem(key), guestKey)).toBe(guestBytes);
  await expect.poll(() => site.versionRequests.length).toBeGreaterThan(0);
  await page.close();
  assertWarmPageClean();

  const coldPage = await context.newPage();
  await coldPage.clock.setFixedTime(new Date(fixedInstant));
  // Playwright 1.62's navigator.onLine regression (#42174) also affects a new
  // document. Real failed version requests and unchanged server counters below
  // establish offline operation without faking the navigator flag.
  await context.setOffline(true);
  const problems: string[] = [];
  const offlineErrors: string[] = [];
  const failedVersions: string[] = [];
  const responsesFromWorker: string[] = [];
  let offline = true;
  const versionUrl = `${site.origin}/DayPop/version.json?ts=${new Date(fixedInstant).getTime()}`;
  coldPage.on('console', (message) => {
    if (message.type() !== 'warning' && message.type() !== 'error') return;
    if (offline && message.type() === 'error' &&
      message.text() === 'Failed to load resource: net::ERR_INTERNET_DISCONNECTED' &&
      message.location().url === versionUrl) {
      offlineErrors.push(message.location().url);
    } else {
      problems.push(`${message.type()}: ${message.text()} (${message.location().url})`);
    }
  });
  coldPage.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  coldPage.on('requestfailed', (request) => {
    if (offline && request.url() === versionUrl && request.failure()?.errorText === 'net::ERR_INTERNET_DISCONNECTED') {
      failedVersions.push(request.url());
    } else {
      problems.push(`requestfailed: ${request.url()} (${request.failure()?.errorText})`);
    }
  });
  coldPage.on('response', (response) => {
    if (response.fromServiceWorker()) responsesFromWorker.push(new URL(response.url()).pathname);
  });
  const navigationsBeforeOffline = site.navigations.length;
  const versionsBeforeOffline = site.versionRequests.length;
  try {
    const offlineUrl = `${site.origin}/DayPop/offline-return`;
    await coldPage.goto(offlineUrl);
    expect(coldPage.url()).toBe(offlineUrl);
    expect(await coldPage.title()).toBe('日蹦 DayPop');
    console.log('Production offline native navigator.onLine:', await coldPage.evaluate(() => navigator.onLine));
    const zone = await coldPage.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    console.log('Production offline browser timezone:', zone);
    expect(zone).toBe('Asia/Taipei');
    await assertGuestUi(coldPage, '備份夥伴', '備份假期');
    await expect.poll(() => failedVersions.length).toBe(1);
    expect(await coldPage.evaluate((key) => localStorage.getItem(key), guestKey)).toBe(guestBytes);
    expect(responsesFromWorker).toEqual(expect.arrayContaining(['/DayPop/offline-return', ...bundles]));

    await agendaRow(coldPage, '備份假期').first().click();
    const eventDialog = coldPage.getByRole('dialog', { name: '編輯行程' });
    await eventDialog.getByLabel('標題').fill('離線假期');
    await eventDialog.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(agendaRow(coldPage, '離線假期')).toHaveCount(3);
    await tabButton(coldPage, '設定').click();
    await coldPage.getByLabel('寵物名字').fill('離線夥伴');
    await coldPage.getByLabel('寵物名字').blur();
    const expectedEnvelope = {
      schemaVersion: 4, revision: 9, updatedAt: fixedInstant,
      data: {
        ...backupData,
        events: backupData.events.map((event) => event.title === '備份假期'
          ? { ...event, title: '離線假期', updatedAt: fixedInstant } : event),
        preferences: { ...backupData.preferences, petName: '離線夥伴' },
      },
    };
    await expect.poll(() => coldPage.evaluate((key) => JSON.parse(localStorage.getItem(key)!), guestKey)).toEqual(expectedEnvelope);
    const editedBytes = await coldPage.evaluate((key) => localStorage.getItem(key), guestKey);
    await coldPage.getByRole('button', { name: '檢查更新', exact: true }).click();
    const failedDialog = coldPage.getByRole('dialog', { name: '暫時無法檢查更新', exact: true });
    await expect(failedDialog).toBeVisible();
    await expect(failedDialog).toContainText('你的行程與設定不受影響');
    await failedDialog.getByRole('button', { name: '知道了', exact: true }).click();
    await coldPage.reload();
    await assertGuestUi(coldPage, '離線夥伴', '離線假期');
    expect(await coldPage.evaluate((key) => localStorage.getItem(key), guestKey)).toBe(editedBytes);
    expect(site.navigations).toHaveLength(navigationsBeforeOffline);
    expect(site.versionRequests).toHaveLength(versionsBeforeOffline);
    expect(offlineErrors).toEqual([versionUrl, versionUrl, versionUrl]);
    expect(failedVersions).toEqual(offlineErrors);

    await context.setOffline(false);
    offline = false;
    await tabButton(coldPage, '設定').click();
    await coldPage.getByRole('button', { name: '檢查更新', exact: true }).click();
    await expect(coldPage.getByRole('dialog', { name: '目前已是最新版本', exact: true })).toBeVisible();
    await expect.poll(() => site.versionRequests.length).toBeGreaterThan(versionsBeforeOffline);
    expect(await coldPage.evaluate((key) => localStorage.getItem(key), guestKey)).toBe(editedBytes);
    expect(await coldPage.evaluate((key) => localStorage.getItem(key), seenKey)).toBe(site.currentVersion);
    expect(problems, 'only the three intentional offline version requests may fail').toEqual([]);
    expect(externalRequests, 'guest production must not contact a real service').toEqual([]);
  } finally {
    await context.setOffline(false);
    await coldPage.close();
  }
});
