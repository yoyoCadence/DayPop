import { expect, test, type Page } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, monitorBrowser, openApp, tabButton } from './support';

const DATE = '2026-09-30';
const KEY = 'daypop.account-cache.00000000-0000-4000-8000-000000000030';
test.use({ timezoneId: 'America/New_York' });

async function signIn(page: Page) {
  await page.clock.setFixedTime(new Date('2026-09-30T04:00:00.000Z'));
  await openApp(page, '/e2e/auth.html');
  console.log('DP-133 actual browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'display: Asia/Taipei');
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

async function fail(page: Page, table: string, enabled: boolean, transport = false) {
  await page.evaluate(async ({ table, enabled, transport }) => {
    // The already loaded dev-only module owns this synthetic account. It is
    // outside the production graph; no cloud credentials or user rows involved.
    const path = '/src/test/e2eAuthMain.tsx';
    const { fakeSupabase } = await import(path);
    const failures = transport ? fakeSupabase.rejections : fakeSupabase.failures;
    if (enabled) failures.set(table, 'DP-133 測試連線失敗');
    else failures.delete(table);
  }, { table, enabled, transport });
}

const cacheBytes = (page: Page) => page.evaluate((key) => localStorage.getItem(key), KEY);

test('帳號新增／編輯／新增待辦失敗保留草稿與快取，明確重試才保存', async ({ page }) => {
  const clean = monitorBrowser(page);
  await signIn(page);
  const guest = await page.evaluate(() => localStorage.getItem('daypop.user-data'));
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '新增行程', exact: true });
  await sheet.getByLabel('標題').fill('規劃旅行');
  await sheet.getByLabel('日期', { exact: true }).fill(DATE);
  await sheet.getByLabel('開始', { exact: true }).fill('11:00');
  await sheet.getByLabel('結束', { exact: true }).fill('12:00');
  await sheet.getByLabel('時區', { exact: true }).selectOption('Europe/London');
  await sheet.getByLabel('地點', { exact: true }).fill('圖書館');
  await sheet.getByLabel('備註', { exact: true }).fill('帶筆記本');
  const before = await cacheBytes(page);
  await fail(page, 'events', true, true);
  await sheet.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(sheet.getByRole('alert')).toContainText('草稿已保留');
  await expect(sheet.getByRole('alert')).toBeInViewport();
  await expect(sheet.getByLabel('標題')).toHaveValue('規劃旅行');
  await expect(sheet.getByLabel('日期', { exact: true })).toHaveValue(DATE);
  await expect(sheet.getByLabel('開始', { exact: true })).toHaveValue('11:00');
  await expect(sheet.getByLabel('時區', { exact: true })).toHaveValue('Europe/London');
  await expect(sheet.getByLabel('地點', { exact: true })).toHaveValue('圖書館');
  await expect(sheet.getByLabel('備註', { exact: true })).toHaveValue('帶筆記本');
  await expect(sheet.getByRole('button', { name: '儲存', exact: true })).toBeEnabled();
  expect(await cacheBytes(page)).toBe(before);
  await fail(page, 'events', false, true);
  await sheet.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  const saved = JSON.parse((await cacheBytes(page))!).data;
  expect(saved.events).toHaveLength(1);
  expect(saved.events[0]).toMatchObject({ title: '規劃旅行', location: '圖書館', notes: '帶筆記本', timezone: 'Europe/London' });

  await page.getByRole('button', { name: `${DATE}，1 個行程`, exact: true }).click();
  const day = page.getByRole('dialog', { name: '9月30日 週三', exact: true });
  await day.getByRole('button').filter({ hasText: '規劃旅行' }).click();
  const edit = page.getByRole('dialog', { name: '編輯行程', exact: true });
  await edit.getByLabel('標題').fill('旅行準備');
  const confirmed = await cacheBytes(page);
  await fail(page, 'events', true);
  await edit.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(edit.getByRole('alert')).toContainText('草稿已保留');
  await expect(edit.getByRole('alert')).toBeInViewport();
  expect(await cacheBytes(page)).toBe(confirmed);
  await fail(page, 'events', false);
  await edit.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(day.getByRole('button').filter({ hasText: '旅行準備' })).toBeVisible();
  expect(JSON.parse((await cacheBytes(page))!).data.events).toHaveLength(1);
  await day.getByRole('button', { name: '完成', exact: true }).click();

  await page.getByRole('button', { name: '新增', exact: true }).click();
  await page.getByRole('group', { name: '新增類型' }).getByRole('button', { name: '待辦', exact: true }).click();
  const todo = page.getByRole('dialog', { name: '新增待辦', exact: true });
  await todo.getByLabel('標題').fill('訂車票');
  const beforeTodo = await cacheBytes(page);
  await fail(page, 'todos', true);
  await todo.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(todo.getByRole('alert')).toContainText('草稿已保留');
  await expect(todo.getByRole('alert')).toBeInViewport();
  await expect(todo.getByLabel('標題')).toHaveValue('訂車票');
  expect(await cacheBytes(page)).toBe(beforeTodo);
  await fail(page, 'todos', false);
  await todo.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(todo).toHaveCount(0);
  expect(JSON.parse((await cacheBytes(page))!).data.todos).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(guest);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  clean();
});

for (const scope of ['this', 'all'] as const) {
  test(`帳號重複${scope === 'this' ? '單次' : '全部'}保存失敗後保留草稿與系列，重試重新確認範圍`, async ({ page }) => {
    const clean = monitorBrowser(page);
    await signIn(page);
    await page.getByRole('button', { name: '新增', exact: true }).click();
    const create = page.getByRole('dialog', { name: '新增行程', exact: true });
    await create.getByLabel('標題').fill('每日閱讀');
    await create.getByLabel('日期', { exact: true }).fill(DATE);
    await create.getByLabel('重複', { exact: true }).selectOption('daily');
    await create.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(create).toHaveCount(0);
    await page.getByRole('button', { name: '2026-10-01，1 個行程', exact: true }).click();
    const day = page.getByRole('dialog', { name: '10月1日 週四', exact: true });
    await day.getByRole('button').filter({ hasText: '每日閱讀' }).click();
    const edit = page.getByRole('dialog', { name: '編輯行程', exact: true });
    await edit.getByLabel('標題').fill('新的閱讀草稿');
    const before = await cacheBytes(page);
    const table = scope === 'this' ? 'rpc:replace_event_occurrence' : 'events';
    await fail(page, table, true);
    await edit.getByRole('button', { name: '儲存', exact: true }).click();
    const choose = page.getByRole('dialog', { name: '修改重複事件', exact: true });
    await choose.getByRole('button', { name: scope === 'this' ? '只改這一次' : '套用全部', exact: true }).click();
    await expect(choose).toHaveCount(0);
    await expect(edit.getByRole('alert')).toContainText('草稿已保留');
    await expect(edit.getByRole('alert')).toBeInViewport();
    await expect(edit.getByLabel('標題')).toHaveValue('新的閱讀草稿');
    await expect(edit.getByLabel('日期', { exact: true })).toHaveValue('2026-10-01');
    expect(await cacheBytes(page)).toBe(before);
    await fail(page, table, false);
    await edit.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(choose).toBeVisible();
    await choose.getByRole('button', { name: scope === 'this' ? '只改這一次' : '套用全部', exact: true }).click();
    await expect(edit).toHaveCount(0);
    await expect(day.getByRole('button').filter({ hasText: '新的閱讀草稿' })).toBeVisible();
    const saved = JSON.parse((await cacheBytes(page))!).data;
    expect(saved.events).toHaveLength(scope === 'this' ? 2 : 1);
    expect(saved.eventExceptions).toHaveLength(scope === 'this' ? 1 : 0);
    expect(saved.events[0].startsAt).toBe(JSON.parse(before!).data.events[0].startsAt);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    clean();
  });
}
