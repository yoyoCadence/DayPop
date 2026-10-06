import { expect, test, type Page } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD, monitorBrowser, openApp, tabButton } from './support';

const DATE = '2026-09-30';
const KEY = 'daypop.account-cache.00000000-0000-4000-8000-000000000030';
const DELETE_RPC = 'delete_event_with_attachment_cleanup';
test.use({ timezoneId: 'America/New_York' });

async function signIn(page: Page) {
  await page.clock.setFixedTime(new Date('2026-09-30T04:00:00.000Z'));
  await openApp(page, '/e2e/auth.html');
  console.log('DP-134 actual browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'display: Asia/Taipei');
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

// The already loaded dev-only module owns this synthetic account. It is outside
// the production graph; no cloud credentials or user rows are involved.
const FAKE_MODULE = '/src/test/e2eAuthMain.tsx';

async function failRpc(page: Page, name: string, enabled: boolean) {
  await page.evaluate(async ({ path, name, enabled }) => {
    const { fakeSupabase } = await import(path);
    if (enabled) fakeSupabase.failures.set(`rpc:${name}`, 'DP-134 測試連線失敗');
    else fakeSupabase.failures.delete(`rpc:${name}`);
  }, { path: FAKE_MODULE, name, enabled });
}

/** Commits the deletion on the fake server, then loses its response. */
async function loseDeleteResponse(page: Page, enabled: boolean) {
  await page.evaluate(async ({ path, name, enabled }) => {
    const { fakeSupabase } = await import(path);
    if (!enabled) {
      delete fakeSupabase.rpc;
      return;
    }
    const committed = fakeSupabase.rpc.bind(fakeSupabase);
    fakeSupabase.rpc = async (rpc: string, args: Record<string, unknown>) => {
      const result = await committed(rpc, args);
      if (rpc === name) throw new Error('DP-134 回應遺失');
      return result;
    };
  }, { path: FAKE_MODULE, name: DELETE_RPC, enabled });
}

const rpcCount = (page: Page, name: string) => page.evaluate(async ({ path, name }) => {
  const { fakeSupabase } = await import(path);
  return fakeSupabase.rpcCalls.filter((call: { name: string }) => call.name === name).length;
}, { path: FAKE_MODULE, name });

const serverEvents = (page: Page) => page.evaluate(async (path) => {
  const { fakeSupabase } = await import(path);
  return fakeSupabase.rows('events').length;
}, FAKE_MODULE);

const cacheBytes = (page: Page) => page.evaluate((key) => localStorage.getItem(key), KEY);

async function createEvent(page: Page, title: string, repeat: 'none' | 'daily') {
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新增行程', exact: true });
  await create.getByLabel('標題').fill(title);
  await create.getByLabel('日期', { exact: true }).fill(DATE);
  await create.getByLabel('重複', { exact: true }).selectOption(repeat);
  await create.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(create).toHaveCount(0);
}

test('帳號刪除失敗或回應遺失時保留編輯畫面與快取，明確重試後才移除行程', async ({ page }) => {
  const clean = monitorBrowser(page);
  await signIn(page);
  await createEvent(page, '整理書桌', 'none');
  await page.getByRole('button', { name: `${DATE}，1 個行程`, exact: true }).click();
  const day = page.getByRole('dialog', { name: '9月30日 週三', exact: true });
  await day.getByRole('button').filter({ hasText: '整理書桌' }).click();
  const edit = page.getByRole('dialog', { name: '編輯行程', exact: true });
  await edit.getByLabel('標題').fill('未保存的標題');
  const confirmed = await cacheBytes(page);

  await failRpc(page, DELETE_RPC, true);
  await edit.getByRole('button', { name: '刪除事件', exact: true }).click();
  await expect(edit.getByRole('alert')).toContainText('尚未確認刪除，草稿已保留');
  await expect(edit.getByRole('alert')).toBeInViewport();
  await expect(edit.getByLabel('標題')).toHaveValue('未保存的標題');
  await expect(edit.getByRole('button', { name: '刪除事件', exact: true })).toBeEnabled();
  expect(await cacheBytes(page)).toBe(confirmed);
  expect(await serverEvents(page)).toBe(1);
  await failRpc(page, DELETE_RPC, false);

  // The server deletes the row but the answer never arrives: the screen keeps
  // the last confirmed state, and the explicit retry receives `false`.
  await loseDeleteResponse(page, true);
  await edit.getByRole('button', { name: '刪除事件', exact: true }).click();
  await expect(edit.getByRole('alert')).toContainText('尚未確認刪除，草稿已保留');
  expect(await serverEvents(page)).toBe(0);
  expect(await cacheBytes(page)).toBe(confirmed);
  await loseDeleteResponse(page, false);
  await edit.getByRole('button', { name: '刪除事件', exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(day.getByRole('button').filter({ hasText: '整理書桌' })).toHaveCount(0);
  expect(JSON.parse((await cacheBytes(page))!).data.events).toHaveLength(0);
  expect(await rpcCount(page, DELETE_RPC)).toBe(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  clean();
});

for (const scope of ['this', 'all'] as const) {
  test(`帳號重複${scope === 'this' ? '只刪這一次' : '刪除全部'}失敗後保留編輯畫面，重試重新確認範圍`, async ({ page }) => {
    const clean = monitorBrowser(page);
    await signIn(page);
    await createEvent(page, '每日伸展', 'daily');
    await page.getByRole('button', { name: '2026-10-01，1 個行程', exact: true }).click();
    const day = page.getByRole('dialog', { name: '10月1日 週四', exact: true });
    await day.getByRole('button').filter({ hasText: '每日伸展' }).click();
    const edit = page.getByRole('dialog', { name: '編輯行程', exact: true });
    const before = await cacheBytes(page);
    const rpc = scope === 'this' ? 'cancel_event_occurrence' : DELETE_RPC;
    const label = scope === 'this' ? '只刪這一次' : '刪除全部';
    await failRpc(page, rpc, true);
    await edit.getByRole('button', { name: '刪除事件', exact: true }).click();
    const choose = page.getByRole('dialog', { name: '刪除重複事件', exact: true });
    await choose.getByRole('button', { name: label, exact: true }).click();
    await expect(choose).toHaveCount(0);
    await expect(edit.getByRole('alert')).toContainText('尚未確認刪除，草稿已保留');
    await expect(edit.getByRole('alert')).toBeInViewport();
    await expect(edit.getByLabel('日期', { exact: true })).toHaveValue('2026-10-01');
    expect(await cacheBytes(page)).toBe(before);
    await failRpc(page, rpc, false);
    await edit.getByRole('button', { name: '刪除事件', exact: true }).click();
    await expect(choose).toBeVisible();
    await choose.getByRole('button', { name: label, exact: true }).click();
    await expect(edit).toHaveCount(0);
    await expect(day.getByRole('button').filter({ hasText: '每日伸展' })).toHaveCount(0);
    const saved = JSON.parse((await cacheBytes(page))!).data;
    expect(saved.events).toHaveLength(scope === 'this' ? 1 : 0);
    expect(saved.eventExceptions).toHaveLength(scope === 'this' ? 1 : 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    clean();
  });
}
