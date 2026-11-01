import { expect, type Page } from '@playwright/test';
import { createEmptyUserData } from '../../src/domain/types';
import { calendarViewButton, openApp } from '../support';

export async function seedMonthPaging(page: Page) {
  const instant = '2026-11-15T04:00:00.000Z';
  await page.clock.setFixedTime(new Date(instant));
  const data = createEmptyUserData({ now: instant });
  data.preferences = { ...data.preferences, timezone: 'Asia/Taipei', weekStartsOn: 1, calendarGridMode: 'adaptive', petEnabled: false, theme: 'system' };
  const calendarId = data.calendars[0]!.id;
  data.events = [{ id: '22500000-0000-4000-8000-000000000001', calendarId, title: '每週檢視',
    allDay: true, startDate: '2026-11-04', endDate: '2026-11-04', recurrence: { rule: 'FREQ=WEEKLY;COUNT=10' },
    sharingScope: 'inherit', reminderMinutes: [], location: null, notes: null, createdAt: instant, updatedAt: instant },
  { id: '22500000-0000-4000-8000-000000000002', calendarId, title: '跨月旅行',
    allDay: true, startDate: '2026-11-30', endDate: '2026-12-02', recurrence: null,
    sharingScope: 'inherit', reminderMinutes: [], location: null, notes: null, createdAt: instant, updatedAt: instant }];
  data.stickers = [{ id: '22500000-0000-4000-8000-000000000003', calendarId, date: '2026-11-18', glyph: '🎂', assetKey: null, sortOrder: 0, createdAt: instant, updatedAt: instant }];
  await page.addInitScript(({ data, instant }) => {
    // Reload must read the actual saved document, never re-seed it.
    if (!localStorage.getItem('daypop.user-data')) localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 4, revision: 7, updatedAt: instant, data }));
  }, { data, instant });
  await openApp(page);
  await expect(page.locator('h1.cal-period')).toHaveText('2026年 11月');
  await expect.poll(() => page.locator('.cal-month-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  console.log('DP-225 actual browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
}

export async function chooseMonthMode(page: Page, mode: '單月翻頁' | '連續捲動') {
  await page.getByRole('button', { name: /^月曆顯示方式：/ }).click();
  await page.getByRole('dialog', { name: '月曆顯示方式', exact: true }).getByRole('button', { name: new RegExp(`^${mode}`) }).click();
  await expect(page.getByRole('dialog', { name: '月曆顯示方式', exact: true })).toHaveCount(0);
}

/** Portable rendered contract; pointer lifecycle injection is not native iOS. */
export async function checkMonthPaging(page: Page) {
  await seedMonthPaging(page);
  const before = await page.evaluate(() => localStorage.getItem('daypop.user-data'));
  const trigger = page.getByRole('button', { name: /^月曆顯示方式：/ });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '月曆顯示方式', exact: true });
  await expect(dialog.getByRole('button', { name: /^連續捲動/ })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await chooseMonthMode(page, '單月翻頁');
  const scroll = page.locator('.cal-month-paged');
  await expect(scroll, 'Selected month mode changes actual renderer').toBeVisible();
  await expect(scroll.locator('.cal-week-row')).toHaveCount(6);
  await expect(scroll.locator('.cal-cell')).toHaveCount(42);
  await expect(scroll.locator('.cal-cell').first()).toHaveAttribute('data-date-key', '2026-10-26');
  await expect(trigger).toBeFocused();
  await expect(page.locator('[data-date-key="2026-11-18"] .cal-cell-stickers')).toContainText('🎂');
  await expect(page.locator('[data-date-key="2026-11-18"] .cal-cell-event')).toHaveText('每週檢視');
  const next = page.getByRole('button', { name: '下一個月', exact: true });
  await next.focus(); await page.keyboard.press('Enter'); await expect(page.locator('h1.cal-period')).toHaveText('2026年 12月');
  await expect(scroll.locator('.cal-week-row')).toHaveCount(5); await expect(next).toBeFocused();
  await expect(page.locator('[data-date-key="2026-12-01"] .cal-cell-event')).toHaveText('續 跨月旅行');
  await chooseMonthMode(page, '連續捲動');
  await expect(page.locator('.cal-week-row')).toHaveCount(53); await expect(page.locator('h1.cal-period')).toHaveText('2026年 12月');
  await chooseMonthMode(page, '單月翻頁'); await expect(page.locator('h1.cal-period')).toHaveText('2026年 12月');
  await calendarViewButton(page, '週').click(); await calendarViewButton(page, '月').click();
  await expect(scroll).toBeVisible();
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await expect(page.locator('h1.cal-period')).toHaveText('2026年 11月');
  await page.locator('[data-date-key="2026-11-18"]').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.cal-day-sheet')).toBeVisible();
  await expect(page.locator('.cal-day-sheet')).toContainText('每週檢視');
  await page.keyboard.press('Escape'); await expect(page.locator('[data-date-key="2026-11-18"]')).toBeFocused();
  await page.locator('[data-date-key="2026-11-30"]').focus(); await page.keyboard.press('PageDown');
  await expect(page.locator('h1.cal-period')).toHaveText('2026年 12月');
  await expect(page.locator('[data-date-key="2026-12-30"]')).toBeFocused();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await expect(page.locator('h1.cal-period')).toHaveText('2027年 1月');
  await expect(page.locator('[data-date-key="2027-01-01"]')).toBeFocused();
  await expect(scroll.locator('.cal-cell[tabindex="0"]')).toHaveCount(1);
  await page.reload(); await expect(scroll).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-label', '月曆顯示方式：單月翻頁');
  expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(before);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

export async function swipeMonth(page: Page, native: boolean) {
  const scroll = page.locator('.cal-month-paged');
  const box = (await scroll.boundingBox())!;
  const x = box.x + box.width * .8, y = box.y + Math.min(160, box.height / 2);
  if (native) {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      for (let step = 1; step <= 8; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - box.width * .075 * step, y, id: 1 }] });
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally { await cdp.detach(); }
  } else {
    const props = { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y };
    await scroll.dispatchEvent('pointerdown', props);
    await scroll.dispatchEvent('pointermove', { ...props, clientX: x - 100 });
    await scroll.dispatchEvent('pointerup', { ...props, clientX: x - 120 });
  }
}
