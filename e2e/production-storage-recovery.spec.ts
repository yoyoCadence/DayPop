import { readFile } from 'node:fs/promises';
import { expect, test as base } from '@playwright/test';
import type { DayPopBackup } from '../src/domain/dataTransfer';
import { backupData } from './fixtures/backupData';
import { buildProductionUpdates, startProductionUpdateSite, type ProductionUpdateSite } from './fixtures/productionUpdateSite';
import { fillLocalStorageQuota } from './fixtures/storageQuota';
import { monitorBrowser, tabButton } from './support';

const test = base.extend<{ site: ProductionUpdateSite }, {
  artifacts: Awaited<ReturnType<typeof buildProductionUpdates>>;
}>({
  artifacts: [async ({ browserName }, provide) => { await provide(await buildProductionUpdates(browserName)); }, { scope: 'worker', timeout: 120_000 }],
  site: async ({ artifacts }, provide) => {
    const site = await startProductionUpdateSite(artifacts);
    try { await provide(site); } finally { await site.close(); }
  },
});

const dataKey = 'daypop.user-data';
const backupPrefix = `${dataKey}.backup.`;
const fixedInstant = '2026-10-02T04:00:00.000Z';
const scenarios = [
  {
    name: '截斷 JSON',
    raw: ' {"schemaVersion":4,"data":{"notes":"未備份的中文 🌱"}\n',
    heading: '這台裝置上的 DayPop 資料讀不出來',
  },
  {
    name: '較新 schema',
    raw: JSON.stringify({ schemaVersion: 99, revision: 7, updatedAt: fixedInstant, data: backupData }, null, 2) + '\n',
    heading: '這份資料來自較新版本的 DayPop',
  },
];

for (const scenario of scenarios) {
  test(`Production ${scenario.name} 不以舊備份開放重設，下載目前原始內容後可安全復原及 reload`, async ({ page, context, site }) => {
    const assertCleanBrowser = monitorBrowser(page);
    const unexpectedRequests: string[] = [];
    context.on('request', (request) => {
      if (new URL(request.url()).origin !== site.origin) unexpectedRequests.push(request.url());
    });
    page.on('requestfailed', (request) => unexpectedRequests.push(`failed: ${request.url()}`));
    await page.clock.setFixedTime(new Date(fixedInstant));
    const sentinels = {
      [`${backupPrefix}2026-10-01T00:00:00.000Z`]: 'unrelated older backup',
      'calpet.v2': '{"legacy":"keep original bytes"}',
      CALPET_FIRED: '["legacy-reminder"]',
      'daypop.account-cache.recovery-test': '{"account":"synthetic untouched cache"}',
      'another.app.setting': 'unrelated site data',
      'daypop.release-notes-seen': site.currentVersion,
    };
    // Only seed this blank page. Reload must read the actual durable bytes.
    await page.goto(`${site.origin}/setup.html`);
    await page.evaluate(({ dataKey, raw, sentinels }) => {
      localStorage.setItem(dataKey, raw);
      for (const [key, value] of Object.entries(sentinels)) localStorage.setItem(key, value);
    }, { dataKey, raw: scenario.raw, sentinels });
    await page.goto(`${site.origin}/DayPop/`);
    const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    console.log('Production recovery browser timezone:', zone);
    expect(zone).toBe('Asia/Taipei');
    const reset = page.getByRole('button', { name: '重設本機資料', exact: true });
    await expect(page.getByRole('heading', { name: '資料需要處理', exact: true })).toBeVisible();
    await expect(page.getByText(scenario.heading, { exact: true })).toBeVisible();
    await expect(reset).toBeDisabled();
    await expect(page.getByRole('navigation', { name: '主導覽' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '新增行程', exact: true })).toHaveCount(0);
    if (scenario.name === '較新 schema') await expect(page.getByText('先更新 App', { exact: true })).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), dataKey)).toBe(scenario.raw);
    await page.reload();
    await expect(reset).toBeDisabled();
    expect(await page.evaluate((key) => localStorage.getItem(key), dataKey)).toBe(scenario.raw);

    const downloadReady = page.waitForEvent('download');
    await page.getByRole('button', { name: '備份並下載原始資料', exact: true }).click();
    const download = await downloadReady;
    expect(download.suggestedFilename()).toMatch(/^daypop\.user-data\.backup\..+\.json$/);
    expect(await download.failure()).toBeNull();
    expect(await readFile((await download.path())!, 'utf8')).toBe(scenario.raw);
    const backupKey = `${backupPrefix}${fixedInstant}`;
    expect(await page.evaluate((key) => localStorage.getItem(key), backupKey)).toBe(scenario.raw);
    expect(await page.evaluate((key) => localStorage.getItem(key), dataKey)).toBe(scenario.raw);
    await expect(reset).toBeEnabled();

    // A later unrelated backup must not hide the matching one on remount.
    const laterKey = `${backupPrefix}2026-10-03T00:00:00.000Z`;
    await page.evaluate((key) => localStorage.setItem(key, 'later unrelated backup'), laterKey);
    await page.reload();
    await expect(reset).toBeEnabled();
    await expect(page.locator('.recovery-ok')).toContainText(backupKey);
    await reset.click();
    await expect(page.getByRole('heading', { name: '資料需要處理', exact: true })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: '主導覽' })).toBeVisible();
    const resetBytes = await page.evaluate((key) => localStorage.getItem(key), dataKey);
    const envelope = JSON.parse(resetBytes!);
    expect(envelope).toMatchObject({
      schemaVersion: 4, revision: 1, updatedAt: fixedInstant,
      data: { events: [], eventExceptions: [], eventAttachments: [], todos: [], stickers: [],
        preferences: { themeId: 'manga', petName: '摩卡', timezone: 'Asia/Taipei' } },
    });
    expect(envelope.data.calendars).toHaveLength(1);
    expect(envelope.data.calendars[0]).toMatchObject({ isDefault: true, isVisible: true });
    await tabButton(page, '設定').click();
    await expect(page.getByLabel('寵物名字')).toHaveValue('摩卡');
    await expect(page.getByRole('button', { name: /漫畫/ })).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByRole('navigation', { name: '主導覽' })).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), dataKey)).toBe(resetBytes);
    const protectedEntries = { ...sentinels, [backupKey]: scenario.raw, [laterKey]: 'later unrelated backup' };
    expect(await page.evaluate((keys) => Object.fromEntries(keys.map(
      (key) => [key, localStorage.getItem(key)],
    )), Object.keys(protectedEntries))).toEqual(protectedEntries);
    assertCleanBrowser();
    expect(unexpectedRequests).toEqual([]);
  });

  test(`Production ${scenario.name} 備份遇 quota 後只在記憶體復原，reload 保留原始 blocked 資料`, async ({ page, context, site }) => {
    const assertCleanBrowser = monitorBrowser(page);
    const unexpectedRequests: string[] = [];
    context.on('request', (request) => {
      if (new URL(request.url()).origin !== site.origin) unexpectedRequests.push(request.url());
    });
    page.on('requestfailed', (request) => unexpectedRequests.push(`failed: ${request.url()}`));
    await page.clock.setFixedTime(new Date(fixedInstant));
    // More than the smallest filler chunk: even a corrupt document's backup
    // must genuinely exceed the remaining quota. Keep its raw whitespace.
    const raw = scenario.raw + '\n' + ' '.repeat(2048);
    const protectedEntries = {
      [dataKey]: raw,
      [`${backupPrefix}2026-10-01T00:00:00.000Z`]: 'unrelated older backup',
      'calpet.v2': '{"legacy":"keep original bytes"}',
      CALPET_FIRED: '["legacy-reminder"]',
      'daypop.account-cache.memory-recovery-test': '{"account":"synthetic untouched cache"}',
      'another.app.setting': 'unrelated site data',
      'daypop.release-notes-seen': site.currentVersion,
    };
    await page.goto(`${site.origin}/setup.html`);
    await page.evaluate((entries) => {
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    }, protectedEntries);
    await page.goto(`${site.origin}/DayPop/`);
    const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    console.log('Production memory recovery browser timezone:', zone);
    expect(zone).toBe('Asia/Taipei');
    const reset = page.getByRole('button', { name: '重設本機資料', exact: true });
    const heading = page.getByRole('heading', { name: '資料需要處理', exact: true });
    const warning = page.locator('.dp-storage-warning');
    await expect(heading).toBeVisible();
    await expect(page.getByText(scenario.heading, { exact: true })).toBeVisible();
    await expect(reset).toBeDisabled();
    await expect(warning).toHaveCount(0);
    const quota = await fillLocalStorageQuota(page);
    expect(quota.keys.length).toBeGreaterThan(0);
    expect(quota.failures).toEqual(Array(3).fill({ name: 'QuotaExceededError', native: true }));
    console.log('Production memory recovery native quota:', { characters: quota.characters, failures: quota.failures });
    await expect(reset).toBeDisabled();
    await expect(warning).toHaveCount(0);

    const downloadReady = page.waitForEvent('download');
    await page.getByRole('button', { name: '備份並下載原始資料', exact: true }).click();
    const download = await downloadReady;
    const backupKey = `${backupPrefix}${fixedInstant}`;
    // Chromium sanitizes the ISO timestamp's colons on Windows.
    expect(download.suggestedFilename().replaceAll('_', ':')).toBe(`${backupKey}.json`);
    expect(await download.failure()).toBeNull();
    expect(await readFile((await download.path())!, 'utf8')).toBe(raw);
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('儲存空間已經滿了');
    await expect(warning).toContainText('這次的變更不會被保存');
    await expect(page.locator('.recovery-ok')).toContainText(`${backupKey}.json`);
    await expect(page.locator('.recovery-ok')).toContainText('請務必確認這個檔案已經存到裝置上，它是唯一的備份');
    await expect(page.locator('.recovery-ok')).not.toContainText('已複製到這台裝置');
    expect(await page.evaluate((key) => localStorage.getItem(key), backupKey)).toBeNull();
    expect(await page.evaluate((keys) => Object.fromEntries(keys.map(
      (key) => [key, localStorage.getItem(key)],
    )), Object.keys(protectedEntries))).toEqual(protectedEntries);
    await expect(page.getByRole('navigation', { name: '主導覽' })).toHaveCount(0);
    await expect(reset).toBeEnabled();
    await reset.click();
    await expect(heading).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: '主導覽' })).toBeVisible();
    for (const tab of ['日曆', '搜尋', '綜覽', '設定'] as const) {
      await tabButton(page, tab).click();
      await expect(warning).toBeVisible();
      await expect(warning).toHaveAttribute('role', 'status');
      await expect(warning.getByRole('button')).toHaveCount(0);
    }
    await expect(page.getByLabel('寵物名字')).toHaveValue('摩卡');
    await expect(page.getByRole('button', { name: /漫畫/ })).toHaveAttribute('aria-pressed', 'true');

    // Recovering in memory must never overwrite the blocked durable document,
    // even after native quota is released and further edits succeed.
    await page.evaluate((keys) => {
      for (const key of keys) localStorage.removeItem(key);
      localStorage.setItem('quota-test.available', 'native writes work again');
      if (localStorage.getItem('quota-test.available') !== 'native writes work again') throw new Error('quota was not released');
      localStorage.removeItem('quota-test.available');
    }, quota.keys);
    await page.getByLabel('寵物名字').fill('只在記憶體復原');
    await page.getByLabel('寵物名字').blur();
    const memoryDownloadReady = page.waitForEvent('download');
    await page.getByRole('button', { name: '⬇ 匯出資料', exact: true }).click();
    const memoryDownload = await memoryDownloadReady;
    expect(await memoryDownload.failure()).toBeNull();
    const backup = JSON.parse(await readFile((await memoryDownload.path())!, 'utf8')) as DayPopBackup;
    expect(backup).toMatchObject({
      format: 'daypop.backup', formatVersion: 1, exportedAt: fixedInstant, appVersion: site.currentVersion,
      omitted: { eventAttachments: 0 },
      data: { events: [], eventExceptions: [], todos: [], stickers: [],
        preferences: { themeId: 'manga', petName: '只在記憶體復原', timezone: 'Asia/Taipei' } },
    });
    expect(backup.data.calendars).toHaveLength(1);
    expect(backup.data.calendars[0]).toMatchObject({ isDefault: true, isVisible: true });
    await expect(warning).toBeVisible();
    expect(await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(
      (key) => [key, localStorage.getItem(key)],
    )))).toEqual(protectedEntries);

    await page.reload();
    await expect(heading).toBeVisible();
    await expect(page.getByText(scenario.heading, { exact: true })).toBeVisible();
    await expect(reset).toBeDisabled();
    await expect(warning).toHaveCount(0);
    await expect(page.locator('.recovery-ok')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: '主導覽' })).toHaveCount(0);
    expect(await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(
      (key) => [key, localStorage.getItem(key)],
    )))).toEqual(protectedEntries);
    assertCleanBrowser();
    expect(unexpectedRequests).toEqual([]);
  });
}
