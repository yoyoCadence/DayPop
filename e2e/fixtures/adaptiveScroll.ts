import { expect, type Page } from '@playwright/test';
import { createEmptyUserData } from '../../src/domain/types';
import { openApp } from '../support';

/** Real layout/scroll/ResizeObserver, with a synthetic held-touch lifecycle.
 * This exercises the same React input boundary, not OS touch inertia. */
export async function checkAdaptiveScroll(page: Page) {
  const viewport = page.viewportSize()!;
  for (const scenario of [
    { today: '2026-02-15', weekStartsOn: 0 as const, dates: ['2026-03-01', '2026-05-03'], rows: 6 },
    { today: '2026-11-15', weekStartsOn: 1 as const, dates: ['2026-12-07', '2027-02-08'], rows: 4 },
  ]) {
    await page.setViewportSize(viewport);
    const instant = `${scenario.today}T04:00:00.000Z`;
    await page.clock.setFixedTime(new Date(instant));
    const data = createEmptyUserData({ now: instant });
    data.preferences = { ...data.preferences, calendarGridMode: 'adaptive', weekStartsOn: scenario.weekStartsOn, petEnabled: false };
    await page.addInitScript(({ data, instant }) => {
      localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 4, revision: 1, updatedAt: instant, data }));
    }, { data, instant });
    await openApp(page);
    const scroll = page.locator('.cal-month-scroll');
    await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    console.log('DP-224 actual browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
    const before = await page.evaluate(() => localStorage.getItem('daypop.user-data'));
    const height = await scroll.locator('.cal-week-row').first().evaluate(el => el.getBoundingClientRect().height);
    await scroll.evaluate(el => {
      const event = new Event('touchstart', { bubbles: true });
      Object.defineProperty(event, 'touches', { value: [{}] });
      el.dispatchEvent(event);
    });
    for (const date of scenario.dates) {
      await scroll.evaluate((el, date) => {
        const rows = [...el.querySelectorAll('.cal-week-row')];
        const row = el.querySelector(`[data-date-key="${date}"]`)!.closest('.cal-week-row');
        el.scrollTop = (rows.indexOf(row!) + 0.25) * rows[0]!.getBoundingClientRect().height;
      }, date);
      const [year, month] = date.split('-');
      await expect(page.locator('h1.cal-period')).toHaveText(`${year}年 ${Number(month)}月`);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(await scroll.locator('.cal-week-row').first().evaluate(el => el.getBoundingClientRect().height), 'held touch never changes row geometry').toBe(height);
    }
    await page.setViewportSize({ width: viewport.width, height: viewport.height + 80 });
    // Longer than the scroll quiet window: a resting finger still owns layout.
    await page.waitForTimeout(220);
    expect(await scroll.locator('.cal-week-row').first().evaluate(el => el.getBoundingClientRect().height)).toBe(height);
    const anchor = await scroll.evaluate(el => el.scrollTop / el.querySelector('.cal-week-row')!.getBoundingClientRect().height);
    await scroll.evaluate(el => {
      const event = new Event('touchend', { bubbles: true });
      Object.defineProperty(event, 'touches', { value: [] });
      el.dispatchEvent(event);
    });
    const expectedHeight = await scroll.evaluate((el, rows) => Math.floor(el.clientHeight / rows), scenario.rows);
    await expect.poll(() => scroll.locator('.cal-week-row').first().evaluate(el => el.getBoundingClientRect().height)).toBe(expectedHeight);
    const position = () => scroll.evaluate(el => el.scrollTop / el.querySelector('.cal-week-row')!.getBoundingClientRect().height);
    await expect.poll(async () => Math.abs(await position() - anchor)).toBeLessThanOrEqual(1 / expectedHeight + 0.001);
    await page.waitForTimeout(350);
    expect(Math.abs(await position() - anchor), 'no feedback jump after settlement').toBeLessThanOrEqual(1 / expectedHeight + 0.001);
    await expect(scroll.locator('.cal-week-row')).toHaveCount(53);
    await expect(scroll.locator('.cal-cell[tabindex="0"]')).toHaveCount(1);
    expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(before);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (scenario.weekStartsOn === 0) {
      for (let step = 0; step < 4; step++) {
        const first = await scroll.locator('.cal-cell').first().getAttribute('data-date-key');
        await scroll.evaluate(el => { el.scrollTop = 46.25 * el.querySelector('.cal-week-row')!.getBoundingClientRect().height; });
        await expect(scroll.locator('.cal-cell').first()).not.toHaveAttribute('data-date-key', first!);
      }
      await expect(scroll.locator(`[data-date-key="${scenario.today}"]`)).toHaveCount(0);
      await scroll.evaluate(el => {
        const rows = [...el.querySelectorAll('.cal-week-row')];
        const january = el.querySelector('[data-date-key="2027-01-17"]')!.closest('.cal-week-row');
        // Match the destination's pixel offset: recentering need not emit scroll.
        el.scrollTop = rows.indexOf(january!) * rows[0]!.getBoundingClientRect().height;
      });
      await expect(page.locator('h1.cal-period')).toHaveText('2027年 1月');
      await page.waitForTimeout(200);
      const today = page.getByRole('button', { name: '今天', exact: true });
      await today.focus();
      await page.keyboard.press('Enter');
      await expect(scroll.locator(`[data-date-key="${scenario.today}"]`)).toHaveCount(1);
      const fourRows = await scroll.evaluate(el => Math.floor(el.clientHeight / 4));
      await expect.poll(() => scroll.locator('.cal-week-row').first().evaluate(el => el.getBoundingClientRect().height),
        { message: 'Today uses its own adaptive row count after recenter' }).toBe(fourRows);
      await expect(page.locator('h1.cal-period')).toHaveText('2026年 2月');
      await expect(today).toBeFocused();
      expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(before);
    }
  }
}
