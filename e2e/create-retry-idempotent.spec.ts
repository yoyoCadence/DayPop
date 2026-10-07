import { expect, test, type Page } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, monitorBrowser, openApp, tabButton } from './support';

/**
 * A create that was stored but whose response was lost must not be duplicated
 * by the retry the form invites — DP-142.
 *
 * `fakeSupabase.lostResponses` commits the write and then rejects, which is
 * the one failure where retrying used to add a second row: each attempt minted
 * a fresh id. The forms now keep one id per draft.
 */
const DATE = '2026-09-30';
const KEY = 'daypop.account-cache.00000000-0000-4000-8000-000000000030';
test.use({ timezoneId: 'America/New_York' });

// The already loaded dev-only module owns this synthetic account. It is outside
// the production graph; no cloud credentials or user rows are involved.
const FAKE_MODULE = '/src/test/e2eAuthMain.tsx';

async function signIn(page: Page) {
  await page.clock.setFixedTime(new Date('2026-09-30T04:00:00.000Z'));
  await openApp(page, '/e2e/auth.html');
  console.log('DP-142 actual browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'display: Asia/Taipei');
  await tabButton(page, '設定').click();
  await page.getByRole('button', { name: '登入／註冊', exact: true }).click();
  const auth = page.getByRole('dialog', { name: '保存你的日蹦資料' });
  await auth.getByLabel('Email').fill(E2E_EMAIL);
  await auth.getByLabel('密碼', { exact: true }).fill(E2E_PASSWORD);
  await auth.getByRole('button', { name: '登入', exact: true }).click();
  await tabButton(page, '設定').click();
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();
}

async function loseResponses(page: Page, table: string, enabled: boolean) {
  await page.evaluate(async ({ path, table, enabled }) => {
    const { fakeSupabase } = await import(path);
    if (enabled) fakeSupabase.lostResponses.set(table, 'DP-142 回應遺失');
    else fakeSupabase.lostResponses.delete(table);
  }, { path: FAKE_MODULE, table, enabled });
}

/** What the fake server holds, by the user-facing label of each row. */
const stored = (page: Page, table: string) => page.evaluate(async ({ path, table }) => {
  const { fakeSupabase } = await import(path);
  return (fakeSupabase.rows(table) as { title?: string; name?: string }[]).map((row) => row.title ?? row.name);
}, { path: FAKE_MODULE, table });

const cached = (page: Page, collection: 'events' | 'todos' | 'calendars') =>
  page.evaluate(({ key, collection }) => (JSON.parse(localStorage.getItem(key)!).data[collection] as { title?: string; name?: string }[]).map((row) => row.title ?? row.name), { key: KEY, collection });

test('帳號新增行程／待辦／日曆在回應遺失後重試，伺服器與畫面都只有一筆', async ({ page }) => {
  const clean = monitorBrowser(page);
  await signIn(page);
  const baseCalendars = await stored(page, 'calendars');

  // 日曆：伺服器已存、回應遺失，重試時還改了名稱。
  await page.getByRole('button', { name: '＋ 新增日曆' }).click();
  const calendar = page.getByRole('dialog', { name: '新增日曆', exact: true });
  await calendar.getByLabel('名稱').fill('工作');
  await loseResponses(page, 'calendars', true);
  await calendar.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(calendar.getByRole('alert')).toContainText('名稱與顏色已保留');
  expect(await stored(page, 'calendars')).toEqual([...baseCalendars, '工作']);
  expect(await cached(page, 'calendars')).toEqual(baseCalendars);
  await loseResponses(page, 'calendars', false);
  await calendar.getByLabel('名稱').fill('工作（重試）');
  await calendar.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(calendar).toHaveCount(0);
  expect(await stored(page, 'calendars')).toEqual([...baseCalendars, '工作（重試）']);
  expect(await cached(page, 'calendars')).toEqual([...baseCalendars, '工作（重試）']);
  expect(await page.locator('.cal-manage-name').allTextContents()).toEqual([...baseCalendars, '工作（重試）']);

  // 行程：同一份草稿重試，不產生第二筆。
  await tabButton(page, '日曆').click();
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '新增行程', exact: true });
  await sheet.getByLabel('標題').fill('規劃旅行');
  await sheet.getByLabel('日期', { exact: true }).fill(DATE);
  await loseResponses(page, 'events', true);
  await sheet.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(sheet.getByRole('alert')).toContainText('草稿已保留');
  expect(await stored(page, 'events')).toEqual(['規劃旅行']);
  expect(await cached(page, 'events')).toEqual([]);
  await loseResponses(page, 'events', false);
  await sheet.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  expect(await stored(page, 'events')).toEqual(['規劃旅行']);
  expect(await cached(page, 'events')).toEqual(['規劃旅行']);

  // 待辦：日詳情的連續輸入欄位，重試後下一筆是新的 id。
  await page.locator(`button[aria-label^="${DATE}"]`).click();
  const day = page.getByRole('dialog', { name: '9月30日 週三', exact: true });
  await expect(day.getByRole('button').filter({ hasText: '規劃旅行' })).toHaveCount(1);
  const input = day.getByLabel('新增清單項目', { exact: true });
  await input.fill('訂車票');
  await loseResponses(page, 'todos', true);
  await input.press('Enter');
  await expect(day.getByRole('alert')).toContainText('輸入內容已保留');
  expect(await stored(page, 'todos')).toEqual(['訂車票']);
  expect(await cached(page, 'todos')).toEqual([]);
  await loseResponses(page, 'todos', false);
  await input.press('Enter');
  await expect(day.getByRole('button', { name: '完成 訂車票', exact: true })).toHaveCount(1);
  await expect(input).toHaveValue('');
  await page.keyboard.type('帶護照');
  await page.keyboard.press('Enter');
  await expect(day.getByRole('button', { name: '完成 帶護照', exact: true })).toHaveCount(1);
  expect(await stored(page, 'todos')).toEqual(['訂車票', '帶護照']);
  expect(await cached(page, 'todos')).toEqual(['訂車票', '帶護照']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  clean();
});
