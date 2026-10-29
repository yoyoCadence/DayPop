import { expect, test as base, type Page } from '@playwright/test';
import { backupData } from './fixtures/backupData';
import { createEmptyUserData } from '../src/domain/types';
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

test('漫畫素材尚未快取時離線切換，仍能儲存行程並重新載入', async ({ page, context, site }) => {
  await page.clock.setFixedTime(new Date(fixedInstant));
  const data = createEmptyUserData({ now: fixedInstant });
  data.preferences.themeId = 'minimal';
  data.preferences.petEnabled = false;
  const art = [...site.builds.get(site.currentVersion)!.keys()].filter(path =>
    /^\/assets\/(?:desk(?:-dark)?|header|navigation|page-edges)-.*\.webp$/.test(path),
  ).map(path => `${site.origin}/DayPop${path}`);
  expect(art).toHaveLength(5); // Small paper is inlined into the cached CSS.
  const versionUrl = `${site.origin}/DayPop/version.json`;
  // A previously unused theme's heading font can also be uncached. Native
  // font fallback is expected; do not hide other fonts or arbitrary failures.
  const headingFonts = [...site.builds.get(site.currentVersion)!.keys()].filter(path =>
    /^\/assets\/bangers-latin-400-normal-.*\.woff2?$/.test(path),
  ).map(path => `${site.origin}/DayPop${path}`);
  expect(headingFonts).toHaveLength(2);
  const expectedFailures = [...art, ...headingFonts, versionUrl, `${versionUrl}?ts=${Date.parse(fixedInstant)}`];
  const problems: string[] = [], failed: string[] = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => {
    if (!['error', 'warning'].includes(message.type())) return;
    if (message.type() === 'error' && expectedFailures.includes(message.location().url) && message.text().startsWith('Failed to load resource:')) return;
    problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('requestfailed', request => {
    if (expectedFailures.includes(request.url())) failed.push(request.url());
    else problems.push(`requestfailed: ${request.url()}`);
  });
  await page.goto(`${site.origin}/setup.html`);
  await page.evaluate(({ data, version, now }) => {
    localStorage.setItem('daypop.release-notes-seen', version);
    localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 4, revision: 0, updatedAt: now, data }));
  }, { data, version: site.currentVersion, now: fixedInstant });
  await page.goto(`${site.origin}/DayPop/`);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
  await page.reload();
  const cachedArt = await page.evaluate(async urls =>
    Promise.all(urls.map(async url => Boolean(await caches.match(url)))), art);
  expect(cachedArt).toEqual(art.map(() => false));
  await context.setOffline(true);
  await tabButton(page, '設定').click();
  await page.locator('.dp-theme-card', { hasText: '漫畫' }).click();
  await tabButton(page, '日曆').click();
  await expect(page.locator('.dp-preview')).toHaveAttribute('data-theme', 'manga');
  await expect.poll(() => failed.some(url => art.includes(url))).toBe(true);
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增行程' });
  await dialog.getByLabel('標題', { exact: true }).fill('首次離線缺圖仍可使用');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await page.evaluate(key => localStorage.getItem(key), guestKey);
  await page.reload();
  await calendarViewButton(page, '列表').click();
  await expect(page.locator('.cal-agenda-item')).toContainText('首次離線缺圖仍可使用');
  expect(await page.evaluate(key => localStorage.getItem(key), guestKey)).toBe(saved);
  console.log('DP-218 production offline timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  expect(problems).toEqual([]);
});

test('首次離線完成待辦缺 jump 圖片仍保存完成，回快取 idle 並在 reload 後不補播', async ({ page, context, site }) => {
  const now = '2026-10-25T04:00:00.000Z';
  const data = createEmptyUserData({ now });
  data.preferences.timezone = 'Asia/Taipei';
  data.todos = [{ id: '19700000-0000-4000-8000-000000000001', calendarId: data.calendars[0]!.id, parentId: null,
    title: '離線完成回饋', dueDate: '2026-10-25', priority: 'none', sortOrder: 0, sharingScope: 'inherit', completedAt: null, createdAt: now, updatedAt: now }];
  const problems: string[] = [], failed: string[] = [];
  const path = [...site.builds.get(site.currentVersion)!.keys()].find(path => /^\/assets\/moon-cat-jump-.*\.webp$/.test(path));
  expect(path).toBeTruthy();
  const jumpUrl = `${site.origin}/DayPop${path}`, versionUrl = `${site.origin}/DayPop/version.json`;
  const expectedFailures = [jumpUrl, versionUrl, `${versionUrl}?ts=${Date.parse(now)}`];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => {
    if (!['error', 'warning'].includes(message.type())) return;
    if (message.type() === 'error' && expectedFailures.includes(message.location().url) && message.text().startsWith('Failed to load resource:')) return;
    problems.push(`${message.type()}: ${message.text()} (${message.location().url})`);
  });
  page.on('requestfailed', request => {
    if (expectedFailures.includes(request.url())) failed.push(request.url());
    else problems.push(`requestfailed: ${request.url()}`);
  });
  await page.clock.setFixedTime(new Date(now));
  await page.goto(`${site.origin}/setup.html`);
  await page.evaluate(({ data, now, version }) => {
    localStorage.setItem('daypop.release-notes-seen', version);
    localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 4, revision: 0, updatedAt: now, data }));
  }, { data, now, version: site.currentVersion });
  await page.goto(`${site.origin}/DayPop/`);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
  await page.reload();
  const pet = page.locator('button.cal-pet'), image = pet.locator('img');
  await expect(image).toBeVisible();
  const idleUrl = await image.evaluate(img => (img as HTMLImageElement).currentSrc);
  await expect.poll(() => page.evaluate(async url => Boolean(await caches.match(url)), idleUrl)).toBe(true);
  expect(await page.evaluate(async url => Boolean(await caches.match(url)), jumpUrl)).toBe(false);
  await calendarViewButton(page, '列表').click();
  await context.setOffline(true);
  const row = agendaRow(page, '離線完成回饋');
  await row.focus(); await row.press('Enter');
  await expect.poll(() => failed.includes(jumpUrl)).toBe(true);
  await expect(image).toHaveAttribute('src', /idle.*webp/); await expect(image).toBeVisible();
  await expect(row).toBeFocused();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), guestKey);
  expect(saved.data).toEqual({ ...data, todos: [{ ...data.todos[0], completedAt: now }] });
  expect(saved.revision).toBe(1);
  await page.reload();
  await expect(image).toHaveAttribute('src', /idle.*webp/); await expect(image).toBeVisible();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), guestKey)).toEqual(saved);
  expect(failed.filter(url => url === jumpUrl)).toHaveLength(1);
  expect(await page.evaluate(async url => Boolean(await caches.match(url)), jumpUrl)).toBe(false);
  console.log('DP-197 production offline timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  expect(problems).toEqual([]);
});

test('寵物只有實際使用的素材進 runtime cache；離線首次缺 PNG 回靜態 CSS', async ({ page, context, site }) => {
  const problems: string[] = [];
  const failed: string[] = [];
  const path = [...site.builds.get(site.currentVersion)!.keys()].find(path => /^\/assets\/moon-cat-idle-.*\.png$/.test(path));
  expect(path).toBeTruthy();
  const pngUrl = `${site.origin}/DayPop${path}`;
  const versionUrl = `${site.origin}/DayPop/version.json`;
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => {
    if (!['error', 'warning'].includes(message.type())) return;
    if (message.type() === 'error' && [pngUrl, versionUrl].includes(message.location().url) && message.text().startsWith('Failed to load resource:')) return;
    problems.push(`${message.type()}: ${message.text()} (${message.location().url})`);
  });
  page.on('requestfailed', request => {
    if ([pngUrl, versionUrl].includes(request.url())) failed.push(request.url());
    else problems.push(`requestfailed: ${request.url()}`);
  });
  await page.goto(`${site.origin}/setup.html`);
  await page.evaluate(({ key, version }) => localStorage.setItem(key, version), { key: seenKey, version: site.currentVersion });
  await page.goto(`${site.origin}/DayPop/`);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
  await page.reload();
  const pet = page.locator('button.cal-pet');
  await expect(pet.locator('img')).toBeVisible();
  const idleUrl = await pet.locator('img').evaluate(img => (img as HTMLImageElement).currentSrc);
  await expect.poll(() => page.evaluate(async url => Boolean(await caches.match(url)), idleUrl)).toBe(true);
  expect(await page.evaluate(async url => Boolean(await caches.match(url)), pngUrl)).toBe(false);
  const bytes = await page.evaluate(key => localStorage.getItem(key), guestKey);
  await context.setOffline(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(pet.locator('img')).toHaveCount(0);
  const eye = pet.locator('.cal-pet-eye.left');
  await expect(eye).toBeVisible();
  expect(await eye.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await expect.poll(() => failed.includes(pngUrl)).toBe(true);
  expect(await page.evaluate(key => localStorage.getItem(key), guestKey)).toBe(bytes);
  expect(problems).toEqual([]);
});

test('首次離線睡眠缺 WebP 回 CSS，輸入喚醒恢復已快取 idle，資料不變', async ({ page, context, site }) => {
  const problems: string[] = [];
  const failed: string[] = [];
  const path = [...site.builds.get(site.currentVersion)!.keys()].find(path => /^\/assets\/moon-cat-sleep-.*\.webp$/.test(path));
  expect(path).toBeTruthy();
  const sleepUrl = `${site.origin}/DayPop${path}`;
  const versionUrl = `${site.origin}/DayPop/version.json`;
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => {
    if (!['error', 'warning'].includes(message.type())) return;
    if (message.type() === 'error' && [sleepUrl, versionUrl].includes(message.location().url) && message.text().startsWith('Failed to load resource:')) return;
    problems.push(`${message.type()}: ${message.text()} (${message.location().url})`);
  });
  page.on('requestfailed', request => {
    if ([sleepUrl, versionUrl].includes(request.url())) failed.push(request.url());
    else problems.push(`requestfailed: ${request.url()}`);
  });
  await page.clock.install({ time: new Date('2026-10-24T04:00:00Z') });
  await page.goto(`${site.origin}/setup.html`);
  await page.evaluate(({ key, version }) => localStorage.setItem(key, version), { key: seenKey, version: site.currentVersion });
  await page.goto(`${site.origin}/DayPop/`);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
  await page.reload();
  const pet = page.locator('button.cal-pet');
  await expect(pet.locator('img')).toBeVisible();
  const idleUrl = await pet.locator('img').evaluate(img => (img as HTMLImageElement).currentSrc);
  await expect.poll(() => page.evaluate(async url => Boolean(await caches.match(url)), idleUrl)).toBe(true);
  expect(await page.evaluate(async url => Boolean(await caches.match(url)), sleepUrl)).toBe(false);
  const bytes = await page.evaluate(key => localStorage.getItem(key), guestKey);
  await context.setOffline(true);
  await page.clock.fastForward(120000);
  await expect.poll(() => failed.includes(sleepUrl)).toBe(true);
  await expect(pet.locator('img')).toHaveCount(0);
  await expect(pet.locator('.cal-pet-body')).toBeVisible();
  await page.keyboard.press('Shift');
  await expect(pet.locator('img')).toHaveAttribute('src', /idle.*webp/);
  await expect(pet.locator('img')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), guestKey)).toBe(bytes);
  console.log('DP-193 offline browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  expect(problems).toEqual([]);
});

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
