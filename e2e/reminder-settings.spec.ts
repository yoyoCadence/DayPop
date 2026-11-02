import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { monitorBrowser, tabButton } from './support';
import { enableReminder, reminderDialog, reminderLogin, reminderReceipts, reminderToggle, REMINDER_ACCOUNT, REMINDER_CALENDAR, type ReminderHarnessWindow } from './reminder-support';

test('提醒須直接同意；日曆規則、換頁與停用不改個人資料', async ({ page }) => {
  const clean = monitorBrowser(page); await reminderLogin(page);
  await expect(page.getByText('左右滑動翻頁', { exact: true })).toHaveCount(0);
  await expect(page.getByText('月曆頁首的顯示方式圖示可切換「連續捲動／單月翻頁」；單月模式可左右滑動換月。', { exact: true })).toBeVisible();
  const personal = await page.evaluate(id => localStorage.getItem('daypop.account-cache.' + id), REMINDER_ACCOUNT);
  expect(await page.evaluate(() => (window as ReminderHarnessWindow).__daypopReminderHarness!.stats.consents)).toBe(0);
  await enableReminder(page);
  expect(await page.evaluate(() => (window as ReminderHarnessWindow).__daypopReminderHarness!.stats.activation)).toEqual([true]);
  await page.locator('.reminder-calendar-row').click(); const dialog = reminderDialog(page);
  await expect(dialog.getByLabel('開啟這本日曆的提醒')).not.toBeChecked(); await dialog.getByLabel('開啟這本日曆的提醒').check();
  await dialog.getByLabel('提前幾分鐘', { exact: false }).fill('10,0');
  await dialog.getByLabel('全天事項與待辦的時刻').fill('08:30'); await dialog.getByLabel('日期事項的時區').selectOption('America/New_York');
  await dialog.getByLabel('同時提醒有日期且尚未完成的待辦').check(); await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toBeHidden(); await expect(page.locator('.reminder-calendar-row')).toContainText('0、10 分鐘前');
  await tabButton(page, '日曆').click(); await tabButton(page, '設定').click(); await expect(reminderToggle(page)).toHaveAttribute('aria-pressed', 'true');
  await reminderToggle(page).click(); await expect(reminderToggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => reminderReceipts(page)).toEqual([]);
  expect(await page.evaluate(id => localStorage.getItem('daypop.account-cache.' + id), REMINDER_ACCOUNT)).toBe(personal);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('daypop.reminder-device.')).some(k => /endpoint|auth|p256dh/.test(localStorage.getItem(k)!)))).toBe(false);
  clean();
});

test('未知註冊可明確重試；登出後晚到 lease 仍清理原帳號', async ({ page }) => {
  const clean = monitorBrowser(page); await reminderLogin(page);
  await page.evaluate(() => { (window as ReminderHarnessWindow).__daypopReminderHarness!.loseNextRegistrationResponse = true; });
  await reminderToggle(page).click(); await expect.poll(async () => (await reminderReceipts(page))[0]?.phase).toBe('unconfirmed');
  await expect(reminderToggle(page)).toBeEnabled(); await enableReminder(page);
  expect(await page.evaluate(id => (window as ReminderHarnessWindow).__daypopReminderHarness!.devices.get(id)?.size, REMINDER_ACCOUNT)).toBe(1);
  await reminderToggle(page).click(); await expect.poll(() => reminderReceipts(page)).toEqual([]);
  await page.evaluate(() => { (window as ReminderHarnessWindow).__daypopReminderHarness!.holdRegistration = true; });
  await reminderToggle(page).click(); await expect.poll(() => page.evaluate(() => (window as ReminderHarnessWindow).__daypopReminderHarness!.stats.registrations)).toBe(3);
  await page.getByRole('button', { name: '登出', exact: true }).click(); await expect(page.getByRole('button', { name: '通知設定', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as ReminderHarnessWindow).__daypopReminderHarness!.releaseRegistrations(); });
  await expect.poll(() => reminderReceipts(page)).toEqual([]);
  expect(await page.evaluate(id => (window as ReminderHarnessWindow).__daypopReminderHarness!.devices.get(id)?.size, REMINDER_ACCOUNT)).toBe(0);
  await tabButton(page, '設定').click(); await expect(page.getByText('目前是遊客模式', { exact: true })).toBeVisible();
  await expect(reminderToggle(page)).toBeDisabled(); await expect(page.getByRole('button', { name: '通知設定', exact: true })).toBeHidden(); clean();
});

test('後端、拒絕權限、主畫面與舊 worker 狀態不顯示假成功', async ({ page }) => {
  const clean = monitorBrowser(page); await reminderLogin(page);
  await page.evaluate(() => { (window as ReminderHarnessWindow).__daypopReminderHarness!.capabilities.enabled = false; });
  await page.getByRole('button', { name: '重新確認提醒', exact: true }).click(); await expect(page.getByText('背景提醒尚未啟用，請稍後再試。', { exact: true })).toBeVisible(); await expect(reminderToggle(page)).toBeDisabled();
  await page.evaluate(() => { const h = (window as ReminderHarnessWindow).__daypopReminderHarness!; h.capabilities.enabled = true; h.installRequired = true; });
  await page.getByRole('button', { name: '重新確認提醒', exact: true }).click(); await expect(page.getByText('請先將日蹦加入主畫面，並從主畫面開啟後設定通知。', { exact: true })).toBeVisible();
  await page.evaluate(() => { const h = (window as ReminderHarnessWindow).__daypopReminderHarness!; h.installRequired = false; h.permission = 'denied'; });
  await page.getByRole('button', { name: '重新確認提醒', exact: true }).click(); await expect(page.getByText('通知權限已被拒絕，請先在系統設定調整。', { exact: true })).toBeVisible();
  await page.evaluate(() => { const h = (window as ReminderHarnessWindow).__daypopReminderHarness!; h.permission = 'default'; h.workerReady = false; });
  await page.getByRole('button', { name: '重新確認提醒', exact: true }).click(); await expect(page.getByRole('button', { name: '完成 App 更新', exact: true })).toBeVisible();
  await expect(reminderToggle(page)).toBeDisabled(); expect(await page.evaluate(() => (window as ReminderHarnessWindow).__daypopReminderHarness!.stats.consents)).toBe(0);
  expect(await reminderReceipts(page)).toEqual([]); clean();
});

test('future 收據與 quota 在請求同意之前阻擋，原資料與 future bytes 不變', async ({ page }) => {
  const clean = monitorBrowser(page); await reminderLogin(page);
  const personal = await page.evaluate(id => localStorage.getItem('daypop.account-cache.' + id), REMINDER_ACCOUNT);
  const future = await page.evaluate(() => {
    const scope = new URL('/', location.href).href, key = 'daypop.reminder-device.' + encodeURIComponent(scope) + '.00000000-0000-4000-8000-000000000999';
    localStorage.setItem(key, '{"version":2,"kept":"sentinel"}'); window.dispatchEvent(new StorageEvent('storage', { key })); return key;
  });
  await expect(reminderToggle(page)).toBeDisabled(); await expect(page.getByText('裝置通知資料來自較新版本，請先更新日蹦。', { exact: true })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), future)).toBe('{"version":2,"kept":"sentinel"}');
  await page.evaluate(key => { localStorage.removeItem(key); window.dispatchEvent(new StorageEvent('storage', { key })); }, future); await expect(reminderToggle(page)).toBeEnabled();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key.startsWith('daypop.reminder-device.')) throw new DOMException('synthetic quota', 'QuotaExceededError'); original.call(this, key, value); };
  });
  await reminderToggle(page).click(); await expect(reminderToggle(page)).toBeDisabled();
  expect(await page.evaluate(() => (window as ReminderHarnessWindow).__daypopReminderHarness!.stats.consents)).toBe(0);
  expect(await page.evaluate(id => localStorage.getItem('daypop.account-cache.' + id), REMINDER_ACCOUNT)).toBe(personal);
  await expect(page.getByText(/本機儲存|無法安全保存|儲存空間/).first()).toBeVisible(); clean();
});

test('提醒表單保留失敗輸入與 CAS，雙邊停用失敗可恢復且長表單可操作', async ({ page }, info) => {
  const clean = monitorBrowser(page); await reminderLogin(page); await enableReminder(page);
  if (info.project.name === 'mobile-chrome') await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => { (window as ReminderHarnessWindow).__daypopReminderHarness!.loseNextRuleResponse = true; });
  await page.locator('.reminder-calendar-row').click(); const dialog = reminderDialog(page);
  await dialog.getByLabel('開啟這本日曆的提醒').check(); await dialog.getByLabel('提前幾分鐘', { exact: false }).fill('10');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click(); await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('提前幾分鐘', { exact: false })).toHaveValue('10');
  await page.evaluate(({ userId, calendarId }) => { (window as ReminderHarnessWindow).__daypopReminderHarness!.changeRuleElsewhere(userId, calendarId, [20]); }, { userId: REMINDER_ACCOUNT, calendarId: REMINDER_CALENDAR });
  await dialog.getByLabel('提前幾分鐘', { exact: false }).fill('45'); await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('已變更'); await expect(dialog.getByLabel('提前幾分鐘', { exact: false })).toHaveValue('45');
  await dialog.getByRole('button', { name: '重新載入已保存設定', exact: true }).click(); await expect(dialog.getByLabel('提前幾分鐘', { exact: false })).toHaveValue('20');
  await dialog.getByLabel('提前幾分鐘', { exact: false }).fill('45'); await dialog.getByRole('button', { name: '儲存', exact: true }).click(); await expect(dialog).toBeHidden();
  await expect(page.locator('.reminder-calendar-row')).toBeFocused();
  await page.evaluate(() => { const h = (window as ReminderHarnessWindow).__daypopReminderHarness!; h.failLocalRemoval = true; h.failServerRemoval = true; });
  await reminderToggle(page).click(); await expect(page.getByRole('button', { name: '停用這台裝置並確認', exact: true })).toBeVisible(); await expect(reminderToggle(page)).toBeDisabled();
  await page.evaluate(() => { const h = (window as ReminderHarnessWindow).__daypopReminderHarness!; h.failLocalRemoval = false; h.failServerRemoval = false; });
  await page.getByRole('button', { name: '停用這台裝置並確認', exact: true }).click(); await expect.poll(() => reminderReceipts(page)).toEqual([]);
  await expect(page.locator('.reminder-calendar-row')).toContainText('45 分鐘前');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.locator('.dp-texture').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLElement).style.visibility = 'hidden'; }));
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze(); expect(audit.violations).toEqual([]);
  await page.locator('.dp-texture').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLElement).style.visibility = ''; })); clean();
});

for (const name of ['漫畫', '極簡', '暖陽', '商務', '鮮活', '像素']) test(`提醒表單在${name}淺深色保留焦點及可讀性`, async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-chrome', 'The shared palette matrix runs once; desktop geometry is covered above.');
  const clean = monitorBrowser(page); await reminderLogin(page);
  await page.locator('.dp-theme-card').filter({ has: page.locator('.dp-theme-name').filter({ hasText: name }) }).click();
    for (const mode of ['☀ 淺色', '☾ 深色']) {
      await page.getByRole('button', { name: mode, exact: true }).click(); await page.locator('.reminder-calendar-row').click();
      const dialog = reminderDialog(page); await dialog.getByLabel('開啟這本日曆的提醒').check();
      await page.locator('.dp-texture').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLElement).style.visibility = 'hidden'; }));
      const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(audit.violations, name + ' / ' + mode).toEqual([]);
      expect(audit.passes.find(row => row.id === 'color-contrast')?.nodes.length ?? 0).toBeGreaterThanOrEqual(5);
      await page.locator('.dp-texture').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLElement).style.visibility = ''; }));
      await dialog.getByRole('button', { name: '取消', exact: true }).click(); await expect(page.locator('.reminder-calendar-row')).toBeFocused();
    }
  clean();
});
