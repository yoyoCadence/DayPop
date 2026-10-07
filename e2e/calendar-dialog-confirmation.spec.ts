import { expect, test, type Page } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, monitorBrowser, openApp, tabButton } from './support';

const KEY = 'daypop.account-cache.00000000-0000-4000-8000-000000000030';
const DELETE_RPC = 'rpc:delete_calendar_with_reassignment';

async function signIn(page: Page) {
  await openApp(page, '/e2e/auth.html');
  await tabButton(page, '設定').click();
  await page.getByRole('button', { name: '登入／註冊', exact: true }).click();
  const auth = page.getByRole('dialog', { name: '保存你的日蹦資料' });
  await auth.getByLabel('Email').fill(E2E_EMAIL);
  await auth.getByLabel('密碼', { exact: true }).fill(E2E_PASSWORD);
  await auth.getByRole('button', { name: '登入', exact: true }).click();
  await tabButton(page, '設定').click();
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();
}

async function failTable(page: Page, table: string, enabled: boolean) {
  await page.evaluate(async ({ table, enabled }) => {
    // The already loaded dev-only module owns this synthetic account. It is
    // outside the production graph; no cloud credentials or user rows involved.
    const path = '/src/test/e2eAuthMain.tsx';
    const { fakeSupabase } = await import(path);
    if (enabled) fakeSupabase.failures.set(table, 'DP-141 測試連線失敗');
    else fakeSupabase.failures.delete(table);
  }, { table, enabled });
}

const cachedCalendarNames = (page: Page) =>
  page.evaluate((key) => (JSON.parse(localStorage.getItem(key)!).data.calendars as { name: string }[]).map((calendar) => calendar.name), KEY);

const calendarNames = (page: Page) => page.locator('.cal-manage-name').allTextContents();

test('帳號新增與刪除日曆失敗時對話框留著並保留輸入，明確重試才套用', async ({ page }) => {
  const clean = monitorBrowser(page);
  await signIn(page);
  const base = await calendarNames(page);
  expect(await cachedCalendarNames(page)).toEqual(base);

  await page.getByRole('button', { name: '＋ 新增日曆' }).click();
  const create = page.getByRole('dialog', { name: '新增日曆', exact: true });
  await create.getByLabel('名稱').fill('工作');
  await failTable(page, 'calendars', true);
  await create.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(create.getByRole('alert')).toContainText('名稱與顏色已保留；請先確認資料再重試。');
  await expect(create.getByRole('alert')).toBeInViewport();
  await expect(create.getByLabel('名稱')).toHaveValue('工作');
  await expect(create.getByRole('button', { name: '儲存', exact: true })).toBeEnabled();
  expect(await calendarNames(page)).toEqual(base);
  expect(await cachedCalendarNames(page)).toEqual(base);

  await failTable(page, 'calendars', false);
  await create.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(create).toHaveCount(0);
  expect(await calendarNames(page)).toEqual([...base, '工作']);
  expect(await cachedCalendarNames(page)).toEqual([...base, '工作']);

  await page.locator('.cal-manage-open', { hasText: '工作' }).click();
  const edit = page.getByRole('dialog', { name: '編輯日曆', exact: true });
  // Deletion is one RPC since DP-138, so that is the request refused here.
  await failTable(page, DELETE_RPC, true);
  await edit.getByRole('button', { name: '刪除此日曆', exact: true }).click();
  await expect(edit.getByRole('alert')).toContainText('尚未確認刪除；請先確認資料再重試。');
  await expect(edit.getByRole('alert')).toBeInViewport();
  await expect(edit.getByRole('button', { name: '刪除此日曆', exact: true })).toBeEnabled();
  expect(await calendarNames(page)).toEqual([...base, '工作']);
  expect(await cachedCalendarNames(page)).toEqual([...base, '工作']);

  await failTable(page, DELETE_RPC, false);
  await edit.getByRole('button', { name: '刪除此日曆', exact: true }).click();
  await expect(edit).toHaveCount(0);
  expect(await calendarNames(page)).toEqual(base);
  expect(await cachedCalendarNames(page)).toEqual(base);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  clean();
});

test('帳號刪除預設日曆：內容跟著搬到倖存的日曆，並由它成為新的預設', async ({ page }) => {
  // DP-138. As separate requests this could never finish: promoting the
  // survivor while the old default still existed broke the one-default index.
  const clean = monitorBrowser(page);
  await signIn(page);
  const [original] = await calendarNames(page);

  await page.getByRole('button', { name: '＋ 新增日曆' }).click();
  const create = page.getByRole('dialog', { name: '新增日曆', exact: true });
  await create.getByLabel('名稱').fill('家庭');
  await create.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(create).toHaveCount(0);

  // An event on the calendar that is about to go.
  await tabButton(page, '日曆').click();
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '新增行程', exact: true });
  await sheet.getByLabel('標題').fill('預設日曆上的行程');
  await sheet.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(sheet).toHaveCount(0);

  await tabButton(page, '設定').click();
  await page.locator('.cal-manage-open', { hasText: original! }).click();
  const edit = page.getByRole('dialog', { name: '編輯日曆', exact: true });
  await expect(edit).toContainText('會移到「家庭」');
  await edit.getByRole('button', { name: '刪除此日曆', exact: true }).click();
  await expect(edit).toHaveCount(0);

  expect(await calendarNames(page)).toEqual(['家庭']);
  const cached = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).data, KEY);
  expect(cached.calendars.map((calendar: { name: string; isDefault: boolean }) => [calendar.name, calendar.isDefault])).toEqual([['家庭', true]]);
  expect(cached.events.map((event: { title: string }) => event.title)).toEqual(['預設日曆上的行程']);
  expect(cached.events[0].calendarId).toBe(cached.calendars[0].id);
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();
  clean();
});
