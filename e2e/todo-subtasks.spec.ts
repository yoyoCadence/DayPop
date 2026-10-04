import { expect, test, type Page } from '@playwright/test';
import { createEmptyUserData, type DayPopUserData } from '../src/domain/types';
import { E2E_EMAIL, E2E_PASSWORD, monitorBrowser, openApp, reloadApp, tabButton } from './support';

test.use({ timezoneId: 'America/New_York' });
const NOW = '2026-09-30T00:30:00.000Z';
const accountKey = 'daypop.account-cache.00000000-0000-4000-8000-000000000030';
const read = (page: Page, key: string): Promise<DayPopUserData> => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).data, key);

async function openDay(page: Page) {
  await tabButton(page, '日曆').click();
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

test('遊客子項新增、鍵盤展開與獨立完成，reload 與刪除保持完整日期／日曆／隱私', async ({ page }) => {
  const clean = monitorBrowser(page);
  await page.clock.setFixedTime(new Date(NOW));
  const data = createEmptyUserData({ now: NOW });
  data.preferences.timezone = 'Asia/Taipei';
  data.preferences.petEnabled = false;
  const parentCalendar = '11600000-0000-4000-8000-000000000001';
  data.calendars.push({ ...data.calendars[0]!, id: parentCalendar, isDefault: false, name: '生活', sortOrder: 1 });
  const common = { calendarId: parentCalendar, parentId: null, dueDate: '2026-09-30', priority: 'none' as const, completedAt: null, sharingScope: 'private' as const, createdAt: NOW, updatedAt: NOW };
  data.todos = [
    { ...common, id: '11600000-0000-4000-8000-000000000002', title: '準備旅行', sortOrder: 0 },
    { ...common, id: '11600000-0000-4000-8000-000000000003', title: '買牛奶', sortOrder: 1 },
  ];
  await page.addInitScript((data) => {
    if (!localStorage.getItem('daypop.user-data')) localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 4, revision: 0, updatedAt: data.todos[0]!.updatedAt, data }));
  }, data);
  await openApp(page);
  console.log('DP-116 browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'display: Asia/Taipei');
  const day = await openDay(page);
  const expand = day.getByRole('button', { name: '展開 準備旅行 的子項', exact: true });
  await expand.focus();
  await page.keyboard.press('Enter');
  await expect(day.getByRole('button', { name: '收合 準備旅行 的子項', exact: true })).toHaveAttribute('aria-expanded', 'true');
  const input = day.getByLabel('新增 準備旅行 的細項', { exact: true });
  await input.fill('  訂房  ');
  await input.press('Enter');
  await expect(day.getByRole('button', { name: '完成 訂房', exact: true })).toBeVisible();
  await expect(input).toHaveValue('');
  await input.fill('打包');
  await input.press('Enter');
  await day.getByRole('button', { name: '完成 訂房', exact: true }).click();
  await expect(day.locator('.cal-day-sub-count')).toHaveText('▾ 1/2');
  await expect(day.getByRole('button', { name: '完成 準備旅行', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await day.getByRole('button', { name: '完成 準備旅行', exact: true }).click();
  const collapse = day.getByRole('button', { name: '收合 準備旅行 的子項', exact: true });
  await collapse.focus();
  await page.keyboard.press('Space');
  await expect(input).toHaveCount(0);
  let saved = await read(page, 'daypop.user-data');
  expect(saved.todos).toHaveLength(4);
  expect(saved.todos.slice(2).map((todo) => [todo.parentId, todo.calendarId, todo.dueDate, todo.sharingScope])).toEqual(Array(2).fill(['11600000-0000-4000-8000-000000000002', parentCalendar, '2026-09-30', 'private']));
  await reloadApp(page);
  const restored = await openDay(page);
  await restored.getByRole('button', { name: '展開 準備旅行 的子項', exact: true }).click();
  await expect(restored.getByRole('button', { name: '完成 訂房', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(restored.getByRole('button', { name: '完成 打包', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(restored.getByRole('button', { name: '完成 準備旅行', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await restored.getByRole('button', { name: '刪除 訂房', exact: true }).click();
  await expect(restored.locator('.cal-day-sub-count')).toHaveText('▾ 0/1');
  await restored.getByRole('button', { name: '刪除 準備旅行', exact: true }).click();
  await expect(restored.getByRole('button', { name: '完成 買牛奶', exact: true })).toBeVisible();
  saved = await read(page, 'daypop.user-data');
  expect(saved.todos.map((todo) => todo.title)).toEqual(['買牛奶']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  clean();
});

test('帳號從 UI 建立子項並同步，清快取重登後可勾選、刪除且不影響遊客', async ({ page }) => {
  const clean = monitorBrowser(page);
  await page.clock.setFixedTime(new Date(NOW));
  await openApp(page, '/e2e/auth.html');
  console.log('DP-116 account browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  const guestBytes = await page.evaluate(() => localStorage.getItem('daypop.user-data'));
  await signIn(page);
  await tabButton(page, '日曆').click();
  await page.getByRole('button', { name: '新增', exact: true }).click();
  await page.getByRole('group', { name: '新增類型' }).getByRole('button', { name: '待辦', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '新增待辦' });
  await sheet.getByLabel('標題').fill('雲端清單');
  await sheet.getByLabel('日期').fill('2026-09-30');
  await sheet.getByRole('button', { name: '儲存', exact: true }).click();
  const day = await openDay(page);
  await day.getByRole('button', { name: '展開 雲端清單 的子項', exact: true }).click();
  await day.getByLabel('新增 雲端清單 的細項').fill('雲端細項');
  await day.getByLabel('新增 雲端清單 的細項').press('Enter');
  await day.getByRole('button', { name: '完成 雲端細項', exact: true }).click();
  await expect(day.getByRole('button', { name: '完成 雲端細項', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(day.getByRole('button', { name: '完成 雲端清單', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await day.getByRole('button', { name: '完成', exact: true }).click();
  await tabButton(page, '設定').click();
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '登出', exact: true }).click();
  await page.evaluate((key) => localStorage.removeItem(key), accountKey);
  await signIn(page);
  const restored = await openDay(page);
  await restored.getByRole('button', { name: '展開 雲端清單 的子項', exact: true }).click();
  await expect(restored.getByRole('button', { name: '完成 雲端細項', exact: true })).toHaveAttribute('aria-pressed', 'true');
  let saved = await read(page, accountKey);
  expect(saved.todos).toHaveLength(2);
  expect(saved.todos[1]!.parentId).toBe(saved.todos[0]!.id);
  await restored.getByRole('button', { name: '刪除 雲端清單', exact: true }).click();
  await expect.poll(async () => (await read(page, accountKey)).todos).toEqual([]);
  saved = await read(page, accountKey);
  expect(saved.todos).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(guestBytes);
  clean();
});
