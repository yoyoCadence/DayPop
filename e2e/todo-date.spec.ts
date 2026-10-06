import { expect, test, type Page } from '@playwright/test';
import { createEmptyUserData, type DayPopUserData } from '../src/domain/types';
import { E2E_EMAIL, E2E_PASSWORD, monitorBrowser, openApp, reloadApp, tabButton } from './support';

test.use({ timezoneId: 'America/New_York' });
const NOW = '2026-10-01T00:30:00.000Z';
const DATE = '2026-09-30';
const accountKey = 'daypop.account-cache.00000000-0000-4000-8000-000000000030';
const read = (page: Page, key: string): Promise<DayPopUserData> => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).data, key);

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

async function openDay(page: Page, date: string, label: string) {
  await tabButton(page, '日曆').click();
  await page.getByRole('button', { name: `${date}，0 個行程`, exact: true }).click();
  const day = page.getByRole('dialog', { name: label, exact: true });
  await expect(day).toBeVisible();
  return day;
}

for (const account of [false, true]) {
  test(`${account ? '帳號' : '遊客'} 父項與已完成子項獨立換日，鍵盤／無效草稿／焦點與重讀保留其他欄位`, async ({ page }) => {
    const clean = monitorBrowser(page);
    await page.clock.setFixedTime(new Date(NOW));
    const data = createEmptyUserData({ now: NOW });
    data.preferences.timezone = 'Asia/Taipei';
    data.preferences.petEnabled = false;
    await page.addInitScript((data) => {
      if (!localStorage.getItem('daypop.user-data')) localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 4, revision: 0, updatedAt: data.calendars[0]!.createdAt, data }));
    }, data);
    await openApp(page, account ? '/e2e/auth.html' : '/');
    expect(await page.title()).toContain('DayPop');
    console.log('DP-130 actual browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'display: Asia/Taipei');
    const guestBytes = await page.evaluate(() => localStorage.getItem('daypop.user-data'));
    if (account) await signIn(page);
    await tabButton(page, '日曆').click();
    await page.getByRole('button', { name: '新增', exact: true }).click();
    await page.getByRole('group', { name: '新增類型' }).getByRole('button', { name: '待辦', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: '新增待辦' });
    await sheet.getByLabel('標題').fill('準備旅行');
    await sheet.getByLabel('日期').fill(DATE);
    await sheet.getByRole('button', { name: '儲存', exact: true }).click();
    const day = await openDay(page, DATE, '9月30日 週三');
    await day.getByRole('button', { name: '展開 準備旅行 的子項', exact: true }).click();
    await day.getByLabel('新增 準備旅行 的細項').fill('預訂飯店');
    await day.getByLabel('新增 準備旅行 的細項').press('Enter');
    await day.getByRole('button', { name: '完成 預訂飯店', exact: true }).click();
    await expect(day.getByRole('button', { name: '完成 預訂飯店', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await day.getByLabel('預訂飯店 的優先度').selectOption('high');
    await expect(day.getByLabel('預訂飯店 的優先度')).toHaveValue('high');
    const key = account ? accountKey : 'daypop.user-data';
    const before = await read(page, key);
    const trigger = day.getByRole('button', { name: '修改 準備旅行 的日期', exact: true });
    await trigger.click();
    const date = day.getByLabel('準備旅行 的日期', { exact: true });
    await expect(date).toBeFocused();
    await date.fill('2026-10-01');
    await date.press('Escape');
    await expect(trigger).toBeFocused();
    expect(await read(page, key)).toEqual(before);
    await trigger.click();
    const editor = day.getByRole('form', { name: '修改 準備旅行 的日期', exact: true });
    await date.fill('');
    await expect(editor.getByRole('button', { name: '儲存', exact: true })).toBeDisabled();
    await expect(editor.getByRole('alert')).toContainText('有效');
    expect(await read(page, key)).toEqual(before);
    await date.fill('2026-10-01');
    await date.press('Enter');
    await expect(trigger).toHaveCount(0);
    await expect(day.getByRole('button', { name: '完成', exact: true })).toBeFocused();
    await expect(day.getByRole('button', { name: '修改 預訂飯店 的日期', exact: true })).toBeVisible();
    const parentMoved = await read(page, key);
    expect(parentMoved.todos).toEqual(before.todos.map((todo, index) => index === 0 ? { ...todo, dueDate: '2026-10-01', updatedAt: parentMoved.todos[0]!.updatedAt } : todo));
    await day.getByRole('button', { name: '修改 預訂飯店 的日期', exact: true }).click();
    await day.getByLabel('預訂飯店 的日期', { exact: true }).fill('2026-10-02');
    await day.getByRole('form', { name: '修改 預訂飯店 的日期', exact: true }).getByRole('button', { name: '儲存', exact: true }).click();
    await expect(day.getByRole('button', { name: '修改 預訂飯店 的日期', exact: true })).toHaveCount(0);
    await expect(day.getByRole('button', { name: '完成', exact: true })).toBeFocused();
    const saved = await read(page, key);
    expect(saved.todos).toEqual(parentMoved.todos.map((todo, index) => index === 1 ? { ...todo, dueDate: '2026-10-02', updatedAt: saved.todos[1]!.updatedAt } : todo));
    if (!account) await reloadApp(page);
    else {
      await day.getByRole('button', { name: '完成', exact: true }).click();
      await tabButton(page, '設定').click();
      await page.getByRole('button', { name: '登出', exact: true }).click();
      await page.evaluate((key) => localStorage.removeItem(key), accountKey);
      await signIn(page);
    }
    const parentDay = await openDay(page, '2026-10-01', '10月1日 週四');
    await expect(parentDay.getByRole('button', { name: '修改 準備旅行 的日期', exact: true })).toBeVisible();
    await expect(parentDay.getByRole('button', { name: '修改 預訂飯店 的日期', exact: true })).toHaveCount(0);
    await parentDay.getByRole('button', { name: '完成', exact: true }).click();
    const childDay = await openDay(page, '2026-10-02', '10月2日 週五');
    await expect(childDay.getByRole('button', { name: '完成 預訂飯店', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(childDay.getByLabel('預訂飯店 的優先度')).toHaveValue('high');
    expect((await read(page, key)).todos).toEqual(saved.todos);
    if (account) expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(guestBytes);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    clean();
  });
}
