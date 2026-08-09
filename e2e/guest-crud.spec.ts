import { expect, test } from '@playwright/test';
import {
  agendaRow,
  calendarViewButton,
  localTodayKey,
  monitorBrowser,
  openApp,
  reloadApp,
} from './support';

test('遊客可完成 event CRUD、todo toggle/delete，且重新載入仍一致', async ({ page }) => {
  const assertCleanBrowser = monitorBrowser(page);
  await openApp(page);
  const todayKey = await localTodayKey(page);

  await page.getByRole('button', { name: '新增', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '新增行程' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('標題').fill('Playwright 行程');
  await dialog.getByLabel('日期').fill(todayKey);
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();

  await calendarViewButton(page, '列表').click();
  let eventRow = agendaRow(page, 'Playwright 行程');
  await expect(eventRow).toHaveCount(1);
  await eventRow.click();

  dialog = page.getByRole('dialog', { name: '編輯行程' });
  await dialog.getByLabel('標題').fill('Playwright 行程（已更新）');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  eventRow = agendaRow(page, 'Playwright 行程（已更新）');
  await expect(eventRow).toHaveCount(1);

  await reloadApp(page);
  await calendarViewButton(page, '列表').click();
  eventRow = agendaRow(page, 'Playwright 行程（已更新）');
  await expect(eventRow).toHaveCount(1);
  await eventRow.click();
  dialog = page.getByRole('dialog', { name: '編輯行程' });
  await dialog.getByRole('button', { name: '刪除事件', exact: true }).click();
  await expect(agendaRow(page, 'Playwright 行程（已更新）')).toHaveCount(0);

  await page.getByRole('button', { name: '新增', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '新增行程' });
  await dialog
    .getByRole('group', { name: '新增類型' })
    .getByRole('button', { name: '待辦', exact: true })
    .click();
  dialog = page.getByRole('dialog', { name: '新增待辦' });
  await dialog.getByLabel('標題').fill('Playwright 待辦');
  await dialog.getByLabel('日期').fill(todayKey);
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();

  let todoRow = agendaRow(page, 'Playwright 待辦');
  await expect(todoRow).toHaveCount(1);
  await todoRow.click();
  await expect(todoRow.locator('.cal-agenda-title')).toHaveCSS(
    'text-decoration-line',
    'line-through',
  );

  await reloadApp(page);
  await calendarViewButton(page, '列表').click();
  todoRow = agendaRow(page, 'Playwright 待辦');
  await expect(todoRow).toHaveCount(1);
  await expect(todoRow.locator('.cal-agenda-title')).toHaveCSS(
    'text-decoration-line',
    'line-through',
  );

  await calendarViewButton(page, '月').click();
  const todayCell = page.locator('[aria-label^="' + todayKey + '，"]');
  await expect(todayCell).toHaveCount(1);
  await todayCell.click();
  const dayDialog = page.locator('.cal-day-sheet');
  await expect(dayDialog).toBeVisible();
  await dayDialog.getByRole('button', { name: '刪除 Playwright 待辦' }).click();
  await dayDialog.getByRole('button', { name: '完成', exact: true }).click();

  await reloadApp(page);
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, 'Playwright 待辦')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('daypop.user-data')))
    .not.toBeNull();
  assertCleanBrowser();
});
