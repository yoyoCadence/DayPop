import { Buffer } from 'node:buffer';
import { expect, test, type Page } from '@playwright/test';
import { createEmptyUserData, type DayPopUserData } from '../src/domain/types';
import { todoTree } from '../src/test/todoTree';
import { E2E_EMAIL, E2E_PASSWORD, calendarViewButton, monitorBrowser, openApp, reloadApp, tabButton } from './support';

const NOW = '2026-09-30T04:00:00.000Z';
const accountKey = 'daypop.account-cache.00000000-0000-4000-8000-000000000030';

function fixture() {
  const data = createEmptyUserData({ now: NOW });
  data.preferences.petEnabled = false;
  data.todos = todoTree(data.calendars[0]!.id);
  return data;
}

async function dataIn(page: Page, key: string): Promise<DayPopUserData> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).data, key);
}

async function openDay(page: Page) {
  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '月').click();
  await page.getByRole('button', { name: '2026-09-30，0 個行程', exact: true }).click();
  return page.getByRole('dialog', { name: '9月30日 週三', exact: true });
}

async function signIn(page: Page) {
  await tabButton(page, '設定').click();
  await page.getByRole('button', { name: '登入／註冊', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '保存你的日蹦資料' });
  await dialog.getByLabel('Email').fill(E2E_EMAIL);
  await dialog.getByLabel('密碼', { exact: true }).fill(E2E_PASSWORD);
  await dialog.getByRole('button', { name: '登入', exact: true }).click();
  await tabButton(page, '設定').click();
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();
}

test('遊客刪除父待辦清除全部子孫，reload 可讀且其餘待辦仍能操作', async ({ page }) => {
  const clean = monitorBrowser(page);
  await page.clock.setFixedTime(new Date(NOW));
  const data = fixture();
  await page.addInitScript((data) => {
    if (!localStorage.getItem('daypop.user-data')) localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 4, revision: 0, updatedAt: data.todos[0]!.updatedAt, data }));
  }, data);
  await openApp(page);
  console.log('DP-115 guest browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  const day = await openDay(page);
  await day.getByRole('button', { name: '刪除 父待辦', exact: true }).click();
  await expect(day.getByRole('button', { name: '完成 保留待辦', exact: true })).toBeVisible();
  await expect(day.getByRole('button', { name: '刪除 子項', exact: true })).toHaveCount(0);
  expect((await dataIn(page, 'daypop.user-data')).todos.map((todo) => todo.title)).toEqual(['保留待辦']);
  await reloadApp(page);
  const restored = await openDay(page);
  await restored.getByRole('button', { name: '完成 保留待辦', exact: true }).click();
  await expect(restored.getByRole('button', { name: '完成 保留待辦', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.dp-viewport')).toBeVisible();
  clean();
});

test('帳號刪除父待辦同步完整子樹，清除測試帳號快取後重登讀回仍一致', async ({ page }) => {
  const clean = monitorBrowser(page);
  await page.clock.setFixedTime(new Date(NOW));
  await openApp(page, '/e2e/auth.html');
  console.log('DP-115 account browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  const guestBytes = await page.evaluate(() => localStorage.getItem('daypop.user-data'));
  await signIn(page);
  const data = fixture();
  const pending = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '⬆ 匯入資料', exact: true }).click();
  await (await pending).setFiles({ name: 'todo-tree.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    format: 'daypop.backup', formatVersion: 1, exportedAt: NOW, appVersion: '0.4.1',
    omitted: { eventAttachments: 0 }, data: {
      calendars: data.calendars, events: [], eventExceptions: [], todos: data.todos,
      stickers: [], preferences: data.preferences,
    },
  })) });
  await page.getByRole('dialog', { name: '匯入預覽' }).getByRole('button', { name: '取代資料', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '匯入預覽' })).toHaveCount(0);
  const day = await openDay(page);
  await day.getByRole('button', { name: '刪除 父待辦', exact: true }).click();
  await expect.poll(async () => (await dataIn(page, accountKey)).todos.map((todo) => todo.title)).toEqual(['保留待辦']);
  await day.getByRole('button', { name: '完成', exact: true }).click();
  await tabButton(page, '設定').click();
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '登出', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(guestBytes);
  // The fake DB lives for this page; a page reload would rebuild it. Recreate
  // the adapter without its cache to verify a remote read, as in DP-092.
  await page.evaluate((key) => localStorage.removeItem(key), accountKey);
  await signIn(page);
  const restored = await openDay(page);
  await expect(restored.getByRole('button', { name: '完成 保留待辦', exact: true })).toBeVisible();
  expect((await dataIn(page, accountKey)).todos.map((todo) => todo.title)).toEqual(['保留待辦']);
  expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(guestBytes);
  clean();
});
