import { expect, test, type Page } from '@playwright/test';
import {
  E2E_EMAIL,
  E2E_PASSWORD,
  agendaRow,
  calendarViewButton,
  localTodayKey,
  monitorBrowser,
  openApp,
  tabButton,
} from './support';

const KEY = 'daypop.account-cache.00000000-0000-4000-8000-000000000030';
const DELETE_RPC = 'delete_event_attachment_with_cleanup';
// The already loaded dev-only module owns this synthetic account. It is outside
// the production graph; no cloud credentials or user rows are involved.
const FAKE_MODULE = '/src/test/e2eAuthMain.tsx';

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
      if (rpc === name) throw new Error('DP-135 回應遺失');
      return result;
    };
  }, { path: FAKE_MODULE, name: DELETE_RPC, enabled });
}

const server = (page: Page) => page.evaluate(async ({ path, name }) => {
  const { fakeSupabase } = await import(path);
  return {
    metadata: fakeSupabase.rows('event_attachments').length,
    cleanupJobs: fakeSupabase.rows('attachment_cleanup_jobs').length,
    objects: fakeSupabase.objects.size,
    deleteCalls: fakeSupabase.rpcCalls.filter((call: { name: string }) => call.name === name).length,
  };
}, { path: FAKE_MODULE, name: DELETE_RPC });

const cachedAttachments = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).data.eventAttachments.length as number, KEY);

test('帳號附件刪除後回應遺失時保留清單與快取，明確重試後才移除', async ({ page }) => {
  const clean = monitorBrowser(page);
  await openApp(page, '/e2e/auth.html');
  await tabButton(page, '設定').click();
  await page.getByRole('button', { name: '登入／註冊', exact: true }).click();
  const auth = page.getByRole('dialog', { name: '保存你的日蹦資料' });
  await auth.getByLabel('Email').fill(E2E_EMAIL);
  await auth.getByLabel('密碼', { exact: true }).fill(E2E_PASSWORD);
  await auth.getByRole('button', { name: '登入', exact: true }).click();
  await tabButton(page, '設定').click();
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();

  await tabButton(page, '日曆').click();
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新增行程', exact: true });
  await create.getByLabel('標題').fill('附件回應遺失');
  await create.getByLabel('日期', { exact: true }).fill(await localTodayKey(page));
  await create.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(create).toHaveCount(0);

  await calendarViewButton(page, '列表').click();
  await agendaRow(page, '附件回應遺失').click();
  const edit = page.getByRole('dialog', { name: '編輯行程', exact: true });
  await edit.locator('input[type="file"]').setInputFiles('e2e/fixtures/e2e-note.txt');
  await expect(edit.getByRole('status')).toContainText('附件已安全保存');
  const row = edit.locator('.cal-attachment-list li').filter({ hasText: 'e2e-note.txt' });
  await expect(row).toHaveCount(1);
  expect(await cachedAttachments(page)).toBe(1);

  // The server deletes the metadata but the answer never arrives: the list and
  // cache keep the last confirmed state.
  await loseDeleteResponse(page, true);
  await row.getByRole('button', { name: '刪除', exact: true }).click();
  await expect(edit.getByRole('status')).toContainText('DP-135 回應遺失');
  await expect(row).toHaveCount(1);
  expect(await cachedAttachments(page)).toBe(1);
  expect(await server(page)).toEqual({ metadata: 0, cleanupJobs: 1, objects: 1, deleteCalls: 1 });

  // The explicit retry receives `false`, which still means the row is gone.
  await loseDeleteResponse(page, false);
  await row.getByRole('button', { name: '刪除', exact: true }).click();
  await expect(edit.getByRole('status')).toContainText('附件已刪除');
  await expect(row).toHaveCount(0);
  expect(await cachedAttachments(page)).toBe(0);
  expect(await server(page)).toEqual({ metadata: 0, cleanupJobs: 0, objects: 0, deleteCalls: 2 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  clean();
});
