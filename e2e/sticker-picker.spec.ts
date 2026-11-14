import { expect, test, type Page } from '@playwright/test';
import { createEmptyUserData, type DayPopUserData } from '../src/domain/types';
import { monitorBrowser, openApp, reloadApp, tabButton } from './support';

/**
 * DP-243: the sticker picker has eleven categories and a 「最近」 group built
 * from the user's own stickers. Guest mode only — the stickers go through the
 * same repository calls as before, which the account specs already cover.
 */
test.use({ timezoneId: 'Asia/Taipei' });
const NOW = '2026-11-12T02:00:00.000Z';
const DATE = '2026-11-12';

async function seed(page: Page) {
  await page.clock.setFixedTime(new Date(NOW));
  const data = createEmptyUserData({ now: NOW });
  data.preferences.timezone = 'Asia/Taipei';
  data.preferences.petEnabled = false;
  await page.addInitScript((data) => {
    if (!localStorage.getItem('daypop.user-data')) {
      localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 5, revision: 0, updatedAt: data.calendars[0]!.createdAt, data }));
    }
  }, data);
  await openApp(page);
  console.log('DP-243 actual browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'display: Asia/Taipei');
}

async function openDay(page: Page) {
  await tabButton(page, '日曆').click();
  await page.getByRole('button', { name: `${DATE}，0 個行程`, exact: true }).click();
  const day = page.getByRole('dialog', { name: '11月12日 週四', exact: true });
  await expect(day).toBeVisible();
  return day;
}

const storedGlyphs = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('daypop.user-data')!).data as DayPopUserData).stickers.map((sticker) => sticker.glyph));

test('分類切換、加入、最近與重新載入保存', async ({ page }) => {
  const clean = monitorBrowser(page);
  await seed(page);
  const day = await openDay(page);

  await day.getByRole('button', { name: '＋ 貼圖', exact: true }).click();
  const categories = day.getByRole('group', { name: '貼圖分類' }).getByRole('button');
  await expect(categories).toHaveText(['標記', '心情', '慶祝', '工作', '金錢', '健康', '出遊', '美食', '生活', '休閒', '天氣']);
  await expect(categories.filter({ hasText: '標記' })).toHaveAttribute('aria-pressed', 'true');

  await categories.filter({ hasText: '美食' }).click();
  await expect(categories.filter({ hasText: '美食' })).toHaveAttribute('aria-pressed', 'true');
  await expect(categories.filter({ hasText: '標記' })).toHaveAttribute('aria-pressed', 'false');
  await day.getByRole('group', { name: '美食貼圖' }).getByRole('button', { name: '加入貼圖 🍜', exact: true }).click();
  await expect(day.getByRole('group', { name: '選擇貼圖' })).toHaveCount(0);
  await expect(day.getByRole('button', { name: '移除貼圖 🍜', exact: true })).toBeVisible();

  // The second opening starts at 「最近」, with what was just stuck.
  await day.getByRole('button', { name: '＋ 貼圖', exact: true }).click();
  await expect(categories.first()).toHaveText('最近');
  await expect(categories.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(day.getByRole('group', { name: '最近貼圖' }).getByRole('button')).toHaveText(['🍜']);

  // Keyboard: a category is an ordinary button.
  await categories.filter({ hasText: '天氣' }).focus();
  await page.keyboard.press('Enter');
  await expect(categories.filter({ hasText: '天氣' })).toHaveAttribute('aria-pressed', 'true');
  await day.getByRole('button', { name: '加入貼圖 🌀', exact: true }).click();

  await expect.poll(() => storedGlyphs(page)).toEqual(['🍜', '🌀']);
  await day.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator(`[data-date-key="${DATE}"] .cal-cell-stickers`).first()).toHaveText('🍜🌀');

  await reloadApp(page);
  const again = await openDay(page);
  await expect(again.locator('.cal-day-sticker')).toHaveText(['🍜', '🌀']);
  await again.getByRole('button', { name: '＋ 貼圖', exact: true }).click();
  await expect(again.getByRole('group', { name: '最近貼圖' }).getByRole('button')).toHaveText(['🌀', '🍜']);
  clean();
});

for (const width of [320, 360, 390]) {
  test(`${width}px：分類列換行、不水平溢出，格子自己捲動`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', '手機寬度版面只看手機專案');
    const clean = monitorBrowser(page);
    await page.setViewportSize({ width, height: 640 });
    await seed(page);
    const day = await openDay(page);
    await day.getByRole('button', { name: '＋ 貼圖', exact: true }).click();
    await day.getByRole('group', { name: '貼圖分類' }).getByRole('button', { name: '心情', exact: true }).click();

    const layout = await page.evaluate(() => {
      const pick = document.querySelector('.cal-day-sticker-pick')!.getBoundingClientRect();
      const chips = [...document.querySelectorAll('.cal-day-sticker-cat')].map((chip) => chip.getBoundingClientRect());
      const grid = document.querySelector('.cal-day-sticker-grid') as HTMLElement;
      const viewport = document.querySelector('.dp-viewport') as HTMLElement;
      return {
        pickLeft: pick.left,
        pickRight: pick.right,
        chipRows: new Set(chips.map((chip) => Math.round(chip.top))).size,
        chipsInside: chips.every((chip) => chip.left >= pick.left && chip.right <= pick.right),
        smallestChipHeight: Math.min(...chips.map((chip) => chip.height)),
        gridHeight: grid.clientHeight,
        gridScrolls: grid.scrollHeight > grid.clientHeight,
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        viewportOverflow: viewport.scrollWidth - viewport.clientWidth,
      };
    });
    console.log(`DP-243 ${width}px picker layout`, JSON.stringify(layout));
    expect(layout.pickLeft).toBeGreaterThanOrEqual(0);
    expect(layout.pickRight).toBeLessThanOrEqual(width);
    expect(layout.chipsInside).toBe(true);
    // Two lines from 360px up; the narrowest phones get a third.
    expect(layout.chipRows).toBe(width >= 360 ? 2 : 3);
    // WCAG 2.5.8 minimum target size.
    expect(layout.smallestChipHeight).toBeGreaterThanOrEqual(24);
    expect(layout.gridHeight).toBeLessThanOrEqual(150);
    expect(layout.gridScrolls).toBe(true);
    expect(layout.pageOverflow).toBeLessThanOrEqual(0);
    expect(layout.viewportOverflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath(`sticker-picker-${width}.png`) });
    clean();
  });
}
