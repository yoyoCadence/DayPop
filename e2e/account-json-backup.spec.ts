import { readFile } from 'node:fs/promises';
import { expect, test as base, type Page, type TestInfo } from '@playwright/test';
import type { DayPopBackup } from '../src/domain/dataTransfer';
import type { DayPopUserData } from '../src/domain/types';
import {
  E2E_EMAIL, E2E_PASSWORD, agendaRow, calendarViewButton,
  monitorBrowser, openApp, tabButton,
} from './support';

// This is the synthetic account in src/test/e2eAuthMain.tsx, never a real user.
const accountCacheKey = 'daypop.account-cache.00000000-0000-4000-8000-000000000030';
const guestKey = 'daypop.user-data';
const testDate = '2026-10-01';

const test = base.extend<{ browserHealth: void; guestBytes: string }>({
  browserHealth: [async ({ page }, provide) => {
    const assertCleanBrowser = monitorBrowser(page);
    await provide();
    assertCleanBrowser();
  }, { auto: true }],
  guestBytes: async ({ page }, provide) => {
    await page.clock.setFixedTime(new Date('2026-10-01T04:00:00.000Z'));
    await openApp(page, '/e2e/auth.html');
    console.log('Account JSON browser timezone:', await page.evaluate(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    ));
    await addEntry(page, '遊客專用行程');
    const guestBytes = await storageBytes(page, guestKey);
    await signIn(page);
    await provide(guestBytes);
  },
});

async function storageBytes(page: Page, key: string) {
  const raw = await page.evaluate((key) => localStorage.getItem(key), key);
  expect(raw).not.toBeNull();
  return raw!;
}

async function accountData(page: Page): Promise<DayPopUserData> {
  return JSON.parse(await storageBytes(page, accountCacheKey)).data;
}

async function signIn(page: Page) {
  await tabButton(page, '設定').click();
  await page.getByRole('button', { name: '登入／註冊', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '保存你的日蹦資料' });
  await dialog.getByLabel('Email').fill(E2E_EMAIL);
  await dialog.getByLabel('密碼').fill(E2E_PASSWORD);
  await dialog.getByRole('button', { name: '登入', exact: true }).click();
  await tabButton(page, '設定').click();
  await expect(page.getByText('帳號已登入', { exact: true })).toBeVisible();
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();
}

async function addEntry(page: Page, title: string, kind: '行程' | '待辦' = '行程') {
  await tabButton(page, '日曆').click();
  await page.getByRole('button', { name: '新增', exact: true }).click();
  if (kind === '待辦') {
    await page.getByRole('group', { name: '新增類型' })
      .getByRole('button', { name: '待辦', exact: true }).click();
  }
  const dialog = page.getByRole('dialog', { name: `新增${kind}` });
  await dialog.getByLabel('標題').fill(title);
  await dialog.getByLabel('日期').fill(testDate);
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, title)).toHaveCount(1);
}

async function setPetName(page: Page, name: string) {
  await tabButton(page, '設定').click();
  await page.getByLabel('寵物名字').fill(name);
  await page.getByLabel('寵物名字').press('Tab');
  await expect.poll(async () => (await accountData(page)).preferences.petName).toBe(name);
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();
}

async function downloadBackup(page: Page, testInfo: TestInfo) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '⬇ 匯出資料', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(`daypop-backup-${testDate}.json`);
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  const backup: DayPopBackup = JSON.parse(await readFile(path, 'utf8'));
  return { path, backup };
}

async function previewBackup(page: Page, path: string) {
  const pending = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '⬆ 匯入資料', exact: true }).click();
  await (await pending).setFiles(path);
  const preview = page.getByRole('dialog', { name: '匯入預覽' });
  await expect(preview).toBeVisible();
  return preview;
}

/**
 * The harness DB lives for this page only; page.reload() would recreate it.
 * Sign out to unmount the account repository, discard only this test account's
 * cache, then sign in so the new adapter must read the fake remote again.
 * This cannot prove real Supabase durability, RLS or auth session restore.
 */
async function reloadAccountWithoutCache(page: Page, guestBytes: string) {
  await tabButton(page, '設定').click();
  await page.getByRole('button', { name: '登出', exact: true }).click();
  await tabButton(page, '設定').click();
  await expect(page.getByText('目前是遊客模式', { exact: true })).toBeVisible();
  expect(await storageBytes(page, guestKey)).toBe(guestBytes);
  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, '遊客專用行程')).toHaveCount(1);
  await expect(page.locator('.cal-agenda-item')).toHaveCount(1);
  await page.evaluate((key) => localStorage.removeItem(key), accountCacheKey);
  expect(await page.evaluate((key) => localStorage.getItem(key), accountCacheKey)).toBeNull();
  await signIn(page);
  expect(await storageBytes(page, guestKey)).toBe(guestBytes);
}

test('帳號 JSON 還原會重新寫入並讀回，重登不依賴快取且遊客資料不變', async ({ page, guestBytes }, testInfo) => {
  await addEntry(page, '帳號備份行程');
  await addEntry(page, '帳號備份待辦', '待辦');
  await setPetName(page, '帳號備份夥伴');
  const original = await accountData(page);
  const { path, backup } = await downloadBackup(page, testInfo);
  expect({ ...backup.data, eventAttachments: [] }).toEqual(original);
  expect(backup.omitted).toEqual({ eventAttachments: 0 });
  expect(backup.data.events.map((event) => event.title)).toEqual(['帳號備份行程']);
  expect(backup.data.todos.map((todo) => todo.title)).toEqual(['帳號備份待辦']);

  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '列表').click();
  await agendaRow(page, '帳號備份行程').click();
  await page.getByRole('dialog', { name: '編輯行程' })
    .getByRole('button', { name: '刪除事件', exact: true }).click();
  await expect(agendaRow(page, '帳號備份行程')).toHaveCount(0);
  await addEntry(page, '帳號備份後新增');
  await setPetName(page, '帳號備份後修改');
  const changedCache = await storageBytes(page, accountCacheKey);
  expect(await accountData(page)).not.toEqual(original);

  let preview = await previewBackup(page, path);
  await expect(preview).toContainText('共 1 筆行程');
  await expect(preview).toContainText('待辦 1');
  await expect(preview).toContainText('將取代目前 3 筆可攜資料');
  expect(await storageBytes(page, accountCacheKey)).toBe(changedCache);
  await preview.getByRole('button', { name: '取消', exact: true }).click();
  expect(await storageBytes(page, accountCacheKey)).toBe(changedCache);
  expect(await storageBytes(page, guestKey)).toBe(guestBytes);

  preview = await previewBackup(page, path);
  await preview.getByRole('button', { name: '取代資料', exact: true }).click();
  await expect(preview).toBeHidden();
  await expect(page.getByRole('status')).toContainText('還原 3 筆資料');
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();
  expect(await accountData(page)).toEqual(original);
  expect(await storageBytes(page, guestKey)).toBe(guestBytes);

  await reloadAccountWithoutCache(page, guestBytes);
  expect(await accountData(page)).toEqual(original);
  await expect(page.getByLabel('寵物名字')).toHaveValue('帳號備份夥伴');
  const restored = await downloadBackup(page, testInfo);
  expect(restored.backup.data).toEqual(backup.data);
  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, '帳號備份行程')).toHaveCount(1);
  await expect(agendaRow(page, '帳號備份待辦')).toHaveCount(1);
  await expect(agendaRow(page, '帳號備份後新增')).toHaveCount(0);
  await expect(agendaRow(page, '遊客專用行程')).toHaveCount(0);
});

test('帳號有附件時拒絕 JSON 取代，快取、重新讀回的資料與附件 metadata 均保留', async ({ page, guestBytes }, testInfo) => {
  await addEntry(page, '附件備份行程');
  await agendaRow(page, '附件備份行程').click();
  const eventDialog = page.getByRole('dialog', { name: '編輯行程' });
  await eventDialog.locator('input[type="file"]').setInputFiles('e2e/fixtures/e2e-note.txt');
  await expect(eventDialog.getByRole('status')).toContainText('附件已安全保存');
  await expect(eventDialog.locator('.cal-attachment-list li')).toContainText('e2e-note.txt');
  await eventDialog.getByRole('button', { name: '取消', exact: true }).click();
  await tabButton(page, '設定').click();
  const { path, backup } = await downloadBackup(page, testInfo);
  expect(backup.omitted).toEqual({ eventAttachments: 1 });
  expect(backup.data).not.toHaveProperty('eventAttachments');
  const attachment = (await accountData(page)).eventAttachments[0];
  expect(attachment).toBeDefined();
  expect(JSON.stringify(backup)).not.toContain(attachment.objectPath);
  expect(JSON.stringify(backup)).not.toContain(attachment.fileName);

  // Make accepting this backup observably destructive even if a faulty import
  // happened to preserve the attachment row: it would revert the new title.
  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '列表').click();
  await agendaRow(page, '附件備份行程').click();
  await eventDialog.getByLabel('標題').fill('附件仍須保留');
  await eventDialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(agendaRow(page, '附件仍須保留')).toHaveCount(1);
  await tabButton(page, '設定').click();
  const before = await accountData(page);
  const beforeBytes = await storageBytes(page, accountCacheKey);
  const preview = await previewBackup(page, path);
  await expect(preview).toContainText('備份略過 1 個附件');
  await preview.getByRole('button', { name: '取代資料', exact: true }).click();
  await expect(preview.getByRole('alert')).toContainText('不能用取代的方式匯入');
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('button', { name: '取代資料', exact: true })).toBeEnabled();
  await expect(page.getByRole('status').filter({ hasText: '已從' })).toHaveCount(0);
  expect(await storageBytes(page, accountCacheKey)).toBe(beforeBytes);
  expect(await storageBytes(page, guestKey)).toBe(guestBytes);
  await preview.getByRole('button', { name: '取消', exact: true }).click();

  await reloadAccountWithoutCache(page, guestBytes);
  expect(await accountData(page)).toEqual(before);
  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, '附件備份行程')).toHaveCount(0);
  await agendaRow(page, '附件仍須保留').click();
  await expect(eventDialog.locator('.cal-attachment-list li')).toHaveCount(1);
  await expect(eventDialog.locator('.cal-attachment-list li')).toContainText('e2e-note.txt');
});
