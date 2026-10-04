import { expect, test } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, monitorBrowser, openApp, reloadApp, tabButton } from './support';

const DATE = '2026-10-04';
const long = '字'.repeat(301);
const valid = '😀'.repeat(300);

for (const account of [false, true]) {
  test(`${account ? '帳號' : '遊客'}標題上限保留草稿，300 emoji 可保存並重新讀取`, async ({ page }) => {
    const clean = monitorBrowser(page);
    await page.clock.setFixedTime(new Date('2026-10-04T02:00:00Z'));
    await openApp(page, account ? '/e2e/auth.html' : '/');
    console.log('DP-125 browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
    if (account) {
      await tabButton(page, '設定').click();
      await page.getByRole('button', { name: '登入／註冊', exact: true }).click();
      const auth = page.getByRole('dialog', { name: '保存你的日蹦資料' });
      await auth.getByLabel('Email').fill(E2E_EMAIL);
      await auth.getByLabel('密碼', { exact: true }).fill(E2E_PASSWORD);
      await auth.getByRole('button', { name: '登入', exact: true }).click();
      await tabButton(page, '日曆').click();
    }
    await page.getByRole('button', { name: '新增', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: '新增行程' });
    await sheet.getByLabel('標題').fill(long);
    await expect(sheet.getByRole('alert')).toContainText('最多 300');
    await expect(sheet.getByRole('button', { name: '儲存', exact: true })).toBeDisabled();
    await sheet.getByLabel('標題').press('Enter');
    await expect(sheet.getByLabel('標題')).toHaveValue(long);
    await sheet.getByLabel('標題').fill('事件上限');
    await sheet.getByRole('button', { name: '儲存', exact: true }).click();
    await page.getByRole('button', { name: `${DATE}，1 個行程`, exact: true }).click();
    const day = page.getByRole('dialog', { name: '10月4日 週日', exact: true });
    await day.getByLabel('新增清單項目').fill(long);
    await day.getByLabel('新增清單項目').press('Enter');
    await expect(day.getByLabel('新增清單項目')).toHaveValue(long);
    await expect(day.getByRole('button', { name: '新增待辦', exact: true })).toBeDisabled();
    await day.getByLabel('新增清單項目').fill('父項');
    await day.getByRole('button', { name: '新增待辦', exact: true }).click();
    await day.getByRole('button', { name: '展開 父項 的子項', exact: true }).click();
    const childInput = day.getByLabel('新增 父項 的細項');
    await childInput.fill(long);
    await childInput.press('Enter');
    await expect(childInput).toHaveValue(long);
    await expect(day.getByRole('button', { name: '新增 父項 的子項', exact: true })).toBeDisabled();
    await childInput.fill('子項');
    await childInput.press('Enter');
    await expect(day.getByRole('button', { name: '完成 子項', exact: true })).toBeVisible();
    await day.getByRole('button', { name: '修改 子項 的標題', exact: true }).click();
    const editor = day.getByRole('form', { name: '修改 子項 的標題', exact: true });
    await editor.getByLabel('待辦標題').fill(long);
    await editor.getByLabel('待辦標題').press('Enter');
    await expect(editor.getByLabel('待辦標題')).toHaveValue(long);
    await expect(editor.getByRole('button', { name: '儲存', exact: true })).toBeDisabled();
    await editor.getByLabel('待辦標題').fill(valid);
    await expect(editor.getByRole('button', { name: '儲存', exact: true })).toBeEnabled();
    await editor.getByLabel('待辦標題').press('Enter');
    await expect(editor).toHaveCount(0);
    const key = account ? 'daypop.account-cache.00000000-0000-4000-8000-000000000030' : 'daypop.user-data';
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).data.todos.map((item: { title: string }) => item.title), key)).toEqual(['父項', valid]);
    // The Auth harness's database is in memory: reload would reset it.
    // Clear cache and sign in again to verify the confirmed remote rows.
    if (account) {
      await day.getByRole('button', { name: '完成', exact: true }).click();
      await tabButton(page, '設定').click();
      await page.getByRole('button', { name: '登出', exact: true }).click();
      await page.evaluate(key => localStorage.removeItem(key), key);
      await tabButton(page, '設定').click();
      await page.getByRole('button', { name: '登入／註冊', exact: true }).click();
      const auth = page.getByRole('dialog', { name: '保存你的日蹦資料' });
      await auth.getByLabel('Email').fill(E2E_EMAIL);
      await auth.getByLabel('密碼', { exact: true }).fill(E2E_PASSWORD);
      await auth.getByRole('button', { name: '登入', exact: true }).click();
      await tabButton(page, '日曆').click();
    } else await reloadApp(page);
    await page.getByRole('button', { name: `${DATE}，1 個行程`, exact: true }).click();
    await day.getByRole('button', { name: '展開 父項 的子項', exact: true }).click();
    await expect(day.getByRole('button', { name: `完成 ${valid}`, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    clean();
  });
}
