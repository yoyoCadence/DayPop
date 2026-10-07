import { expect, test, type Page } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, monitorBrowser, openApp, tabButton } from './support';

const DATE = '2026-09-30';
const KEY = 'daypop.account-cache.00000000-0000-4000-8000-000000000030';
test.use({ timezoneId: 'America/New_York' });

async function signIn(page: Page) {
  await page.clock.setFixedTime(new Date('2026-09-30T04:00:00.000Z'));
  await openApp(page, '/e2e/auth.html');
  console.log('DP-137 actual browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'display: Asia/Taipei');
  await tabButton(page, '設定').click();
  await page.getByRole('button', { name: '登入／註冊', exact: true }).click();
  const auth = page.getByRole('dialog', { name: '保存你的日蹦資料' });
  await auth.getByLabel('Email').fill(E2E_EMAIL);
  await auth.getByLabel('密碼', { exact: true }).fill(E2E_PASSWORD);
  await auth.getByRole('button', { name: '登入', exact: true }).click();
  await tabButton(page, '設定').click();
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();
  await tabButton(page, '日曆').click();
}

async function failTodos(page: Page, enabled: boolean) {
  await page.evaluate(async (enabled) => {
    // The already loaded dev-only module owns this synthetic account. It is
    // outside the production graph; no cloud credentials or user rows involved.
    const path = '/src/test/e2eAuthMain.tsx';
    const { fakeSupabase } = await import(path);
    if (enabled) fakeSupabase.rejections.set('todos', 'DP-137 測試連線失敗');
    else fakeSupabase.rejections.delete('todos');
  }, enabled);
}

const cachedTodoTitles = (page: Page) =>
  page.evaluate((key) => (JSON.parse(localStorage.getItem(key)!).data.todos as { title: string }[]).map((todo) => todo.title), KEY);

test('帳號在日詳情新增待辦／細項失敗時保留輸入，明確重試才新增，且可連續輸入', async ({ page }) => {
  const clean = monitorBrowser(page);
  await signIn(page);
  await page.locator(`button[aria-label^="${DATE}"]`).click();
  const day = page.getByRole('dialog', { name: '9月30日 週三', exact: true });
  const input = day.getByLabel('新增清單項目', { exact: true });

  await input.fill('訂車票');
  await failTodos(page, true);
  await input.press('Enter');
  const alert = day.getByRole('alert');
  await expect(alert).toHaveText('待辦尚未確認新增，輸入內容已保留；請先確認清單再重試。');
  await expect(alert).toBeInViewport();
  await expect(input).toHaveValue('訂車票');
  await expect(input).toBeFocused();
  await expect(input).toBeEditable();
  await expect(day.getByRole('button', { name: '完成 訂車票', exact: true })).toHaveCount(0);
  expect(await cachedTodoTitles(page)).toEqual([]);

  await failTodos(page, false);
  await input.press('Enter');
  await expect(day.getByRole('button', { name: '完成 訂車票', exact: true })).toHaveCount(1);
  await expect(input).toHaveValue('');
  await expect(alert).toHaveCount(0);
  // The field never lost focus, so the next todo can be typed straight away.
  await expect(input).toBeFocused();
  await page.keyboard.type('帶護照');
  await page.keyboard.press('Enter');
  await expect(day.getByRole('button', { name: '完成 帶護照', exact: true })).toHaveCount(1);
  await expect(input).toHaveValue('');
  expect(await cachedTodoTitles(page)).toEqual(['訂車票', '帶護照']);

  await day.getByRole('button', { name: '展開 訂車票 的子項', exact: true }).click();
  const sub = day.getByLabel('新增 訂車票 的細項', { exact: true });
  await sub.fill('選座位');
  await failTodos(page, true);
  await sub.press('Enter');
  await expect(alert).toHaveText('待辦尚未確認新增，輸入內容已保留；請先確認清單再重試。');
  await expect(alert).toBeInViewport();
  await expect(sub).toHaveValue('選座位');
  await expect(sub).toBeFocused();
  expect(await cachedTodoTitles(page)).toEqual(['訂車票', '帶護照']);

  await failTodos(page, false);
  await sub.press('Enter');
  await expect(day.getByRole('button', { name: '完成 選座位', exact: true })).toHaveCount(1);
  await expect(sub).toHaveValue('');
  await expect(alert).toHaveCount(0);
  expect((await cachedTodoTitles(page)).sort()).toEqual(['帶護照', '訂車票', '選座位'].sort());
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  clean();
});
