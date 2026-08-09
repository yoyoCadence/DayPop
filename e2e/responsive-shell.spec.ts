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
