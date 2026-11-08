import { expect, test as base } from '@playwright/test';
import { backupData } from './fixtures/backupData';
import { buildProductionUpdates, startProductionUpdateSite, type ProductionUpdateSite } from './fixtures/productionUpdateSite';
import { monitorBrowser, tabButton } from './support';

const test = base.extend<{ site: ProductionUpdateSite }, { artifacts: Awaited<ReturnType<typeof buildProductionUpdates>> }>({
  artifacts: [async ({ browserName }, provide) => { await provide(await buildProductionUpdates(browserName)); }, { scope: 'worker', timeout: 120_000 }],
  site: async ({ artifacts }, provide) => {
    const site = await startProductionUpdateSite(artifacts);
    try { await provide(site); } finally { await site.close(); }
  },
});

test('Production v4 完整資料遷移、切換新夥伴與重載保留', async ({ page, site }) => {
  const clean = monitorBrowser(page);
  const { petKind, ...preferences } = backupData.preferences;
  expect(petKind).toBe('moon_cat');
  const instant = '2026-09-30T04:00:00.000Z';
  const legacy = { schemaVersion: 4, revision: 7, updatedAt: instant, data: { ...backupData, preferences } };
  await page.goto(`${site.origin}/setup.html`);
  await page.evaluate(({ legacy, version }) => {
    localStorage.setItem('daypop.user-data', JSON.stringify(legacy));
    localStorage.setItem('daypop.release-notes-seen', version);
  }, { legacy, version: site.currentVersion });
  await page.goto(`${site.origin}/DayPop/`);
  console.log('DP-239 production actual timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('daypop.user-data')!));
  await expect.poll(saved).toEqual({ schemaVersion: 5, revision: 7, updatedAt: instant, data: backupData });
  await tabButton(page, '設定').click();
  await page.getByRole('radio', { name: '蜂蜜熊', exact: true }).check();
  await expect.poll(async () => (await saved()).data.preferences.petKind).toBe('honey_bear');
  await page.getByRole('button', { name: '顯示桌寵', exact: true }).click();
  await expect.poll(async () => (await saved()).data.preferences.petEnabled).toBe(true);
  expect((await saved()).data).toEqual({ ...backupData, preferences: { ...backupData.preferences, petKind: 'honey_bear', petEnabled: true } });
  await tabButton(page, '日曆').click();
  await expect(page.locator('button.cal-pet img')).toBeVisible();
  await expect(page.locator('button.cal-pet img')).toHaveAttribute('src', /honey-bear-idle.*webp/);
  const bytes = await page.evaluate(() => localStorage.getItem('daypop.user-data'));
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
  await page.reload();
  await expect(page.locator('button.cal-pet img')).toBeVisible();
  await expect(page.locator('button.cal-pet img')).toHaveAttribute('src', /honey-bear-idle.*webp/);
  expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(bytes);
  clean();
});
