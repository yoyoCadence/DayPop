import { expect, test, type Page } from '@playwright/test';
import { createEmptyUserData } from '../src/domain/types';
import { calendarViewButton, monitorBrowser, openApp } from './support';

/**
 * DP-167 — the week view's three-day mode.
 *
 * Seven 60px columns need 456px, so a phone scrolls the week sideways. Three
 * columns from the cursor fill the pane instead. Only a real browser lays the
 * columns out, and the drag has to turn the measured width into a day.
 */

test.use({ timezoneId: 'Asia/Taipei' });
const NOW = new Date('2026-08-12T04:00:00.000Z');

async function setup(page: Page) {
  await page.clock.install({ time: NOW });
  const data = createEmptyUserData({ now: NOW.toISOString() });
  data.preferences.petEnabled = false;
  data.preferences.timezone = 'Asia/Taipei';
  const common = {
    calendarId: data.calendars[0]!.id, location: null, notes: null, reminderMinutes: [],
    recurrence: null, sharingScope: 'inherit' as const, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  };
  data.events = [
    { ...common, id: '16700000-0000-4000-8000-000000000001', title: '三天旅行', allDay: true, startDate: '2026-08-11', endDate: '2026-08-13' },
    { ...common, id: '16700000-0000-4000-8000-000000000002', title: '九點會議', allDay: false, startsAt: '2026-08-12T01:00:00.000Z', endsAt: '2026-08-12T02:00:00.000Z', timezone: 'Asia/Taipei' },
    { ...common, id: '16700000-0000-4000-8000-000000000003', title: '夜班', allDay: false, startsAt: '2026-08-13T15:00:00.000Z', endsAt: '2026-08-13T17:00:00.000Z', timezone: 'Asia/Taipei' },
  ];
  await page.addInitScript((data) => {
    if (!localStorage.getItem('daypop.user-data')) localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 4, revision: 0, updatedAt: data.events[0]!.createdAt, data }));
  }, data);
  await openApp(page);
  console.log('DP-167 browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  await calendarViewButton(page, '週').click();
}

const raw = (page: Page) => page.evaluate(() => localStorage.getItem('daypop.user-data')!);

test('三日模式從今天起三欄填滿畫面，不橫向捲動，跨午夜、全天與現在線照週檢視畫', async ({ page }) => {
  const clean = monitorBrowser(page);
  await setup(page);
  const pane = page.locator('.cal-week');
  const toggle = page.getByRole('button', { name: '3日檢視', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cal-period')).toHaveText('8/12 – 8/14');
  await expect(page.locator('.cal-week-col')).toHaveCount(3);
  expect(await pane.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  // Header, all-day strip and timed columns line up, and the three share the width.
  const widths: number[] = [];
  for (let i = 0; i < 3; i++) {
    const head = (await page.locator('.cal-week-col-head').nth(i).boundingBox())!;
    const strip = (await page.locator('.cal-week-all-day-col').nth(i).boundingBox())!;
    const column = (await page.locator('.cal-week-col').nth(i).boundingBox())!;
    expect(Math.abs(head.x - column.x)).toBeLessThan(1);
    expect(Math.abs(strip.x - column.x)).toBeLessThan(1);
    expect(Math.abs(head.width - column.width)).toBeLessThan(1);
    widths.push(column.width);
  }
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
  expect(widths[0]!).toBeGreaterThan(90);

  const strip = page.getByRole('region', { name: '這三天的全天事件' });
  await expect(strip.getByRole('group', { name: '2026-08-12 全天事件', exact: true })).toContainText('續 三天旅行');
  await expect(strip.getByRole('group', { name: '2026-08-14 全天事件', exact: true })).not.toContainText('旅行');
  await expect(page.locator('.cal-week-col').nth(1).locator('.cal-week-event')).toHaveAttribute('aria-label', '23:00–24:00 夜班');
  await expect(page.locator('.cal-week-col').nth(2).locator('.cal-week-event')).toHaveAttribute('aria-label', '續 00:00–01:00 夜班');
  await expect(page.locator('.cal-week-now')).toHaveCount(1);

  await page.getByRole('button', { name: '下一頁', exact: true }).click();
  await expect(page.locator('.cal-period')).toHaveText('8/15 – 8/17');
  await expect(page.locator('.cal-week-now')).toHaveCount(0);
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await expect(page.locator('.cal-period')).toHaveText('8/12 – 8/14');

  await toggle.click();
  await expect(page.locator('.cal-period')).toHaveText('8/9 – 8/15');
  await expect(page.locator('.cal-week-col')).toHaveCount(7);
  clean();
});

test('三日模式橫向拖曳一欄，以實際欄寬換算成隔天', async ({ page }) => {
  const clean = monitorBrowser(page);
  await setup(page);
  await page.getByRole('button', { name: '3日檢視', exact: true }).click();
  const block = page.locator('.cal-week-event').filter({ hasText: '九點會議' });
  const box = (await block.boundingBox())!;
  const column = (await page.locator('.cal-week-col').first().boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 10;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + column.width, y, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator('.cal-week-col').nth(1).locator('.cal-week-event').filter({ hasText: '九點會議' })).toHaveCount(1);
  const saved = JSON.parse(await raw(page)).data.events.find((event: { title: string }) => event.title === '九點會議');
  expect(saved).toMatchObject({ startsAt: '2026-08-13T01:00:00.000Z', endsAt: '2026-08-13T02:00:00.000Z' });
  clean();
});
