import { readFile } from 'node:fs/promises';
import { expect, test as base, type Page } from '@playwright/test';
import type { DayPopBackup } from '../src/domain/dataTransfer';
import { backupData } from './fixtures/backupData';
import { buildProductionUpdates, startProductionUpdateSite, type ProductionUpdateSite } from './fixtures/productionUpdateSite';
import { fillLocalStorageQuota } from './fixtures/storageQuota';
import { agendaRow, calendarViewButton, monitorBrowser, tabButton } from './support';

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
const fixedInstant = '2026-09-30T04:00:00.000Z';
const guestBytes = JSON.stringify({ schemaVersion: 4, revision: 7, updatedAt: fixedInstant, data: backupData });
const memoryTitle = '額度不足假期';
// Grow the existing envelope beyond the final filler chunk's remaining space.
const memoryNotes = '只留在記憶體的備註 '.repeat(256).trim();

async function assertGuestUi(page: Page) {
  await tabButton(page, '設定').click();
  await expect(page.getByLabel('寵物名字')).toHaveValue('備份夥伴');
  await expect(page.getByRole('button', { name: /暖陽/ })).toHaveAttribute('aria-pressed', 'true');
  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, '備份晨會')).toHaveCount(1);
  await expect(agendaRow(page, '備份改期晨會')).toHaveCount(1);
  await expect(agendaRow(page, '備份夜班')).toHaveCount(2);
  await expect(agendaRow(page, '備份假期')).toHaveCount(1);
}

async function downloadBackup(page: Page): Promise<DayPopBackup> {
  const ready = page.waitForEvent('download');
  await page.getByRole('button', { name: '⬇ 匯出資料', exact: true }).click();
  const download = await ready;
  expect(await download.failure()).toBeNull();
  return JSON.parse(await readFile((await download.path())!, 'utf8'));
}

test('Production quota 中途降級保留分頁修改，釋放空間不補寫，reload 讀回原始資料', async ({ page, context, site }) => {
  const assertCleanBrowser = monitorBrowser(page);
  const unexpectedRequests: string[] = [];
  context.on('request', (request) => {
    if (new URL(request.url()).origin !== site.origin) unexpectedRequests.push(request.url());
  });
  page.on('requestfailed', (request) => unexpectedRequests.push(`failed: ${request.url()}`));
  await page.clock.setFixedTime(new Date(fixedInstant));
  const protectedEntries = {
    [dataKey]: guestBytes,
    [`${dataKey}.backup.2026-09-29T00:00:00.000Z`]: 'synthetic original backup',
    'calpet.v2': '{"legacy":"keep original bytes"}',
    CALPET_FIRED: '["legacy-reminder"]',
    'daypop.account-cache.quota-test': '{"account":"synthetic untouched cache"}',
    'another.app.setting': 'unrelated site data',
    'daypop.release-notes-seen': site.currentVersion,
  };
  // Seed once before startup. Reload must read actual durable bytes.
  await page.goto(`${site.origin}/setup.html`);
  await page.evaluate((entries) => {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, protectedEntries);
  await page.goto(`${site.origin}/DayPop/`);
  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  console.log('Production quota browser timezone:', zone);
  expect(zone).toBe('Asia/Taipei');
  await assertGuestUi(page);
  const warning = page.locator('.dp-storage-warning');
  await expect(warning).toHaveCount(0);

  // Native Chromium quota, not a replaced Storage method. Only unrelated test
  // keys are filled, so DayPop's owned-key memory copy stays small.
  const quota = await fillLocalStorageQuota(page);
  expect(quota.keys.length).toBeGreaterThan(0);
  expect(quota.failures).toEqual(Array(3).fill({ name: 'QuotaExceededError', native: true }));
  console.log('Production quota native evidence:', { characters: quota.characters, failures: quota.failures });
  await expect(warning).toHaveCount(0);

  await agendaRow(page, '備份假期').click();
  const eventDialog = page.getByRole('dialog', { name: '編輯行程' });
  await eventDialog.getByLabel('標題').fill(memoryTitle);
  await eventDialog.getByLabel('備註').fill(memoryNotes);
  await eventDialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(agendaRow(page, memoryTitle)).toHaveCount(1);
  for (const tab of ['日曆', '搜尋', '綜覽', '設定'] as const) {
    await tabButton(page, tab).click();
    await expect(warning).toBeVisible();
    await expect(warning).toHaveAttribute('role', 'status');
    await expect(warning).toContainText('這次的變更不會被保存');
    await expect(warning).toContainText('儲存空間已經滿了');
    await expect(warning).toContainText('目前的內容只留在這個分頁');
    await expect(warning.getByRole('button')).toHaveCount(0);
  }
  const { eventAttachments, ...portableData } = backupData;
  const editedData = {
    ...portableData,
    events: backupData.events.map((event) => event.title === '備份假期'
      ? { ...event, title: memoryTitle, notes: memoryNotes, updatedAt: fixedInstant } : event),
  };
  const firstBackup = await downloadBackup(page);
  expect(firstBackup.data).toEqual(editedData);
  expect(firstBackup.omitted).toEqual({ eventAttachments: eventAttachments.length });
  expect(await page.evaluate((keys) => Object.fromEntries(keys.map(
    (key) => [key, localStorage.getItem(key)],
  )), Object.keys(protectedEntries))).toEqual(protectedEntries);

  // Free only our fillers and prove native writes work again. The current
  // session must still stay in memory and never retry its earlier edits.
  await page.evaluate((keys) => {
    for (const key of keys) localStorage.removeItem(key);
    localStorage.setItem('quota-test.available', 'storage accepts writes again');
    if (localStorage.getItem('quota-test.available') !== 'storage accepts writes again') throw new Error('quota was not released');
    localStorage.removeItem('quota-test.available');
  }, quota.keys);
  await page.getByLabel('寵物名字').fill('釋放空間後的夥伴');
  await page.getByLabel('寵物名字').blur();
  const secondBackup = await downloadBackup(page);
  expect(secondBackup.data).toEqual({
    ...editedData, preferences: { ...backupData.preferences, petName: '釋放空間後的夥伴' },
  });
  await expect(warning).toBeVisible();
  expect(await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(
    (key) => [key, localStorage.getItem(key)],
  )))).toEqual(protectedEntries);

  await page.reload();
  await expect(warning).toHaveCount(0);
  await assertGuestUi(page);
  await expect(agendaRow(page, memoryTitle)).toHaveCount(0);
  expect(await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(
    (key) => [key, localStorage.getItem(key)],
  )))).toEqual(protectedEntries);
  assertCleanBrowser();
  expect(unexpectedRequests).toEqual([]);
});
