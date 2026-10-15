import { expect, test, type Page } from '@playwright/test';
import { calendarViewButton, monitorBrowser, openApp, tabButton } from './support';

/**
 * DP-166 — the month grid draws the原檔's one-pixel lines, and no control keeps
 * the browser's own 3-D border.
 *
 * A month cell is a <button>. Its rule set the right and bottom lines but never
 * cleared the browser's default 2px outset border, which stayed on the top and
 * left in the text colour: white in every dark theme, so each grid line was
 * three pixels instead of one. Only a real browser applies those defaults.
 */

async function controlsWithDefaultBorders(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const element of document.querySelectorAll('button, input, select, textarea, summary')) {
      if (element.getClientRects().length === 0) continue;
      const style = getComputedStyle(element);
      const sides = ['Top', 'Right', 'Bottom', 'Left'].filter((side) => {
        const kind = style.getPropertyValue(`border-${side.toLowerCase()}-style`);
        const width = parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`));
        return ['outset', 'inset', 'groove', 'ridge'].includes(kind) && width > 0;
      });
      if (sides.length) found.push(`${element.tagName.toLowerCase()}.${String(element.className).split(' ')[0]} ${sides.join(',')}`);
    }
    return found;
  });
}

for (const mode of ['淺色', '深色'] as const) {
  test(`月格只有 1px 的右／下格線，畫面上沒有瀏覽器內建的立體邊框（${mode}）`, async ({ page }) => {
    const assertCleanBrowser = monitorBrowser(page);
    await openApp(page);
    await tabButton(page, '設定').click();
    await page.getByRole('button', { name: new RegExp(mode) }).first().click();
    expect(await controlsWithDefaultBorders(page)).toEqual([]);

    await tabButton(page, '日曆').click();
    const borders = await page.locator('.cal-cell').first().evaluate((cell) => {
      const style = getComputedStyle(cell);
      return ['top', 'right', 'bottom', 'left'].map((side) => style.getPropertyValue(`border-${side}-width`));
    });
    expect(borders).toEqual(['0px', '1px', '1px', '0px']);
    expect(await controlsWithDefaultBorders(page)).toEqual([]);

    for (const name of ['週', '列表'] as const) {
      await calendarViewButton(page, name).click();
      expect(await controlsWithDefaultBorders(page)).toEqual([]);
    }
    assertCleanBrowser();
  });
}
