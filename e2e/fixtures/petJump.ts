import { expect, type Page } from '@playwright/test';
import { createEmptyUserData } from '../../src/domain/types';
import { agendaRow, calendarViewButton, monitorBrowser, openApp, reloadApp } from '../support';

const now = '2026-10-25T04:00:00.000Z';
const id = '19700000-0000-4000-8000-000000000001';
export async function openJumpFixture(page: Page) {
  await page.clock.install({ time: new Date(now) });
  const data = createEmptyUserData({ now });
  data.preferences.timezone = 'Asia/Taipei';
  data.todos = [{ id, calendarId: data.calendars[0]!.id, parentId: null, title: '完成回饋', dueDate: '2026-10-25', priority: 'none',
    sortOrder: 0, sharingScope: 'inherit', completedAt: null, createdAt: now, updatedAt: now }];
  await page.addInitScript(data => {
    if (!localStorage.getItem('daypop.user-data')) localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 4, revision: 0, updatedAt: data.todos[0]!.createdAt, data }));
  }, data);
  await openApp(page);
  const timezone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  console.log('DP-197 browser timezone:', timezone);
  expect(timezone).toBe('Asia/Taipei');
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, '完成回饋')).toBeVisible();
  await page.clock.pauseAt(new Date('2026-10-25T04:01:00.000Z'));
}
export const jumpImage = (page: Page) => page.locator('button.cal-pet img');
export async function jumpReady(page: Page, pattern: RegExp) {
  await expect(jumpImage(page)).toHaveAttribute('src', pattern);
  await expect(jumpImage(page)).toBeVisible();
  expect(await jumpImage(page).evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(120);
}
export async function storedJumpTodo(page: Page) {
  return page.evaluate(id => JSON.parse(localStorage.getItem('daypop.user-data')!).data.todos.find((todo: { id: string }) => todo.id === id), id);
}

/** Controlled behavioural timers, with the browser's real native image decoder. */
export async function checkPetJump(page: Page) {
  const clean = monitorBrowser(page);
  const requests: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'image' && /jump.*webp/.test(request.url())) requests.push(request.url()); });
  await openJumpFixture(page);
  await jumpReady(page, /idle.*webp/);
  expect(requests).toEqual([]);
  const pet = page.locator('button.cal-pet');
  const before = (await pet.boundingBox())!;
  const row = agendaRow(page, '完成回饋');
  await row.focus(); await row.press('Enter'); await jumpReady(page, /jump.*webp/);
  await expect(row).toBeFocused();
  expect((await storedJumpTodo(page)).completedAt).not.toBeNull();
  const saved = await page.evaluate(() => localStorage.getItem('daypop.user-data'));
  await page.clock.fastForward(999); await jumpReady(page, /jump.*webp/);
  await page.clock.fastForward(1); await jumpReady(page, /idle.*webp/);
  expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(saved);
  const after = (await pet.boundingBox())!;
  expect([after.x, after.y, after.width, after.height]).toEqual([before.x, before.y, 60, 60]);
  await row.click(); await jumpReady(page, /idle.*webp/);
  expect((await storedJumpTodo(page)).completedAt).toBeNull();
  await row.click(); await jumpReady(page, /jump.*webp/);
  await page.clock.fastForward(1000); await jumpReady(page, /idle.*webp/);
  await reloadApp(page); await jumpReady(page, /idle.*webp/);
  expect((await storedJumpTodo(page)).completedAt).not.toBeNull();
  clean();
}
