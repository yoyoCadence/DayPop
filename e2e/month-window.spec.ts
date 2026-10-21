import { expect, test, type Page } from '@playwright/test';
import { createEmptyUserData } from '../src/domain/types';
import { monitorBrowser, openApp, tabButton } from './support';

const TODAY = '2026-10-20';
const measurementInstant = '2026-10-20T04:00:00.000Z';
const dates = ['2000-02-29', '0100-01-01', '9999-12-31'];

async function seed(page: Page, adaptive = false) {
  // Only Date is fixed; scroll, ResizeObserver and RAF keep their real clocks.
  await page.clock.setFixedTime(new Date(measurementInstant));
  const data = createEmptyUserData({ now: measurementInstant });
  data.preferences.petEnabled = false;
  data.preferences.calendarGridMode = adaptive ? 'adaptive' : 'fixed-six';
  data.events = [{
    id: '18000000-0000-4000-8000-000000000100', calendarId: data.calendars[0]!.id,
    title: '每日行程', location: null, notes: null, reminderMinutes: [],
    allDay: false, startsAt: '2025-01-01T01:00:00.000Z', endsAt: '2025-01-01T01:30:00.000Z',
    timezone: 'Asia/Taipei', recurrence: { rule: 'FREQ=DAILY;COUNT=2000' }, sharingScope: 'inherit',
    createdAt: measurementInstant, updatedAt: measurementInstant,
  }];
  data.todos = dates.map((dueDate, index) => ({
    id: `18000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    calendarId: data.calendars[0]!.id, parentId: null, title: `定位 ${dueDate}`,
    dueDate, completedAt: null, priority: 'none', sortOrder: index, sharingScope: 'inherit',
    createdAt: measurementInstant, updatedAt: measurementInstant,
  }));
  await page.addInitScript(({ data, measurementInstant }) => {
    localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 4, revision: 1, updatedAt: measurementInstant, data }));
  }, { data, measurementInstant });
  await openApp(page);
  await expect(page.locator('.cal-cell').filter({ has: page.locator('.cal-cell-event') }).first()).toBeAttached();
  console.log('DP-180 browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  await expect.poll(() => page.locator('.cal-month-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
}

function day(page: Page, key: string) { return page.locator(`.cal-cell[data-date-key="${key}"]`); }

async function shift(page: Page, direction: 1 | -1) {
  const before = await page.locator('.cal-month-scroll').evaluate((element, direction) => {
    const rows = element.querySelectorAll<HTMLElement>('.cal-week-row');
    const height = rows[0]!.getBoundingClientRect().height;
    const index = direction === 1 ? 46 : 3;
    element.scrollTop = (index + 0.25) * height;
    return {
      first: rows[0]!.querySelector<HTMLElement>('.cal-cell')!.dataset.dateKey!,
      anchor: rows[index]!.querySelector<HTMLElement>('.cal-cell')!.dataset.dateKey!,
      y: rows[index]!.getBoundingClientRect().top,
    };
  }, direction);
  const expectedFirst = new Date(Date.parse(`${before.first}T00:00:00Z`) + direction * 84 * 86_400_000).toISOString().slice(0, 10);
  await expect(page.locator('.cal-cell').first()).toHaveAttribute('data-date-key', expectedFirst);
  await expect(page.locator('.cal-week-row')).toHaveCount(53);
  await expect(page.locator('.cal-cell[tabindex="0"]')).toHaveCount(1);
  await expect.poll(async () => (await day(page, before.anchor).boundingBox())!.y).toBeCloseTo(before.y, 0);
}

test('雙向長捲維持 53 週與相同日期／pixel，資料不變', async ({ page }) => {
  const clean = monitorBrowser(page);
  await seed(page);
  const original = await page.evaluate(() => localStorage.getItem('daypop.user-data'));
  for (const direction of [1, -1] as const) for (let step = 0; step < 12; step += 1) await shift(page, direction);
  expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(original);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  clean();
});

test('裁列轉移離屏焦點、保留選取；鍵盤與今天仍可定位而不搶工具列焦點', async ({ page }) => {
  const clean = monitorBrowser(page);
  await seed(page);
  await day(page, TODAY).evaluate(el => el.focus({ preventScroll: true }));
  await shift(page, 1);
  await expect(day(page, TODAY)).toBeFocused();
  await shift(page, 1);
  await shift(page, 1);
  await expect(day(page, TODAY)).toHaveCount(0);
  const focused = page.locator('.cal-cell:focus');
  await expect(focused).toHaveCount(1);
  await expect(focused).toBeInViewport();
  await expect(page.locator('.cal-cell[aria-pressed="true"]')).toHaveCount(0);
  // Removing the old focused row must not select the replacement date.
  await page.getByRole('button', { name: '今天', exact: true }).focus();
  for (let step = 0; step < 3; step += 1) await shift(page, 1);
  await expect(page.getByRole('button', { name: '今天', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(day(page, TODAY)).toBeInViewport();
  await expect(day(page, TODAY)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '今天', exact: true })).toBeFocused();
  for (const direction of [-1, 1] as const) {
    const key = await page.locator('.cal-cell').nth(direction === -1 ? 0 : 370).getAttribute('data-date-key');
    await day(page, key!).evaluate(el => el.focus({ preventScroll: true }));
    await page.keyboard.press(direction === -1 ? 'ArrowLeft' : 'ArrowRight');
    const next = new Date(Date.parse(`${key}T00:00:00Z`) + direction * 86_400_000).toISOString().slice(0, 10);
    await expect(day(page, next)).toBeFocused();
    await expect(day(page, next)).toBeInViewport();
    await expect(page.locator('.cal-week-row')).toHaveCount(53);
  }
  clean();
});

test('搜尋跨年與日期兩端重置視窗、對話框不失焦，旋轉保留可見週', async ({ page }, info) => {
  const clean = monitorBrowser(page);
  await seed(page, true);
  for (const target of dates) {
    await tabButton(page, '搜尋').click();
    await page.getByRole('textbox', { name: '搜尋', exact: true }).fill(`定位 ${target}`);
    await page.locator('.search-result').filter({ hasText: `定位 ${target}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(day(page, target)).toHaveCount(1);
    await expect.poll(() => dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await expect(page.locator('.cal-week-row')).toHaveCount(53);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(day(page, target)).toBeInViewport();
    await day(page, target).evaluate(el => el.focus({ preventScroll: true }));
    if (target !== '2000-02-29') {
      await page.keyboard.press(target === '0100-01-01' ? 'ArrowLeft' : 'ArrowRight');
      await expect(day(page, target)).toBeFocused();
    }
  }
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await expect(day(page, TODAY)).toBeInViewport();
  const anchor = await page.locator('.cal-month-scroll').evaluate(el => {
    const height = el.querySelector('.cal-week-row')!.getBoundingClientRect().height;
    el.scrollTop += height * 0.35;
    return el.scrollTop / height;
  });
  await page.setViewportSize(info.project.name === 'mobile-chrome' ? { width: 844, height: 390 } : { width: 1100, height: 760 });
  await expect.poll(() => page.locator('.cal-month-scroll').evaluate(el => el.scrollTop / el.querySelector('.cal-week-row')!.getBoundingClientRect().height)).toBeCloseTo(anchor, 1);
  await expect(page.locator('.cal-week-row')).toHaveCount(53);
  clean();
});
