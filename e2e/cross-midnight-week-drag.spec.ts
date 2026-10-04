import { expect, test, type Locator, type Page } from '@playwright/test';
import { createEmptyUserData } from '../src/domain/types';
import { calendarViewButton, monitorBrowser, openApp, reloadApp } from './support';

async function setup(page: Page, recurring = false, long = false) {
  const now = new Date('2026-08-12T00:00:00.000Z');
  await page.clock.install({ time: now });
  const data = createEmptyUserData({ now: now.toISOString() });
  data.preferences.petEnabled = false;
  data.events = [{
    id: '72000000-0000-4000-8000-000000000001', calendarId: data.calendars[0]!.id,
    title: '跨午夜夜班', allDay: false,
    startsAt: recurring ? '2026-07-29T15:00:00.000Z' : '2026-08-12T15:00:00.000Z',
    endsAt: recurring ? '2026-07-29T16:30:00.000Z' : long ? '2026-08-14T16:30:00.000Z' : '2026-08-12T16:30:00.000Z',
    timezone: 'America/New_York', recurrence: recurring ? { rule: 'FREQ=WEEKLY;COUNT=8' } : null,
    location: null, notes: null, reminderMinutes: [], sharingScope: 'inherit',
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  }];
  await page.addInitScript((data) => {
    if (!localStorage.getItem('daypop.user-data')) localStorage.setItem('daypop.user-data', JSON.stringify({
      schemaVersion: 4, revision: 0, updatedAt: data.events[0]!.createdAt, data,
    }));
  }, data);
  await openApp(page);
  console.log('DP-072 browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    'display: Asia/Taipei / event: America/New_York');
  await calendarViewButton(page, '週').click();
  return page.locator('.cal-week-event').filter({ hasText: '跨午夜夜班' });
}
const raw = (page: Page) => page.evaluate(() => localStorage.getItem('daypop.user-data')!);
const saved = async (page: Page) => JSON.parse(await raw(page)).data;

async function gesture(page: Page, block: Locator, dx: number, minutes: number, resize = false, release = true) {
  await block.scrollIntoViewIfNeeded();
  const box = await block.boundingBox();
  if (!box) throw new Error('missing week segment');
  const scale = await block.evaluate((el) => el.getBoundingClientRect().height / (el as HTMLElement).offsetHeight);
  const x = box.x + box.width / 2;
  const y = resize ? box.y + box.height - 2 : box.y + 10 * scale;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx * scale, y + minutes / 60 * 44 * scale, { steps: 8 });
  if (release) await page.mouse.up();
}

test('從續段拖曳移動整筆，放開前重切全部片段且不寫入，reload 保持完整區間', async ({ page }) => {
  const clean = monitorBrowser(page);
  let blocks = await setup(page);
  const before = await raw(page);
  await expect(blocks).toHaveCount(2);
  await expect(blocks.first().locator('.cal-week-event-resize')).toHaveCount(0);
  await expect(blocks.last().locator('.cal-week-event-resize')).toHaveCount(1);
  await gesture(page, blocks.last(), 60, -60, false, false);
  await expect(blocks).toHaveCount(1);
  await expect(blocks).toHaveAttribute('aria-label', '22:00–23:30 跨午夜夜班');
  expect(await raw(page)).toBe(before);
  await page.mouse.up();
  await expect.poll(async () => (await saved(page)).events[0].startsAt).toBe('2026-08-13T14:00:00.000Z');
  expect((await saved(page)).events[0]).toMatchObject({ endsAt: '2026-08-13T15:30:00.000Z', timezone: 'America/New_York' });
  await reloadApp(page);
  await calendarViewButton(page, '週').click();
  blocks = page.locator('.cal-week-event').filter({ hasText: '跨午夜夜班' });
  await expect(blocks).toHaveCount(1);
  await expect(blocks).toHaveAttribute('aria-label', '22:00–23:30 跨午夜夜班');
  clean();
});

test('重複跨午夜取消不寫入並恢復焦點；單次／全部保留完整區間與系列錨點', async ({ page }) => {
  const clean = monitorBrowser(page);
  let blocks = await setup(page, true);
  const before = await raw(page);
  await gesture(page, blocks.first(), 0, 60);
  const scope = page.getByRole('dialog', { name: '修改重複事件' });
  await expect(scope).toBeVisible();
  expect(await raw(page)).toBe(before);
  await scope.getByRole('button', { name: '取消', exact: true }).click();
  await expect(scope).toHaveCount(0);
  expect(await raw(page)).toBe(before);
  await expect(blocks.first()).toBeFocused();

  await gesture(page, blocks.last(), 60, -60);
  await scope.getByRole('button', { name: '只改這一次' }).click();
  await expect(blocks).toHaveCount(1);
  let data = await saved(page);
  expect(data.events[0]).toMatchObject({ startsAt: '2026-07-29T15:00:00.000Z', endsAt: '2026-07-29T16:30:00.000Z' });
  expect(data.events[1]).toMatchObject({ startsAt: '2026-08-13T14:00:00.000Z', endsAt: '2026-08-13T15:30:00.000Z', recurrence: null, timezone: 'America/New_York' });
  expect(data.eventExceptions).toHaveLength(1);
  await reloadApp(page);
  await calendarViewButton(page, '週').click();
  await page.getByRole('button', { name: '下一頁', exact: true }).click();
  blocks = page.locator('.cal-week-event').filter({ hasText: '跨午夜夜班' });
  await expect(blocks).toHaveCount(2);
  await gesture(page, blocks.first(), 60, -60);
  await scope.getByRole('button', { name: '套用全部' }).click();
  await expect(blocks).toHaveCount(1);
  data = await saved(page);
  expect(data.events[0]).toMatchObject({ startsAt: '2026-07-30T14:00:00.000Z', endsAt: '2026-07-30T15:30:00.000Z', timezone: 'America/New_York' });
  clean();
});

test('多日最後一段調整結束時間保留所有中間日，reload 仍為一筆事件', async ({ page }) => {
  const clean = monitorBrowser(page);
  let blocks = await setup(page, false, true);
  await expect(blocks).toHaveCount(4);
  await gesture(page, blocks.last(), 0, 60, true);
  await expect(blocks.last()).toHaveAttribute('aria-label', '續 00:00–01:30 跨午夜夜班');
  expect((await saved(page)).events).toHaveLength(1);
  expect((await saved(page)).events[0]).toMatchObject({ startsAt: '2026-08-12T15:00:00.000Z', endsAt: '2026-08-14T17:30:00.000Z' });
  await reloadApp(page);
  await calendarViewButton(page, '週').click();
  blocks = page.locator('.cal-week-event').filter({ hasText: '跨午夜夜班' });
  await expect(blocks).toHaveCount(4);
  await expect(blocks.last()).toHaveAttribute('aria-label', '續 00:00–01:30 跨午夜夜班');
  clean();
});
