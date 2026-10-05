import { readFile } from 'node:fs/promises';
import { expect, test as base, type Page } from '@playwright/test';
import type { DayPopBackup } from '../src/domain/dataTransfer';
import { backupData } from './fixtures/backupData';
import { buildProductionUpdates, startProductionUpdateSite, type ProductionUpdateSite } from './fixtures/productionUpdateSite';
import { exhaustLocalStorageQuota, fillLocalStorageQuota } from './fixtures/storageQuota';
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
// The fixture's first occurrences fall on this day; the agenda lists from today.
const fixedInstant = '2026-09-30T04:00:00.000Z';
const guestBytes = JSON.stringify({ schemaVersion: 4, revision: 7, updatedAt: fixedInstant, data: backupData });
// Same length as the App's startup probe key (`daypop.storage-probe`), under a
// name the App does not own, so the check never looks like DayPop data.
const probeSizedKey = 'quota-test.probesize';
const memoryPetName = '開機額度已滿的夥伴';

async function assertGuestUi(page: Page) {
  await tabButton(page, '設定').click();
  await expect(page.getByLabel('寵物名字')).toHaveValue('備份夥伴');
  await expect(page.getByRole('button', { name: /暖陽/ })).toHaveAttribute('aria-pressed', 'true');
  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, '備份晨會')).toHaveCount(1);
  await expect(agendaRow(page, '備份改期晨會')).toHaveCount(1);
  await expect(agendaRow(page, '備份夜班')).toHaveCount(2);
  await expect(agendaRow(page, '備份假期')).toHaveCount(3);
}

async function downloadBackup(page: Page): Promise<DayPopBackup> {
  const ready = page.waitForEvent('download');
  await page.getByRole('button', { name: '⬇ 匯出資料', exact: true }).click();
  const download = await ready;
  expect(await download.failure()).toBeNull();
  return JSON.parse(await readFile((await download.path())!, 'utf8'));
}

/** Every key with its length, so megabytes of filler never cross the bridge. */
function storedLengths(page: Page) {
  return page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(
    (key) => [key, localStorage.getItem(key)!.length],
  )));
}

function storedValues(page: Page, keys: string[]) {
  return page.evaluate((wanted) => Object.fromEntries(wanted.map(
    (key) => [key, localStorage.getItem(key)],
  )), keys);
}

/** A native write the size of the App's startup probe, attempted and undone. */
function probeSizedWrite(page: Page) {
  return page.evaluate((key) => {
    try {
      localStorage.setItem(key, 'ok');
      localStorage.removeItem(key);
      return { accepted: true, name: null as string | null, native: false };
    } catch (error) {
      return { accepted: false, name: (error as Error).name, native: error instanceof DOMException };
    }
  }, probeSizedKey);
}

test('Production 開機時額度已滿：沿用仍可讀的資料並持續警告，匯出完整，磁碟不變，釋放後 reload 恢復保存', async ({ page, context, site }) => {
  const assertCleanBrowser = monitorBrowser(page);
  const unexpectedRequests: string[] = [];
  context.on('request', (request) => {
    if (new URL(request.url()).origin !== site.origin) unexpectedRequests.push(request.url());
  });
  page.on('requestfailed', (request) => unexpectedRequests.push(`failed: ${request.url()}`));
  await page.clock.setFixedTime(new Date(fixedInstant));
  expect(probeSizedKey).toHaveLength('daypop.storage-probe'.length);
  const protectedEntries = {
    [dataKey]: guestBytes,
    [`${dataKey}.backup.2026-09-29T00:00:00.000Z`]: 'synthetic original backup',
    'calpet.v2': '{"legacy":"keep original bytes"}',
    CALPET_FIRED: '["legacy-reminder"]',
    'daypop.account-cache.quota-test': '{"account":"synthetic untouched cache"}',
    'another.app.setting': 'unrelated site data',
    'daypop.release-notes-seen': site.currentVersion,
  };
  const protectedKeys = Object.keys(protectedEntries);

  // Seed once, then exhaust the origin's native quota BEFORE the App ever runs.
  // No Storage method is replaced and no init script re-seeds on reload.
  await page.goto(`${site.origin}/setup.html`);
  await page.evaluate((entries) => {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, protectedEntries);
  const quota = await fillLocalStorageQuota(page);
  const pad = await exhaustLocalStorageQuota(page);
  expect(quota.failures).toEqual(Array(3).fill({ name: 'QuotaExceededError', native: true }));
  expect(pad.failures).toEqual([64, 1].map((step) => ({ step, name: 'QuotaExceededError', native: true })));
  expect(await probeSizedWrite(page)).toEqual({ accepted: false, name: 'QuotaExceededError', native: true });
  const lengthsBeforeStartup = await storedLengths(page);
  console.log('Production startup quota native evidence:', {
    fillerCharacters: quota.characters, padCharacters: pad.characters, keys: Object.keys(lengthsBeforeStartup).length,
    probeSizedWrite: 'QuotaExceededError before App startup',
  });

  await page.goto(`${site.origin}/DayPop/`);
  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  console.log('Production startup quota browser timezone:', zone);
  expect(zone).toBe('Asia/Taipei');
  await expect(page.locator('.dp-viewport')).toBeVisible();

  // The App started under a quota it could not write to…
  const warning = page.locator('.dp-storage-warning');
  for (const tab of ['日曆', '搜尋', '綜覽', '設定'] as const) {
    await tabButton(page, tab).click();
    await expect(warning).toBeVisible();
    await expect(warning).toHaveAttribute('role', 'status');
    await expect(warning).toContainText('這次的變更不會被保存');
    await expect(warning).toContainText('這台裝置給 DayPop 的儲存空間已經滿了。');
    await expect(warning).toContainText('重新整理或關掉之後就會消失');
    await expect(warning.getByRole('button')).toHaveCount(0);
  }
  // …yet shows what is still readable on disk, including the "seen" marker, so
  // no release notice opens over data the user already had.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await assertGuestUi(page);

  // Export is the user's only way out of a full device: it must carry the data.
  const { eventAttachments, ...portableData } = backupData;
  await tabButton(page, '設定').click();
  const startupBackup = await downloadBackup(page);
  expect(startupBackup.data).toEqual(portableData);
  expect(startupBackup.omitted).toEqual({ eventAttachments: eventAttachments.length });

  await page.getByLabel('寵物名字').fill(memoryPetName);
  await page.getByLabel('寵物名字').blur();
  const editedBackup = await downloadBackup(page);
  expect(editedBackup.data).toEqual({
    ...portableData, preferences: { ...backupData.preferences, petName: memoryPetName },
  });
  await expect(warning).toBeVisible();

  // Nothing reached the disk: still full, same keys and sizes, no probe left.
  expect(await probeSizedWrite(page)).toEqual({ accepted: false, name: 'QuotaExceededError', native: true });
  expect(await storedLengths(page)).toEqual(lengthsBeforeStartup);
  expect(await storedValues(page, [...protectedKeys, 'daypop.storage-probe'])).toEqual({
    ...protectedEntries, 'daypop.storage-probe': null,
  });

  // Free only this test's filler. A new document probes again and persists.
  await page.evaluate((keys) => {
    for (const key of keys) localStorage.removeItem(key);
  }, [...quota.keys, pad.key]);
  expect(await probeSizedWrite(page)).toEqual({ accepted: true, name: null, native: false });
  await page.reload();
  await expect(page.locator('.dp-viewport')).toBeVisible();
  await assertGuestUi(page);
  await expect(warning).toHaveCount(0);
  await tabButton(page, '設定').click();
  await expect(page.getByLabel('寵物名字')).toHaveValue('備份夥伴');
  expect(await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(
    (key) => [key, localStorage.getItem(key)],
  )))).toEqual(protectedEntries);
  assertCleanBrowser();
  expect(unexpectedRequests).toEqual([]);
});
