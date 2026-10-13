import { expect, test } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyUserData } from '../src/domain/types';
import { monitorBrowser, openApp, tabButton } from './support';

test.use({ timezoneId: 'America/New_York' });

test('顯示時區跨午夜會更新今天與逾期，不搬動日期、不清草稿、不寫入資料', async ({ page }, testInfo) => {
  const clean = monitorBrowser(page);
  const now = '2026-09-30T15:59:30.000Z';
  // Load naturally before the test instant, then pause. Slow font/module loads
  // must not consume the thirty seconds remaining before Taipei midnight.
  await page.clock.install({ time: new Date('2026-09-30T15:49:30.000Z') });
  const data = createEmptyUserData({ now });
  data.preferences.timezone = 'Asia/Taipei';
  data.preferences.petEnabled = false;
  data.todos = [{
    id: '15000000-0000-4000-8000-000000000001', calendarId: data.calendars[0]!.id,
    title: '午夜待辦', dueDate: '2026-09-30', priority: 'none', parentId: null,
    completedAt: null, sortOrder: 0, sharingScope: 'inherit', createdAt: now, updatedAt: now,
  }, {
    id: '15000000-0000-4000-8000-000000000002', calendarId: data.calendars[0]!.id,
    title: '隔日待辦', dueDate: '2026-10-01', priority: 'none', parentId: null,
    completedAt: null, sortOrder: 1, sharingScope: 'inherit', createdAt: now, updatedAt: now,
  }];
  await page.addInitScript((data) => {
    localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 4, revision: 1, updatedAt: data.calendars[0]!.createdAt, data }));
  }, data);
  await openApp(page);
  await page.clock.pauseAt(new Date(now));
  expect(await page.title()).toContain('DayPop');
  console.log('DP-150 actual browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'display: Asia/Taipei');
  const bytes = await page.evaluate(() => localStorage.getItem('daypop.user-data'));
  await expect(page.locator('.cal-today-full')).toContainText('2026 / 9 / 30');
  await page.getByRole('button', { name: '2026-09-30，0 個行程', exact: true }).click();
  const day = page.getByRole('dialog', { name: '9月30日 週三', exact: true });
  await expect(day.locator('.cal-day-overdue')).toHaveCount(0);
  await day.getByRole('button', { name: '＋ 新增事件', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '新增行程', exact: true });
  await sheet.getByLabel('標題', { exact: true }).fill('保留午夜草稿');
  await page.clock.fastForward(60_000);
  await expect(page.locator('.cal-today-full')).toContainText('2026 / 10 / 1');
  await expect(sheet.getByLabel('標題', { exact: true })).toHaveValue('保留午夜草稿');
  await expect(sheet.getByLabel('標題', { exact: true })).toBeFocused();
  await expect(sheet.getByLabel('日期', { exact: true })).toHaveValue('2026-09-30');
  expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(bytes);
  await sheet.getByRole('button', { name: '取消', exact: true }).click();
  await expect(day).toBeVisible();
  await expect(day.locator('.cal-day-overdue')).toContainText('逾期');
  await day.getByRole('button', { name: '完成', exact: true }).click();
  const today = page.locator('[data-date-key="2026-10-01"] .cal-cell-day');
  expect(await today.evaluate((element) => (element as HTMLElement).style.color)).toBe('var(--today-fg)');
  await page.screenshot({ path: join(tmpdir(), `daypop-dp150-${testInfo.project.name}-after.png`) });

  await tabButton(page, '綜覽').click();
  await page.getByRole('group', { name: '資料類型' }).getByRole('button', { name: '待辦', exact: true }).click();
  await page.getByRole('group', { name: '時間範圍' }).getByRole('button', { name: '年', exact: true }).click();
  // October 1 is not overdue until the next Taipei midnight.
  // The browsed year remains fixed while the clock advances without UI input.
  await expect(page.locator('.overview-item-sub')).toHaveCount(1);
  await expect(page.locator('.overview-item-sub')).toContainText('逾期・原9/30');
  const label = await page.locator('.overview-label').textContent();
  await page.clock.fastForward(24 * 60 * 60_000);
  await expect(page.locator('.overview-item-sub')).toHaveCount(2);
  await expect(page.locator('.overview-item').filter({ hasText: '隔日待辦' }).locator('.overview-item-sub')).toContainText('逾期・原10/1');
  await expect(page.locator('.overview-label')).toHaveText(label!);
  expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(bytes);
  clean();
});
