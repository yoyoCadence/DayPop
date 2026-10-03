import { expect, test } from '@playwright/test';
import { agendaRow, calendarViewButton, monitorBrowser, openApp, reloadApp } from './support';

const NOW = new Date('2026-08-12T00:00:00.000Z');

test('事件使用自己的時區，選擇新時區保留日期／時鐘，取消不寫入且 reload 保存', async ({ page }) => {
  const clean = monitorBrowser(page);
  await page.clock.install({ time: NOW });
  await openApp(page);
  console.log('DP-111 browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  const raw = () => page.evaluate(() => localStorage.getItem('daypop.user-data')!);
  await page.getByRole('textbox', { name: '快速新增', exact: true }).fill('明天九點 東京會議');
  await page.getByRole('button', { name: '快速新增', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '新增行程' });
  await expect(dialog.getByLabel('時區', { exact: true })).toHaveValue('Asia/Taipei');
  await dialog.getByLabel('時區', { exact: true }).selectOption('Asia/Tokyo');
  await expect(dialog.getByLabel('開始')).toHaveValue('09:00');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  let data = JSON.parse(await raw()).data;
  expect(data.events[0].timezone).toBe('Asia/Tokyo');
  expect(data.events[0].startsAt).toBe('2026-08-13T00:00:00.000Z');
  expect(data.preferences.timezone).toBe('Asia/Taipei');

  await reloadApp(page);
  await calendarViewButton(page, '列表').click();
  let row = agendaRow(page, '東京會議');
  await expect(row).toContainText('08:00');
  await row.click();
  dialog = page.getByRole('dialog', { name: '編輯行程' });
  await expect(dialog.getByLabel('時區', { exact: true })).toHaveValue('Asia/Tokyo');
  await expect(dialog.getByLabel('開始')).toHaveValue('09:00');
  const before = await raw();
  await dialog.getByLabel('時區', { exact: true }).selectOption('UTC');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(await raw()).toBe(before);
  await row.click();
  await dialog.getByLabel('時區', { exact: true }).selectOption('UTC');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  data = JSON.parse(await raw()).data;
  expect(data.events[0].timezone).toBe('UTC');
  expect(data.events[0].startsAt).toBe('2026-08-13T09:00:00.000Z');
  expect(data.events[0].endsAt).toBe('2026-08-13T10:00:00.000Z');
  await reloadApp(page);
  await calendarViewButton(page, '列表').click();
  row = agendaRow(page, '東京會議');
  await expect(row).toContainText('17:00');
  await row.click();
  await expect(dialog.getByLabel('時區', { exact: true })).toHaveValue('UTC');
  await expect(dialog.getByLabel('日期')).toHaveValue('2026-08-13');
  await expect(dialog.getByLabel('開始')).toHaveValue('09:00');
  clean();
});

test('重複事件更換時區仍問單次／全部，保留系列錨點並可 reload', async ({ page }) => {
  const clean = monitorBrowser(page);
  await page.clock.install({ time: NOW });
  await openApp(page);
  const raw = () => page.evaluate(() => localStorage.getItem('daypop.user-data')!);
  for (const title of ['單次時區系列', '整個時區系列']) {
    await page.getByRole('textbox', { name: '快速新增', exact: true }).fill(`每週 今天九點 ${title}`);
    await page.getByRole('button', { name: '快速新增', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新增行程' });
    await dialog.getByLabel('時區', { exact: true }).selectOption('Asia/Tokyo');
    await dialog.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  await calendarViewButton(page, '列表').click();
  for (const [title, scope] of [['單次時區系列', '只改這一次'], ['整個時區系列', '套用全部']]) {
    await agendaRow(page, title!).first().click();
    const dialog = page.getByRole('dialog', { name: '編輯行程' });
    await dialog.getByLabel('時區', { exact: true }).selectOption('UTC');
    const before = await raw();
    await dialog.getByRole('button', { name: '儲存', exact: true }).click();
    const scopeDialog = page.getByRole('dialog', { name: '修改重複事件' });
    await expect(scopeDialog).toBeVisible();
    expect(await raw()).toBe(before);
    await scopeDialog.getByRole('button', { name: scope!, exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  await reloadApp(page);
  const data = JSON.parse(await raw()).data;
  expect(data.events).toHaveLength(3);
  const singleSeries = data.events.find((event: { title: string; recurrence: unknown }) => event.title === '單次時區系列' && event.recurrence);
  const replacement = data.events.find((event: { title: string; recurrence: unknown }) => event.title === '單次時區系列' && !event.recurrence);
  const wholeSeries = data.events.find((event: { title: string }) => event.title === '整個時區系列');
  expect(singleSeries.timezone).toBe('Asia/Tokyo');
  expect(singleSeries.startsAt).toBe('2026-08-12T00:00:00.000Z');
  expect(replacement.timezone).toBe('UTC');
  expect(replacement.startsAt).toBe('2026-08-12T09:00:00.000Z');
  expect(wholeSeries.timezone).toBe('UTC');
  expect(wholeSeries.startsAt).toBe('2026-08-12T09:00:00.000Z');
  expect(data.eventExceptions).toHaveLength(1);
  expect(data.eventExceptions[0].replacementEventId).toBe(replacement.id);
  expect(data.preferences.timezone).toBe('Asia/Taipei');
  clean();
});
