import { expect, test, type Page } from '@playwright/test';
import { createEmptyUserData, type DayPopUserData } from '../src/domain/types';
import { E2E_EMAIL, E2E_PASSWORD, monitorBrowser, openApp, reloadApp, tabButton } from './support';

test.use({ timezoneId: 'America/New_York' });
const NOW = '2026-08-12T04:00:00.000Z';
const accountKey = 'daypop.account-cache.00000000-0000-4000-8000-000000000030';
const cell = (page: Page, date: string) => page.locator(`[data-date-key="${date}"]`);
const read = (page: Page, key: string): Promise<DayPopUserData> => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).data, key);
const raw = (page: Page, key: string) => page.evaluate((key) => localStorage.getItem(key), key);

async function signIn(page: Page) {
  await tabButton(page, '設定').click();
  await page.getByRole('button', { name: '登入／註冊', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '保存你的日蹦資料' });
  await dialog.getByLabel('Email').fill(E2E_EMAIL);
  await dialog.getByLabel('密碼', { exact: true }).fill(E2E_PASSWORD);
  await dialog.getByRole('button', { name: '登入', exact: true }).click();
  await tabButton(page, '設定').click();
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();
  await tabButton(page, '日曆').click();
}

async function setup(page: Page, account: boolean) {
  await page.clock.setFixedTime(new Date(NOW));
  const data = createEmptyUserData({ now: NOW });
  data.preferences.timezone = 'Asia/Taipei';
  data.preferences.petEnabled = false;
  await page.addInitScript((data) => {
    if (!localStorage.getItem('daypop.user-data')) localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 4, revision: 0, updatedAt: data.calendars[0]!.createdAt, data }));
  }, data);
  await openApp(page, account ? '/e2e/auth.html' : '/');
  console.log('DP-127 actual browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  const guestBytes = await raw(page, 'daypop.user-data');
  if (account) await signIn(page);
  return { key: account ? accountKey : 'daypop.user-data', guestBytes };
}

async function restore(page: Page, account: boolean) {
  if (!account) return reloadApp(page);
  // FakeSupabase is page-scoped: clear the cache and re-sign in to prove a
  // fresh remote read, rather than recreating the fake server with page reload.
  const day = page.locator('.cal-day-sheet');
  if (await day.isVisible()) await day.getByRole('button', { name: '完成', exact: true }).click();
  await tabButton(page, '設定').click();
  await page.getByRole('button', { name: '登出', exact: true }).click();
  await page.evaluate((key) => localStorage.removeItem(key), accountKey);
  await signIn(page);
}

async function create(page: Page, title: string, startDate: string, endDate: string, recurring = false) {
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '新增行程' });
  await sheet.getByLabel('標題', { exact: true }).fill(title);
  await sheet.getByRole('button', { name: '全天', exact: true }).click();
  await sheet.getByLabel('日期', { exact: true }).fill(startDate);
  await sheet.getByLabel('結束日期', { exact: true }).fill(endDate);
  if (recurring) await sheet.getByLabel('重複', { exact: true }).selectOption('weekly');
  return sheet;
}

async function editFromDay(page: Page, date: string, title: string) {
  await cell(page, date).click();
  const day = page.locator('.cal-day-sheet');
  await day.locator('.cal-day-event').filter({ hasText: title }).click();
  return page.getByRole('dialog', { name: '編輯行程' });
}

for (const account of [false, true]) {
  const label = account ? '帳號' : '遊客';
  test(`${label} 可建立多日全天、拒絕倒置／空白、整段移動與縮短，重讀保留範圍`, async ({ page }) => {
    const clean = monitorBrowser(page);
    const { key, guestBytes } = await setup(page, account);
    const before = await raw(page, key);
    const sheet = await create(page, '三天旅行', '2026-08-10', '2026-08-09');
    await expect(sheet.getByRole('alert')).toContainText('不能早於');
    await expect(sheet.getByRole('button', { name: '儲存', exact: true })).toBeDisabled();
    await sheet.getByLabel('結束日期').fill('');
    await expect(sheet.getByRole('alert')).toContainText('有效');
    expect(await raw(page, key)).toBe(before);
    await sheet.getByLabel('結束日期').fill('2026-08-12');
    await sheet.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(cell(page, '2026-08-12')).toContainText('續 三天旅行');
    const saved = await read(page, key);
    expect(saved.events).toHaveLength(1);
    expect(saved.events[0]).toMatchObject({ allDay: true, startDate: '2026-08-10', endDate: '2026-08-12' });
    const edit = await editFromDay(page, '2026-08-12', '三天旅行');
    await expect(edit.getByLabel('日期', { exact: true })).toHaveValue('2026-08-10');
    await expect(edit.getByLabel('結束日期')).toHaveValue('2026-08-12');
    await edit.getByLabel('日期', { exact: true }).fill('2026-08-11');
    await expect(edit.getByLabel('結束日期')).toHaveValue('2026-08-13');
    await edit.getByLabel('結束日期').fill('2026-08-11');
    await edit.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(edit).toHaveCount(0);
    await expect.poll(async () => (await read(page, key)).events[0]).toMatchObject({ startDate: '2026-08-11', endDate: '2026-08-11' });
    const expected = await read(page, key);
    await restore(page, account);
    expect((await read(page, key)).events).toEqual(expected.events);
    await expect(cell(page, '2026-08-11')).toContainText('三天旅行');
    await expect(cell(page, '2026-08-12')).not.toContainText('三天旅行');
    if (account) expect(await raw(page, 'daypop.user-data')).toBe(guestBytes);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    clean();
  });

  test(`${label} 重複全天的單次延長與全部移動，系列錨點與明確跨度正確`, async ({ page }) => {
    const clean = monitorBrowser(page);
    const { key, guestBytes } = await setup(page, account);
    const sheet = await create(page, '每週小旅行', '2026-08-06', '2026-08-08', true);
    await sheet.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(cell(page, '2026-08-14')).toContainText('續 每週小旅行');
    let edit = await editFromDay(page, '2026-08-14', '每週小旅行');
    await expect(edit.getByLabel('結束日期')).toHaveValue('2026-08-15');
    await edit.getByLabel('結束日期').fill('2026-08-16');
    await edit.getByRole('button', { name: '儲存', exact: true }).click();
    await page.getByRole('button', { name: '只改這一次', exact: true }).click();
    await expect.poll(async () => (await read(page, key)).events).toHaveLength(2);
    const single = await read(page, key);
    expect(single.events.find((event) => event.recurrence)).toMatchObject({ startDate: '2026-08-06', endDate: '2026-08-08' });
    expect(single.events.find((event) => !event.recurrence)).toMatchObject({ startDate: '2026-08-13', endDate: '2026-08-16' });
    await page.locator('.cal-day-sheet').getByRole('button', { name: '完成', exact: true }).click();
    edit = await editFromDay(page, '2026-08-21', '每週小旅行');
    await expect(edit.getByLabel('日期', { exact: true })).toHaveValue('2026-08-20');
    await edit.getByLabel('日期', { exact: true }).fill('2026-08-21');
    await expect(edit.getByLabel('結束日期')).toHaveValue('2026-08-23');
    await edit.getByLabel('結束日期').fill('2026-08-24');
    await edit.getByRole('button', { name: '儲存', exact: true }).click();
    await page.getByRole('button', { name: '套用全部', exact: true }).click();
    await expect.poll(async () => (await read(page, key)).events.find((event) => event.recurrence)).toMatchObject({ startDate: '2026-08-07', endDate: '2026-08-10' });
    const expected = await read(page, key);
    await restore(page, account);
    expect((await read(page, key)).events).toEqual(expected.events);
    expect((await read(page, key)).eventExceptions).toEqual(expected.eventExceptions);
    if (account) expect(await raw(page, 'daypop.user-data')).toBe(guestBytes);
    clean();
  });
}
