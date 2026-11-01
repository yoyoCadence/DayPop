import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { monitorBrowser } from './support';
import { checkMonthPaging, chooseMonthMode, seedMonthPaging, swipeMonth } from './fixtures/monthPaging';

// At the fixed instant, this device is Nov 14 while the calendar is Nov 15.
test.use({ timezoneId: 'America/New_York' });

test('連續／單月切換保留月份，整月列數與內容、焦點及裝置選擇正確', async ({ page }) => {
  const clean = monitorBrowser(page); await checkMonthPaging(page); clean();
});

test('單月左右手勢不誤點，窄螢幕淺深選項與月格可操作', async ({ page }, info) => {
  const clean = monitorBrowser(page); await seedMonthPaging(page); await chooseMonthMode(page, '單月翻頁');
  const before = await page.evaluate(() => localStorage.getItem('daypop.user-data'));
  await swipeMonth(page, info.project.name === 'mobile-chrome');
  await expect(page.locator('h1.cal-period'), 'Horizontal swipe advances exactly one month').toHaveText('2026年 12月');
  await expect(page.locator('.cal-day-sheet')).toHaveCount(0);
  await page.locator('[data-date-key="2026-12-01"]').evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })));
  await expect(page.locator('.cal-day-sheet')).toHaveCount(0);
  await page.locator('[data-date-key="2026-12-01"]').click(); await expect(page.locator('.cal-day-sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  const scroll = page.locator('.cal-month-paged');
  await scroll.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 250, clientY: 300 });
  await scroll.dispatchEvent('pointermove', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 245, clientY: 400 });
  await scroll.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 400 });
  await expect(page.locator('h1.cal-period')).toHaveText('2026年 12月');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme }); await page.setViewportSize({ width: 320, height: 568 });
    expect(await page.locator('h1.cal-period').evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const text = range.getBoundingClientRect(), action = document.querySelector('.cal-month-mode-button')!.getBoundingClientRect();
      return text.height <= parseFloat(getComputedStyle(el).lineHeight) + 1 && text.right < action.left;
    }), 'Narrow title stays on one line without overlapping the mode control').toBe(true);
    await page.getByRole('button', { name: /^月曆顯示方式：/ }).click();
    await page.getByRole('dialog', { name: '月曆顯示方式', exact: true }).evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.keyboard.press('Escape');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 667, height: 375 });
  await scroll.evaluate(el => { el.scrollTop = 120; });
  await expect(page.locator('h1.cal-period')).toHaveText('2026年 12月');
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await expect(page.locator('[data-date-key="2026-11-15"]')).toBeInViewport();
  expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(before);
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'daypop.month-navigation.v1') throw new DOMException('fixture quota', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  await chooseMonthMode(page, '連續捲動');
  await expect(page.locator('.dp-storage-warning')).toContainText('這次的變更不會被保存');
  await expect(page.locator('.cal-week-row')).toHaveCount(53);
  expect(await page.evaluate(() => localStorage.getItem('daypop.month-navigation.v1'))).toBe('paged');
  expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(before);
  clean();
});
