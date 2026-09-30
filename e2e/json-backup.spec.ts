import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { expect, test as base, type Page, type TestInfo } from '@playwright/test';
import type { DayPopBackup } from '../src/domain/dataTransfer';
import type { DayPopUserData } from '../src/domain/types';
import { backupData } from './fixtures/backupData';
import { agendaRow, calendarViewButton, monitorBrowser, openApp, reloadApp, tabButton } from './support';

const test = base.extend<{ browserHealth: void }>({
  browserHealth: [async ({ page }, use) => {
    const assertCleanBrowser = monitorBrowser(page);
    await use();
    assertCleanBrowser();
  }, { auto: true }],
});

const storageKey = 'daypop.user-data';
const portableData = {
  calendars: backupData.calendars,
  events: backupData.events,
  eventExceptions: backupData.eventExceptions,
  todos: backupData.todos,
  stickers: backupData.stickers,
  preferences: backupData.preferences,
};

async function storedBytes(page: Page) {
  const raw = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  expect(raw).not.toBeNull();
  return raw!;
}

async function storedEnvelope(page: Page): Promise<{ revision: number; data: DayPopUserData }> {
  return JSON.parse(await storedBytes(page));
}

async function downloadBackup(page: Page, testInfo: TestInfo) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '⬇ 匯出資料', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('daypop-backup-2026-09-30.json');
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  const text = await readFile(path, 'utf8');
  return { path, backup: JSON.parse(text) as DayPopBackup };
}

async function chooseBackup(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  const pending = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '⬆ 匯入資料', exact: true }).click();
  await (await pending).setFiles(file);
}

test.beforeEach(async ({ page }) => {
  // Pin the date as well as the configured browser timezone: the fixture must
  // remain visible in the real calendar when CI runs on a different day.
  await page.clock.setFixedTime(new Date('2026-09-30T04:00:00.000Z'));
  await openApp(page);
  console.log('JSON backup browser timezone:', await page.evaluate(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  ));
  // Seed once, never in an init script that could silently undo an import on reload.
  await page.evaluate(({ key, data }) => {
    const envelope = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...envelope, revision: 7, data }));
  }, { key: storageKey, data: backupData });
  await reloadApp(page);
  await tabButton(page, '設定').click();
  await expect(page.getByLabel('寵物名字')).toHaveValue('備份夥伴');
});

test('JSON 真實下載、取消預覽、確認取代與 reload 保留完整遊客資料', async ({ page }, testInfo) => {
  const sourceBytes = await storedBytes(page);
  const { path, backup } = await downloadBackup(page, testInfo);
  expect(backup.format).toBe('daypop.backup');
  expect(backup.formatVersion).toBe(1);
  expect(backup.omitted).toEqual({ eventAttachments: 0 });
  expect(backup.data).toEqual(portableData);
  expect(await storedBytes(page), 'export must not write user data').toBe(sourceBytes);

  // Make the live document different through the UI: a no-op import, append,
  // or an import that merely shows success must all fail the assertions below.
  await page.getByLabel('寵物名字').fill('備份後修改');
  await page.getByLabel('寵物名字').press('Tab');
  await expect.poll(async () => (await storedEnvelope(page)).data.preferences.petName).toBe('備份後修改');
  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '列表').click();
  await agendaRow(page, '備份夜班').first().click();
  await page.getByRole('dialog', { name: '編輯行程' }).getByRole('button', { name: '刪除事件', exact: true }).click();
  await expect(agendaRow(page, '備份夜班')).toHaveCount(0);
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const eventDialog = page.getByRole('dialog', { name: '新增行程' });
  await eventDialog.getByLabel('標題').fill('還原後應移除');
  await eventDialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(agendaRow(page, '還原後應移除')).toBeVisible();
  await tabButton(page, '設定').click();
  const changedBytes = await storedBytes(page);
  const changed = await storedEnvelope(page);
  expect(changed.data).not.toEqual(backupData);

  await chooseBackup(page, path);
  const preview = page.getByRole('dialog', { name: '匯入預覽' });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('共 4 筆行程');
  for (const count of ['日曆 2', '待辦 2', '貼圖 1', '例外 2']) {
    await expect(preview).toContainText(count);
  }
  await expect(preview).toContainText('將取代目前 11 筆可攜資料；確認前不會寫入。');
  await expect(preview.getByRole('button', { name: '取代資料', exact: true })).toBeFocused();
  expect(await storedBytes(page), 'preview must not write').toBe(changedBytes);
  await preview.getByRole('button', { name: '取消', exact: true }).click();
  await expect(preview).toBeHidden();
  expect(await storedBytes(page), 'cancel must not write').toBe(changedBytes);

  // Re-select before reloading, so this exercises the same file input. It must
  // have been reset after the first selection for change to fire again.
  await chooseBackup(page, path);
  await expect(preview).toBeVisible();
  await preview.press('Escape');
  await expect(preview).toBeHidden();
  expect(await storedBytes(page), 'Escape must not write').toBe(changedBytes);
  await reloadApp(page);
  expect(await storedBytes(page)).toBe(changedBytes);
  await tabButton(page, '設定').click();
  await expect(page.getByLabel('寵物名字')).toHaveValue('備份後修改');

  // Restore from the original downloaded file after verifying cancel persisted.
  await chooseBackup(page, path);
  await preview.getByRole('button', { name: '取代資料', exact: true }).click();
  await expect(preview).toBeHidden();
  await expect(page.getByRole('status')).toContainText('還原');
  await expect.poll(async () => (await storedEnvelope(page)).data).toEqual(backupData);
  expect((await storedEnvelope(page)).revision).toBe(changed.revision + 1);
  await reloadApp(page);
  expect((await storedEnvelope(page)).data).toEqual(backupData);

  // Read the restored document through the UI and exporter, not just storage.
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, '備份夜班').first()).toBeVisible();
  await expect(agendaRow(page, '還原後應移除')).toHaveCount(0);
  await tabButton(page, '設定').click();
  await expect(page.getByLabel('寵物名字')).toHaveValue('備份夥伴');
  const restored = await downloadBackup(page, testInfo);
  expect(restored.backup.data).toEqual(portableData);
});

for (const invalid of [
  { name: '截斷 JSON', error: '不是有效的 JSON', content: (backup: DayPopBackup) => JSON.stringify(backup).slice(0, 80) },
  { name: '較新格式版本', error: '來自較新版本', content: (backup: DayPopBackup) => JSON.stringify({ ...backup, formatVersion: backup.formatVersion + 1 }) },
  { name: '缺少必要欄位', error: '內容不完整或格式有誤', content: (backup: DayPopBackup) => JSON.stringify({ ...backup, data: { ...backup.data, preferences: {} } }) },
]) {
  test(`JSON 拒絕${invalid.name}，原始資料與 reload 結果不變`, async ({ page }, testInfo) => {
    const { path, backup } = await downloadBackup(page, testInfo);
    const before = await storedBytes(page);
    await chooseBackup(page, {
      name: 'invalid-backup.json', mimeType: 'application/json',
      buffer: Buffer.from(invalid.content(backup)),
    });
    await expect(page.getByRole('alert')).toContainText(invalid.error);
    await expect(page.getByRole('dialog', { name: '匯入預覽' })).toHaveCount(0);
    expect(await storedBytes(page)).toBe(before);
    await reloadApp(page);
    expect(await storedBytes(page)).toBe(before);
    await tabButton(page, '設定').click();

    // A rejected file must not leave the picker stuck or poison the next plan.
    await chooseBackup(page, path);
    const preview = page.getByRole('dialog', { name: '匯入預覽' });
    await expect(preview).toContainText('共 4 筆行程');
    await preview.getByRole('button', { name: '取消', exact: true }).click();
    expect(await storedBytes(page)).toBe(before);
  });
}
