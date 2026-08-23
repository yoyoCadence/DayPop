import { expect, test } from '@playwright/test';
import { monitorBrowser, openApp, tabButton } from './support';

test('手機與桌面 viewport 都不溢出，sheet 留在 App 邊界內', async ({
  page,
}, testInfo) => {
  const assertCleanBrowser = monitorBrowser(page);
  await openApp(page);

  const appViewport = page.locator('.dp-viewport');
  const viewportBox = await appViewport.boundingBox();
  expect(viewportBox).not.toBeNull();

  if (testInfo.project.name === 'mobile-chrome') {
    await expect(page.locator('.dp-notch')).toBeHidden();
    await expect(page.locator('.dp-preview-caption')).toBeHidden();
    const phoneDisplay = await page
      .locator('.dp-phone')
      .evaluate((element) => getComputedStyle(element).display);
    expect(phoneDisplay).toBe('contents');
    expect(viewportBox!.width).toBeCloseTo(390, 0);
  } else {
    const phoneBox = await page.locator('.dp-phone').boundingBox();
    expect(phoneBox).not.toBeNull();
    expect(phoneBox!.width).toBeCloseTo(404, 0);
    expect(phoneBox!.height).toBeCloseTo(824, 0);
    await expect(page.locator('.dp-notch')).toBeVisible();
    await expect(page.locator('.dp-preview-caption')).toBeVisible();
  }

  await page.getByRole('button', { name: '新增', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增行程' });
  await expect(dialog).toHaveCSS('transform', 'none');
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(viewportBox!.x - 1);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(
    viewportBox!.x + viewportBox!.width + 1,
  );
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(
    viewportBox!.y + viewportBox!.height + 1,
  );
  await dialog.getByRole('button', { name: '取消', exact: true }).click();

  await tabButton(page, '設定').click();
  await expect(page.locator('.dp-screen-title')).toHaveText('設定');
  const overflow = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  assertCleanBrowser();
});

/**
 * DP-078. `manifest.webmanifest` asks for `portrait-primary`, but iOS ignores
 * it and a browser tab never honours it, so landscape has to stay usable.
 *
 * Before the short-viewport block the chrome kept its full portrait size in
 * landscape and left the month grid 156px of 430 — about a row and a half of
 * dates. This pins the outcome so the compression cannot quietly be undone,
 * and re-checks the 24×24 touch target floor from DP-032's first round in the
 * one layout where the compression could plausibly have broken it.
 */
test('手機橫向：垂直的框會壓縮，月格拿回高度，觸控目標仍不小於 24×24', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile-chrome',
    '桌面專案會啟用手機展示框，框內是固定尺寸，短視窗條件本來就不該套用',
  );

  const assertCleanBrowser = monitorBrowser(page);
  await page.setViewportSize({ width: 932, height: 430 });
  await openApp(page);

  const heightOf = async (selector: string) => {
    const box = await page.locator(selector).boundingBox();
    expect(box, `${selector} 應該存在`).not.toBeNull();
    return box!.height;
  };

  // Portrait numbers are 181 / 64; the assertions are upper bounds rather than
  // exact values so that unrelated copy or font changes do not fail this test
  // while a lost media block still would.
  expect(await heightOf('.cal-header')).toBeLessThan(160);
  expect(await heightOf('.dp-tabbar')).toBeLessThan(56);

  // The point of the whole change: 156px before, and a row of dates is 58px.
  expect(await heightOf('.cal-month-scroll')).toBeGreaterThan(190);

  const tooSmall = await page.evaluate(() => {
    const offenders: string[] = [];
    const selector = 'button, a[href], input, select, textarea, [role="button"]';
    for (const element of document.querySelectorAll(selector)) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.width < 24 || rect.height < 24) {
        const label = (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
        offenders.push(`${element.className || element.tagName} "${label}" ${rect.width}×${rect.height}`);
      }
    }
    return offenders;
  });
  expect(tooSmall).toEqual([]);

  const overflow = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);

  assertCleanBrowser();
});
