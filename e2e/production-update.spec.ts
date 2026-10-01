import { expect, test as base, type Page } from '@playwright/test';
import { backupData } from './fixtures/backupData';
import { buildProductionUpdates, startProductionUpdateSite, type ProductionUpdateSite } from './fixtures/productionUpdateSite';
import { agendaRow, calendarViewButton, monitorBrowser, tabButton } from './support';

const test = base.extend<{ site: ProductionUpdateSite; browserHealth: void }, {
  artifacts: Awaited<ReturnType<typeof buildProductionUpdates>>;
}>({
  artifacts: [async ({ browserName }, run) => { await run(await buildProductionUpdates(browserName)); }, { scope: 'worker', timeout: 120_000 }],
  site: async ({ artifacts }, run) => {
    const site = await startProductionUpdateSite(artifacts);
    try { await run(site); } finally { await site.close(); }
  },
  browserHealth: [async ({ page, site }, use) => {
    const clean = monitorBrowser(page);
    const externalRequests: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== site.origin) externalRequests.push(request.url());
    });
    await use();
    expect(externalRequests, 'guest production build must not contact a real service').toEqual([]);
    clean();
  }, { auto: true }],
});

const guestKey = 'daypop.user-data';
const seenKey = 'daypop.release-notes-seen';
const guestBytes = JSON.stringify({
  schemaVersion: 4, revision: 7, updatedAt: '2026-09-30T04:00:00.000Z', data: backupData,
});

async function assertGuestPreserved(page: Page) {
  expect(await page.evaluate((key) => localStorage.getItem(key), guestKey)).toBe(guestBytes);
  await tabButton(page, '設定').click();
  await expect(page.getByLabel('寵物名字')).toHaveValue('備份夥伴');
  await expect(page.getByRole('button', { name: /暖陽/ })).toHaveAttribute('aria-pressed', 'true');
  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, '備份晨會')).toHaveCount(1);
  await expect(agendaRow(page, '備份改期晨會')).toHaveCount(1);
  await expect(agendaRow(page, '備份夜班')).toHaveCount(2);
}

test.beforeEach(async ({ page, site }) => {
  await page.clock.setFixedTime(new Date('2026-09-30T04:00:00.000Z'));
  // Seed once on a blank page. An init script would reseed after the automatic
  // reload and conceal data loss or failure to acknowledge the next release.
  await page.goto(`${site.origin}/setup.html`);
  await page.evaluate(({ guestKey, guestBytes, seenKey, version }) => {
    localStorage.setItem(guestKey, guestBytes);
    localStorage.setItem(seenKey, version);
  }, { guestKey, guestBytes, seenKey, version: site.currentVersion });
  await page.goto(`${site.origin}/DayPop/`);
  await expect(page.locator('.dp-viewport')).toBeVisible();
  console.log('Production update browser timezone:', await page.evaluate(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  ));
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
  await expect.poll(() => site.versionRequests.length).toBeGreaterThan(0);
  await assertGuestPreserved(page);
  await tabButton(page, '設定').click();
  await expect(page.getByText(`目前版本 v${site.currentVersion}。`, { exact: false })).toBeVisible();
});

async function assertUpdated(page: Page, site: ProductionUpdateSite) {
  // The App must navigate itself after controllerchange. No page.reload here.
  await expect.poll(() => site.navigations.filter((version) => version === site.nextVersion).length).toBe(1);
  await expect(page.locator('.dp-viewport')).toBeVisible();
  await assertGuestPreserved(page);
  await tabButton(page, '設定').click();
  await expect(page.getByText(`目前版本 v${site.nextVersion}。`, { exact: false })).toBeVisible();
  await expect.poll(() => site.versionRequests.at(-1)).toBe(site.nextVersion);
  expect(await page.evaluate((key) => localStorage.getItem(key), seenKey)).toBe(site.nextVersion);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter(
    (key) => key.startsWith('daypop-app-shell-'),
  ))).toEqual([`daypop-app-shell-${site.nextVersion}`]);
  await page.getByRole('button', { name: '檢查更新', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '目前已是最新版本', exact: true })).toBeVisible();
}

test('Production 稍後提醒、重新檢查與立即更新，自動載入新版且保留遊客資料', async ({ page, site }) => {
  site.promote();
  await page.getByRole('button', { name: '檢查更新', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Production 更新回歸', exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
  await dialog.getByRole('button', { name: '稍後提醒', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(site.navigations).toEqual([site.currentVersion]);
  expect(await page.evaluate((key) => localStorage.getItem(key), seenKey)).toBe(site.currentVersion);
  expect(await page.evaluate((key) => localStorage.getItem(key), guestKey)).toBe(guestBytes);
  await page.getByRole('button', { name: '檢查更新', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '立即更新', exact: true }).click();
  await assertUpdated(page, site);
});

test('Production 安裝尚未完成時按立即更新，等待 worker 就緒後才自動重新載入', async ({ page, site }) => {
  site.promote(true);
  await page.getByRole('button', { name: '檢查更新', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Production 更新回歸', exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => site.blockedInstallRequests).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.installing?.state)).toBe('installing');
  await dialog.getByRole('button', { name: '立即更新', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '準備更新…', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '稍後提醒', exact: true })).toBeDisabled();
  expect(site.navigations).toEqual([site.currentVersion]);
  expect(await page.evaluate((key) => localStorage.getItem(key), guestKey)).toBe(guestBytes);
  site.releaseInstall();
  await assertUpdated(page, site);
});
