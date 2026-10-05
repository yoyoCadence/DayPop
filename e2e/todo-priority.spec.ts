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

async function openDay(page: Page) {
  await tabButton(page, '日曆').click();
  await page.getByRole('button', { name: `${DATE}，0 個行程`, exact: true }).click();
  return page.getByRole('dialog', { name: '9月30日 週三', exact: true });
}

for (const account of [false, true]) {
  test(`${account ? '帳號' : '遊客'} 優先度獨立保存父項／已完成子項，清除與重讀保留其他欄位`, async ({ page }) => {
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
    console.log('DP-128 actual browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'display: Asia/Taipei');
    const guestBytes = await page.evaluate(() => localStorage.getItem('daypop.user-data'));
    if (account) await signIn(page);
    await tabButton(page, '日曆').click();
    await page.getByRole('button', { name: '新增', exact: true }).click();
    await page.getByRole('group', { name: '新增類型' }).getByRole('button', { name: '待辦', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: '新增待辦' });
    await sheet.getByLabel('標題').fill('準備旅行');
    await sheet.getByLabel('日期').fill(DATE);
    await sheet.getByRole('button', { name: '儲存', exact: true }).click();
    const day = await openDay(page);
    await expect(day.getByText('逾期・原9/30', { exact: true })).toBeVisible();
    await day.getByRole('button', { name: '展開 準備旅行 的子項', exact: true }).click();
    await day.getByLabel('新增 準備旅行 的細項').fill('預訂飯店');
    await day.getByLabel('新增 準備旅行 的細項').press('Enter');
    await day.getByRole('button', { name: '完成 預訂飯店', exact: true }).click();
    await expect(day.getByRole('button', { name: '完成 預訂飯店', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const key = account ? accountKey : 'daypop.user-data';
    const before = await read(page, key);
    const parent = day.getByLabel('準備旅行 的優先度', { exact: true });
    await parent.selectOption('high');
    await expect(parent).toHaveValue('high');
    await expect(day.getByLabel('預訂飯店 的優先度')).toHaveValue('none');
    await parent.selectOption('none');
    await expect(parent).toHaveValue('none');
    // A native select supports keyboard choice, while the confirmation stays
    // tied to the repository result rather than an optimistic local value.
    await parent.focus();
    await parent.press('ArrowDown');
    await parent.press('Enter');
    await expect(parent).toHaveValue('low');
    await day.getByLabel('預訂飯店 的優先度').selectOption('medium');
    await expect(day.getByLabel('預訂飯店 的優先度')).toHaveValue('medium');
    const saved = await read(page, key);
    expect(saved.todos).toEqual(before.todos.map((todo, index) => ({ ...todo, priority: index === 0 ? 'low' : 'medium', updatedAt: saved.todos[index]!.updatedAt })));
    if (!account) {
      await reloadApp(page);
    } else {
      await day.getByRole('button', { name: '完成', exact: true }).click();
      await tabButton(page, '設定').click();
      await page.getByRole('button', { name: '登出', exact: true }).click();
      await page.evaluate((key) => localStorage.removeItem(key), accountKey);
      await signIn(page);
    }
    const restored = await openDay(page);
    await restored.getByRole('button', { name: '展開 準備旅行 的子項', exact: true }).click();
    await expect(restored.getByLabel('準備旅行 的優先度')).toHaveValue('low');
    await expect(restored.getByLabel('預訂飯店 的優先度')).toHaveValue('medium');
    await expect(restored.getByRole('button', { name: '完成 預訂飯店', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect((await read(page, key)).todos).toEqual(saved.todos);
    if (account) expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(guestBytes);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    clean();
  });
}
