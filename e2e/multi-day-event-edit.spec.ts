import { expect, test, type Page } from '@playwright/test';
import { createEmptyUserData } from '../src/domain/types';
import { agendaRow, calendarViewButton, monitorBrowser, openApp, reloadApp } from './support';

async function setup(page: Page, fold = false) {
  const now = new Date(fold ? '2026-11-01T12:00:00.000Z' : '2026-08-12T00:00:00.000Z');
  await page.clock.install({ time: now });
  const data = createEmptyUserData({ now: now.toISOString() });
  data.preferences.timezone = fold ? 'America/New_York' : 'Asia/Taipei';
  data.preferences.petEnabled = false;
  data.events = [{
    id: '11200000-0000-4000-8000-000000000001', calendarId: data.calendars[0]!.id,
    title: fold ? '回撥時段' : '多日會議', allDay: false,
    startsAt: fold ? '2026-11-01T06:15:00.000Z' : '2026-08-13T01:00:13.000Z',
    endsAt: fold ? '2026-11-01T06:45:00.000Z' : '2026-08-15T02:00:37.000Z',
    timezone: data.preferences.timezone, location: null, notes: null, recurrence: null,
    reminderMinutes: [], sharingScope: 'inherit', createdAt: now.toISOString(), updatedAt: now.toISOString(),
  }];
  await page.addInitScript((data) => {
    if (!localStorage.getItem('daypop.user-data')) localStorage.setItem('daypop.user-data', JSON.stringify({
      schemaVersion: 4, revision: 0, updatedAt: data.events[0]!.createdAt, data,
    }));
  }, data);
  await openApp(page);
  console.log('DP-112 browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    'preferences:', data.preferences.timezone);
  await calendarViewButton(page, '列表').click();
  await agendaRow(page, data.events[0]!.title).first().click();
}
const savedEvent = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('daypop.user-data')!).data.events[0]);

test('多日 timed event 改名保留完整端點／秒數，改日期與時區後 reload 保留多日跨度', async ({ page }) => {
  const clean = monitorBrowser(page);
  await setup(page);
  const dialog = page.getByRole('dialog', { name: '編輯行程' });
  await dialog.getByLabel('標題').fill('多日會議（改名）');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await savedEvent(page)).toMatchObject({ startsAt: '2026-08-13T01:00:13.000Z', endsAt: '2026-08-15T02:00:37.000Z' });
  await reloadApp(page);
  await calendarViewButton(page, '列表').click();
  await agendaRow(page, '多日會議（改名）').first().click();
  await dialog.getByLabel('日期').fill('2026-08-14');
  await dialog.getByLabel('時區', { exact: true }).selectOption('UTC');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await reloadApp(page);
  expect(await savedEvent(page)).toMatchObject({
    startsAt: '2026-08-14T09:00:00.000Z', endsAt: '2026-08-16T10:00:00.000Z', timezone: 'UTC',
  });
  clean();
});

test('DST 回撥的後一次 01:15 改名後保持原 instant，時區標籤顯示實際 GMT-5', async ({ page }) => {
  const clean = monitorBrowser(page);
  await setup(page, true);
  const dialog = page.getByRole('dialog', { name: '編輯行程' });
  await expect(dialog.getByLabel('開始')).toHaveValue('01:15');
  await expect(dialog.getByLabel('時區', { exact: true }).locator('option:checked')).toHaveText('America/New_York (GMT-5)');
  await dialog.getByLabel('標題').fill('回撥時段（改名）');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await reloadApp(page);
  expect(await savedEvent(page)).toMatchObject({
    startsAt: '2026-11-01T06:15:00.000Z', endsAt: '2026-11-01T06:45:00.000Z', timezone: 'America/New_York',
  });
  clean();
});
