import { expect, test } from '@playwright/test';
import { monitorBrowser, openApp } from './support';

/**
 * The update dialog must stay dismissable on screens shorter than its notes.
 *
 * Found while shipping v0.4.0: `.dialog-backdrop` cannot scroll — `.dp-viewport`
 * clips it with `overflow: hidden` — so release notes taller than the screen
 * pushed both buttons below the edge on phone landscape and on an iPhone SE,
 * and a finger swipe moved nothing. Every user sees this dialog once per
 * release, so a stuck one blocks the whole app until it can be dismissed.
 *
 * `locator.click()` alone would not have caught it: Playwright scrolls
 * ancestors into view programmatically, which works even on `overflow: hidden`
 * where a finger cannot. So this pins the two facts a finger depends on — the
 * dialog fits on screen, and the dialog itself is the scrollable container —
 * and only then scrolls it and presses the button by its on-screen position.
 *
 * The notes are a deliberately long fixture rather than `release-notes.json`,
 * so a shorter future release cannot turn this into a test that never needs to
 * scroll and therefore proves nothing.
 */
const longRelease = {
  version: '999.0.0',
  releasedAt: '2026-09-30',
  title: 'e2e 更新對話框',
  changes: Array.from(
    { length: 16 },
    (_, index) => `第 ${index + 1} 條：一段夠長、在窄螢幕上會換成好幾行的更新說明文字，用來把對話框撐得比畫面還高`,
  ),
};

for (const viewport of [
  { name: '手機橫向', width: 932, height: 430 },
  { name: 'iPhone SE', width: 375, height: 667 },
]) {
  test(`更新對話框在${viewport.name}（${viewport.width}×${viewport.height}）可以捲到按鈕並關閉`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'mobile-chrome',
      '桌面專案會啟用固定尺寸的手機展示框，短視窗情境不適用',
    );

    const assertCleanBrowser = monitorBrowser(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.route('**/version.json*', (route) => route.fulfill({ json: longRelease }));
    await openApp(page);

    const dialog = page.getByRole('dialog', { name: longRelease.title });
    await expect(dialog).toBeVisible();

    const shape = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        screenHeight: window.innerHeight,
        contentHeight: element.scrollHeight,
        overflowY: getComputedStyle(element).overflowY,
      };
    });
    // Content height, not "is it scrollable": before the fix the dialog was
    // never a scroll container, and this check must hold either way.
    expect(
      shape.contentHeight,
      'fixture must be taller than the screen, or this proves nothing',
    ).toBeGreaterThan(shape.screenHeight);
    expect(shape.top).toBeGreaterThanOrEqual(0);
    expect(shape.bottom, 'the dialog must fit on screen').toBeLessThanOrEqual(shape.screenHeight);
    expect(['auto', 'scroll'], 'the dialog itself must be what a finger scrolls').toContain(
      shape.overflowY,
    );

    await dialog.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const later = await page.getByRole('button', { name: '稍後提醒' }).boundingBox();
    expect(later).not.toBeNull();
    expect(later!.y + later!.height).toBeLessThanOrEqual(viewport.height);
    await page.mouse.click(later!.x + later!.width / 2, later!.y + later!.height / 2);
    await expect(dialog).toBeHidden();

    assertCleanBrowser();
  });
}
