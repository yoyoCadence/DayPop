import { expect, test } from '@playwright/test';
import { agendaRow, calendarViewButton, monitorBrowser, openApp, reloadApp } from './support';

const NOW = new Date('2026-08-12T00:00:00.000Z');

test('中文時刻草稿先確認，取消不保存；中文／全形時間可保存及 reload', async ({ page }) => {
  const clean = monitorBrowser(page);
  await page.clock.install({ time: NOW });
  await openApp(page);
  console.log('DP-075 browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  const quick = page.getByRole('textbox', { name: '快速新增', exact: true });
  const raw = () => page.evaluate(() => localStorage.getItem('daypop.user-data'));
  const before = await raw();
  await quick.fill('每週 明天下午三點半 開會 @３０１教室');
  await quick.press('Enter');
  let dialog = page.getByRole('dialog', { name: '新增行程' });
  await expect(dialog.getByLabel('標題')).toHaveValue('開會');
  await expect(dialog.getByLabel('日期')).toHaveValue('2026-08-13');
  await expect(dialog.getByLabel('開始')).toHaveValue('15:30');
  await expect(dialog.getByLabel('結束')).toHaveValue('16:30');
  await expect(dialog.getByLabel('重複')).toHaveValue('weekly');
  await expect(dialog.getByLabel('地點')).toHaveValue('３０１教室');
  expect(await raw()).toBe(before);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(await raw()).toBe(before);

  await quick.fill('明天下午三點半 第３次 開會 @３０１教室');
  await quick.press('Enter');
  dialog = page.getByRole('dialog', { name: '新增行程' });
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await quick.fill('明天下午３：４５ 全形會議');
  await quick.press('Enter');
  await expect(dialog.getByLabel('開始')).toHaveValue('15:45');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await reloadApp(page);
  await calendarViewButton(page, '列表').click();
  await agendaRow(page, '第３次 開會').click();
  dialog = page.getByRole('dialog', { name: '編輯行程' });
  await expect(dialog.getByLabel('開始')).toHaveValue('15:30');
  await expect(dialog.getByLabel('結束')).toHaveValue('16:30');
  await expect(dialog.getByLabel('地點')).toHaveValue('３０１教室');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await agendaRow(page, '全形會議').click();
  await expect(dialog.getByLabel('開始')).toHaveValue('15:45');
  clean();
});

test('只有中文時間可用預設標題保存；無效／相對時刻保留文字供確認', async ({ page }) => {
  const clean = monitorBrowser(page);
  await page.clock.install({ time: NOW });
  await openApp(page);
  const quick = page.getByRole('textbox', { name: '快速新增', exact: true });
  const dialog = page.getByRole('dialog', { name: '新增行程' });
  await quick.fill('明天下午三點');
  await quick.press('Enter');
  await expect(dialog.getByLabel('標題')).toHaveValue('');
  await expect(dialog.getByLabel('開始')).toHaveValue('15:00');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  for (const text of ['下午二十五點 開會', '下午三點差十分 開會']) {
    await quick.fill(`明天${text}`);
    await quick.press('Enter');
    await expect(dialog.getByLabel('標題')).toHaveValue(text);
    await expect(dialog.getByLabel('開始')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
  await reloadApp(page);
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, '新事件')).toHaveCount(1);
  await expect(agendaRow(page, '開會')).toHaveCount(0);
  await agendaRow(page, '新事件').click();
  const saved = page.getByRole('dialog', { name: '編輯行程' });
  await expect(saved.getByLabel('日期')).toHaveValue('2026-08-13');
  await expect(saved.getByLabel('開始')).toHaveValue('15:00');
  clean();
});
