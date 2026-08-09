import { expect, test } from '@playwright/test';
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

test('登入後可使用 authenticated repository 與附件完整流程', async ({ page }) => {
  const assertCleanBrowser = monitorBrowser(page);
  await page.addInitScript(() => {
    const clickedDownloads: string[] = [];
    Object.defineProperty(window, '__daypopE2EDownloads', {
      value: clickedDownloads,
      configurable: false,
    });
    const nativeClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      if (this.href.startsWith('https://storage.test/')) {
        clickedDownloads.push(this.href);
        return;
      }
      nativeClick.call(this);
    };
  });

  await openApp(page, '/e2e/auth.html');
  await tabButton(page, '設定').click();
  await page.getByRole('button', { name: '登入／註冊', exact: true }).click();
  const authDialog = page.getByRole('dialog', { name: '保存你的日蹦資料' });
  await authDialog.getByLabel('Email').fill(E2E_EMAIL);
  await authDialog.getByLabel('密碼').fill(E2E_PASSWORD);
  await authDialog.getByRole('button', { name: '登入', exact: true }).click();

  await tabButton(page, '設定').click();
  await expect(page.getByText('帳號已登入', { exact: true })).toBeVisible();
  await expect(page.getByText(E2E_EMAIL, { exact: false })).toBeVisible();
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();

  await tabButton(page, '日曆').click();
  const todayKey = await localTodayKey(page);
  await page.getByRole('button', { name: '新增', exact: true }).click();
  let eventDialog = page.getByRole('dialog', { name: '新增行程' });
  await eventDialog.getByLabel('標題').fill('Authenticated 附件行程');
  await eventDialog.getByLabel('日期').fill(todayKey);
  await eventDialog.getByRole('button', { name: '儲存', exact: true }).click();

  await calendarViewButton(page, '列表').click();
  const eventRow = agendaRow(page, 'Authenticated 附件行程');
  await expect(eventRow).toHaveCount(1);
  await eventRow.click();
  eventDialog = page.getByRole('dialog', { name: '編輯行程' });
  const fileInput = eventDialog.locator('input[type="file"]');
  await expect(fileInput).toHaveCount(1);
  await fileInput.setInputFiles('e2e/fixtures/e2e-note.txt');
  await expect(eventDialog.getByRole('status')).toContainText('附件已安全保存');

  let attachmentRow = eventDialog.locator('.cal-attachment-list li').filter({
    hasText: 'e2e-note.txt',
  });
  await expect(attachmentRow).toHaveCount(1);
  await attachmentRow.getByRole('button', { name: '下載', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __daypopE2EDownloads?: string[];
            }
          ).__daypopE2EDownloads ?? [],
      ),
    )
    .toHaveLength(1);
  const signedUrl = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __daypopE2EDownloads?: string[];
        }
      ).__daypopE2EDownloads?.[0],
  );
  expect(signedUrl).toContain('https://storage.test/event-attachments/');
  expect(signedUrl).toContain('?signed=1');

  await attachmentRow.getByRole('button', { name: '刪除', exact: true }).click();
  await expect(eventDialog.getByRole('status')).toContainText('附件已刪除');
  attachmentRow = eventDialog.locator('.cal-attachment-list li').filter({
    hasText: 'e2e-note.txt',
  });
  await expect(attachmentRow).toHaveCount(0);
  await eventDialog.getByRole('button', { name: '取消', exact: true }).click();

  await tabButton(page, '設定').click();
  await page.getByRole('button', { name: '登出', exact: true }).click();
  await tabButton(page, '設定').click();
  await expect(page.getByText('目前是遊客模式', { exact: true })).toBeVisible();

  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, 'Authenticated 附件行程')).toHaveCount(0);
  assertCleanBrowser();
});
