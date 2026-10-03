import { expect, test, type Locator, type Page } from '@playwright/test';
import { createEmptyUserData } from '../src/domain/types';
import { calendarViewButton, monitorBrowser, openApp, reloadApp } from './support';

const NOW = new Date('2026-08-12T04:00:00.000Z');

async function setup(page: Page) {
  await page.clock.install({ time: NOW });
  const data = createEmptyUserData({ now: NOW.toISOString() });
  data.preferences.petEnabled = false;
  data.events = [{
    id: '83000000-0000-4000-8000-000000000001', calendarId: data.calendars[0]!.id,
    title: '拖曳週會', allDay: false, startsAt: '2026-07-29T01:00:00.000Z',
    endsAt: '2026-07-29T02:00:00.000Z', timezone: 'Asia/Taipei',
    recurrence: { rule: 'FREQ=WEEKLY;COUNT=8' }, sharingScope: 'inherit',
    location: null, notes: null, reminderMinutes: [],
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  }];
  await page.addInitScript((data) => {
    if (!localStorage.getItem('daypop.user-data')) {
      localStorage.setItem('daypop.user-data', JSON.stringify({
        schemaVersion: 4, revision: 0, updatedAt: data.events[0]!.createdAt, data,
      }));
    }
  }, data);
  await openApp(page);
  console.log('DP-083 browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  await calendarViewButton(page, '週').click();
  return page.locator('.cal-week-event').filter({ hasText: '拖曳週會' });
}

async function drag(page: Page, block: Locator, dx = 0, resize = false) {
  await block.scrollIntoViewIfNeeded();
  const box = await block.boundingBox();
  if (!box) throw new Error('week block is missing');
  // The desktop phone frame can be scaled; use the rendered hour/column sizes.
  const scale = await block.evaluate((element) => element.getBoundingClientRect().height / (element as HTMLElement).offsetHeight);
  const x = box.x + box.width / 2;
  const y = resize ? box.y + box.height - 2 : box.y + 10 * scale;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx * scale, y + 44 * scale, { steps: 8 });
  await page.mouse.up();
}

const raw = (page: Page) => page.evaluate(() => localStorage.getItem('daypop.user-data')!);

test('重複拖曳先問範圍，取消不寫入；只改一次可 reload 並保持系列', async ({ page }) => {
  const clean = monitorBrowser(page);
  let block = await setup(page);
  const before = await raw(page);
  await drag(page, block);
  const scope = page.getByRole('dialog', { name: '修改重複事件' });
  await expect(scope).toBeVisible();
  expect(await raw(page)).toBe(before);
  await expect(scope.getByRole('button', { name: '只改這一次' })).toBeFocused();
  await scope.getByRole('button', { name: '取消', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(scope.getByRole('button', { name: '只改這一次' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(scope).toHaveCount(0);
  await expect(block).toBeFocused();
  expect(await raw(page)).toBe(before);

  await drag(page, block, 60);
  await scope.getByRole('button', { name: '只改這一次' }).click();
  await expect(block).toHaveAttribute('aria-label', '10:00–11:00 拖曳週會');
  const saved = JSON.parse(await raw(page)).data;
  expect(saved.events).toHaveLength(2);
  expect(saved.events[0].startsAt).toBe('2026-07-29T01:00:00.000Z');
  expect(saved.events[1].startsAt).toBe('2026-08-13T02:00:00.000Z');
  expect(saved.eventExceptions[0].occurrence.startsAt).toBe('2026-08-12T01:00:00.000Z');
  await reloadApp(page);
  await calendarViewButton(page, '週').click();
  block = page.locator('.cal-week-event').filter({ hasText: '拖曳週會' });
  await expect(block).toHaveAttribute('aria-label', '10:00–11:00 拖曳週會');
  // The replacement is a standalone row; resizing it writes directly.
  await drag(page, block, 0, true);
  await expect(scope).toHaveCount(0);
  await expect(block).toHaveAttribute('aria-label', '10:00–12:00 拖曳週會');
  clean();
});

test('套用全部平移系列日期與時間，拉長度不增加例外', async ({ page }) => {
  const clean = monitorBrowser(page);
  const block = await setup(page);
  await drag(page, block, 60);
  const scope = page.getByRole('dialog', { name: '修改重複事件' });
  await scope.getByRole('button', { name: '套用全部' }).click();
  await expect(block).toHaveAttribute('aria-label', '10:00–11:00 拖曳週會');
  let saved = JSON.parse(await raw(page)).data;
  expect(saved.events).toHaveLength(1);
  expect(saved.events[0].startsAt).toBe('2026-07-30T02:00:00.000Z');
  expect(saved.events[0].timezone).toBe('Asia/Taipei');
  expect(saved.eventExceptions).toEqual([]);
  await drag(page, block, 0, true);
  await scope.getByRole('button', { name: '套用全部' }).click();
  await expect(block).toHaveAttribute('aria-label', '10:00–12:00 拖曳週會');
  saved = JSON.parse(await raw(page)).data;
  expect(saved.events[0].startsAt).toBe('2026-07-30T02:00:00.000Z');
  expect(saved.events[0].endsAt).toBe('2026-07-30T04:00:00.000Z');
  expect(saved.eventExceptions).toEqual([]);
  await reloadApp(page);
  await calendarViewButton(page, '週').click();
  await expect(block).toHaveAttribute('aria-label', '10:00–12:00 拖曳週會');
  clean();
});
