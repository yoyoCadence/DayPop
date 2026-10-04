import { expect, test, type Locator, type Page } from '@playwright/test';
import { createEmptyUserData, type DayPopUserData } from '../src/domain/types';
import { E2E_EMAIL, E2E_PASSWORD, monitorBrowser, openApp, reloadApp, tabButton } from './support';

test.use({ timezoneId: 'America/New_York' });
const NOW = '2026-09-30T00:30:00.000Z';
const DATE = '2026-09-30';
const accountKey = 'daypop.account-cache.00000000-0000-4000-8000-000000000030';
const read = (page: Page, key: string): Promise<DayPopUserData> => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).data, key);

async function openDay(page: Page) {
  await tabButton(page, '日曆').click();
  await page.getByRole('button', { name: `${DATE}，0 個行程`, exact: true }).click();
  return page.getByRole('dialog', { name: '9月30日 週三', exact: true });
}

async function rename(day: Locator, original: string, title: string) {
  await day.getByRole('button', { name: `修改 ${original} 的標題`, exact: true }).click();
  const editor = day.getByRole('form', { name: `修改 ${original} 的標題`, exact: true });
  await expect(editor.getByLabel('待辦標題')).toBeFocused();
  await editor.getByLabel('待辦標題').fill(title);
  await editor.getByLabel('待辦標題').press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(day.getByRole('button', { name: `修改 ${title.trim()} 的標題`, exact: true })).toBeFocused();
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

test('遊客可修正父待辦／完成子項標題，取消與空白不寫入，reload 保留完整欄位', async ({ page }) => {
  const clean = monitorBrowser(page);
  await page.clock.setFixedTime(new Date(NOW));
  const data = createEmptyUserData({ now: NOW });
  data.preferences.timezone = 'Asia/Taipei';
  data.preferences.petEnabled = false;
  const parent = '12000000-0000-4000-8000-000000000001';
  const common = { calendarId: data.calendars[0]!.id, dueDate: DATE, priority: 'high' as const, sharingScope: 'private' as const, createdAt: NOW, updatedAt: NOW };
  data.todos = [
    { ...common, id: parent, parentId: null, title: '旅行', sortOrder: 0, completedAt: null },
    { ...common, id: '12000000-0000-4000-8000-000000000002', parentId: parent, title: '訂房', sortOrder: 1, completedAt: NOW },
  ];
  await page.addInitScript((data) => {
    if (!localStorage.getItem('daypop.user-data')) localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 4, revision: 0, updatedAt: data.todos[0]!.updatedAt, data }));
  }, data);
  await openApp(page);
  console.log('DP-120 guest browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'display: Asia/Taipei');
  const day = await openDay(page);
  await day.getByRole('button', { name: '展開 旅行 的子項', exact: true }).click();
  const before = await page.evaluate(() => localStorage.getItem('daypop.user-data'));
  await day.getByRole('button', { name: '修改 旅行 的標題', exact: true }).click();
  const input = day.getByLabel('待辦標題');
  await input.fill('取消草稿');
  await input.press('Escape');
  await expect(day).toBeVisible();
  await expect(day.getByRole('button', { name: '修改 旅行 的標題', exact: true })).toBeFocused();
  await day.getByRole('button', { name: '修改 訂房 的標題', exact: true }).click();
  await input.fill('   ');
  await expect(day.getByRole('button', { name: '儲存', exact: true })).toBeDisabled();
  await input.press('Enter');
  await expect(input).toBeVisible();
  await day.getByRole('button', { name: '取消', exact: true }).click();
  await rename(day, '旅行', '  旅行  ');
  expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(before);
  await rename(day, '旅行', '  準備旅行  ');
  await rename(day, '訂房', '  預訂飯店  ');
  await expect(day.locator('.cal-day-sub-count')).toHaveText('▾ 1/1');
  const saved = await read(page, 'daypop.user-data');
  expect(saved.todos).toEqual(data.todos.map((todo, index) => ({ ...todo, title: index === 0 ? '準備旅行' : '預訂飯店' })));
  await reloadApp(page);
  const restored = await openDay(page);
  await restored.getByRole('button', { name: '展開 準備旅行 的子項', exact: true }).click();
  await expect(restored.getByRole('button', { name: '完成 預訂飯店', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect((await read(page, 'daypop.user-data')).todos).toEqual(saved.todos);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  clean();
});

test('帳號可改父／子標題，清快取重登仍讀回新標題與獨立完成且不影響遊客', async ({ page }) => {
  const clean = monitorBrowser(page);
  await page.clock.setFixedTime(new Date(NOW));
  await openApp(page, '/e2e/auth.html');
  console.log('DP-120 account browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  const guestBytes = await page.evaluate(() => localStorage.getItem('daypop.user-data'));
  await signIn(page);
  await tabButton(page, '日曆').click();
  await page.getByRole('button', { name: '新增', exact: true }).click();
  await page.getByRole('group', { name: '新增類型' }).getByRole('button', { name: '待辦', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '新增待辦' });
  await sheet.getByLabel('標題').fill('雲端清單');
  await sheet.getByLabel('日期').fill(DATE);
  await sheet.getByRole('button', { name: '儲存', exact: true }).click();
  const day = await openDay(page);
  await day.getByRole('button', { name: '展開 雲端清單 的子項', exact: true }).click();
  await day.getByLabel('新增 雲端清單 的細項').fill('細項');
  await day.getByLabel('新增 雲端清單 的細項').press('Enter');
  await day.getByRole('button', { name: '完成 細項', exact: true }).click();
  await expect(day.getByRole('button', { name: '完成 細項', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const before = await read(page, accountKey);
  await rename(day, '雲端清單', '雲端新清單');
  await rename(day, '細項', '已完成的新細項');
  const saved = await read(page, accountKey);
  expect(saved.todos).toEqual(before.todos.map((todo, index) => ({ ...todo, title: index === 0 ? '雲端新清單' : '已完成的新細項' })));
  await day.getByRole('button', { name: '完成', exact: true }).click();
  await tabButton(page, '設定').click();
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '登出', exact: true }).click();
  await page.evaluate((key) => localStorage.removeItem(key), accountKey);
  await signIn(page);
  const restored = await openDay(page);
  await restored.getByRole('button', { name: '展開 雲端新清單 的子項', exact: true }).click();
  await expect(restored.getByRole('button', { name: '完成 已完成的新細項', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect((await read(page, accountKey)).todos).toEqual(saved.todos);
  expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(guestBytes);
  clean();
});
