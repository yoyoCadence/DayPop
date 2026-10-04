import { expect, test, type Page } from '@playwright/test';
import { createEmptyUserData } from '../src/domain/types';
import { calendarViewButton, monitorBrowser, openApp, reloadApp } from './support';

const NOW = new Date('2026-08-12T04:00:00.000Z');

async function setup(page: Page) {
  await page.clock.install({ time: NOW });
  const data = createEmptyUserData({ now: NOW.toISOString() });
  data.preferences.petEnabled = false;
  const common = {
    calendarId: data.calendars[0]!.id, location: null, notes: null, reminderMinutes: [],
    recurrence: null, sharingScope: 'inherit' as const, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  };
  data.events = [
    { ...common, id: '11400000-0000-4000-8000-000000000001', title: '三天旅行', allDay: true, startDate: '2026-08-10', endDate: '2026-08-12' },
    { ...common, id: '11400000-0000-4000-8000-000000000002', title: '重複休息日', allDay: true, startDate: '2026-08-07', endDate: '2026-08-07', recurrence: { rule: 'FREQ=DAILY;INTERVAL=3;COUNT=4' } },
    { ...common, id: '11400000-0000-4000-8000-000000000003', title: '九點會議', allDay: false, startsAt: '2026-08-12T01:00:00.000Z', endsAt: '2026-08-12T02:00:00.000Z', timezone: 'Asia/Taipei' },
  ];
  await page.addInitScript((data) => {
    if (!localStorage.getItem('daypop.user-data')) localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 4, revision: 0, updatedAt: data.events[0]!.createdAt, data }));
  }, data);
  await openApp(page);
  console.log('DP-114 browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  await calendarViewButton(page, '週').click();
}

const raw = (page: Page) => page.evaluate(() => localStorage.getItem('daypop.user-data')!);

test('全天多日列對齊日期，續日鍵盤開啟完整事件、修改後 reload 保留跨度', async ({ page }) => {
  const clean = monitorBrowser(page);
  await setup(page);
  const strip = page.getByRole('region', { name: '本週全天事件' });
  await expect(strip.getByRole('button')).toHaveCount(5);
  await expect(strip.getByRole('group', { name: '2026-08-12 全天事件', exact: true })).toContainText('續 三天旅行');
  await expect(strip.getByRole('group', { name: '2026-08-13 全天事件', exact: true })).not.toContainText('旅行');
  const cols = page.locator('.cal-week-all-day-col');
  for (let i = 0; i < 7; i++) {
    const bounds = await cols.nth(i).boundingBox();
    const header = await page.locator('.cal-week-col-head').nth(i).boundingBox();
    expect(bounds).not.toBeNull();
    expect(header).not.toBeNull();
    expect(Math.abs(bounds!.x - header!.x)).toBeLessThan(1);
    expect(Math.abs(bounds!.width - header!.width)).toBeLessThan(1);
  }
  const before = await raw(page);
  const continuation = strip.getByRole('button', { name: '2026-08-12 續 全天 三天旅行', exact: true });
  await continuation.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: '編輯行程' });
  await expect(sheet.getByLabel('日期', { exact: true })).toHaveValue('2026-08-10');
  await expect(sheet.getByRole('button', { name: '全天', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await raw(page)).toBe(before);
  await sheet.getByLabel('標題', { exact: true }).fill('旅行已確認');
  await sheet.getByRole('button', { name: '儲存', exact: true }).click();
  let saved = JSON.parse(await raw(page)).data;
  expect(saved.events[0]).toMatchObject({ title: '旅行已確認', startDate: '2026-08-10', endDate: '2026-08-12' });
  await reloadApp(page);
  await calendarViewButton(page, '週').click();
  await expect(strip.getByRole('button').filter({ hasText: '旅行已確認' })).toHaveCount(3);
  await expect(page.locator('.cal-week-event')).toHaveAttribute('aria-label', '09:00–10:00 九點會議');
  saved = JSON.parse(await raw(page)).data;
  expect(saved.events).toHaveLength(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  clean();
});

test('全天重複單次取消與單次替換可從週列操作，reload 不影響其他 occurrence', async ({ page }) => {
  const clean = monitorBrowser(page);
  await setup(page);
  await page.getByRole('button', { name: '2026-08-13 全天 重複休息日', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '編輯行程' });
  await expect(sheet.getByLabel('日期', { exact: true })).toHaveValue('2026-08-13');
  await sheet.getByRole('button', { name: '刪除事件', exact: true }).click();
  await page.getByRole('dialog', { name: '刪除重複事件' }).getByRole('button', { name: '只刪這一次', exact: true }).click();
  await expect(page.getByRole('button', { name: '2026-08-13 全天 重複休息日', exact: true })).toHaveCount(0);
  const first = page.getByRole('button', { name: '2026-08-10 全天 重複休息日', exact: true });
  await first.focus();
  await page.keyboard.press('Space');
  await sheet.getByLabel('標題', { exact: true }).fill('替換的休息日');
  await sheet.getByRole('button', { name: '儲存', exact: true }).click();
  await page.getByRole('dialog', { name: '修改重複事件' }).getByRole('button', { name: '只改這一次', exact: true }).click();
  await reloadApp(page);
  await calendarViewButton(page, '週').click();
  await expect(page.getByRole('button', { name: '2026-08-10 全天 替換的休息日', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /全天 重複休息日$/ })).toHaveCount(0);
  const saved = JSON.parse(await raw(page)).data;
  expect(saved.events).toHaveLength(4);
  expect(saved.events[1].startDate).toBe('2026-08-07');
  expect(saved.eventExceptions).toHaveLength(2);
  expect(saved.eventExceptions.map((item: { occurrence: { date: string } }) => item.occurrence.date).sort()).toEqual(['2026-08-10', '2026-08-13']);
  clean();
});
