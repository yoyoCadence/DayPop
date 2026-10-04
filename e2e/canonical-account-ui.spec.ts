import { expect, test } from '@playwright/test';
import { THEMES, THEME_IDS } from '../src/theme/themes';
import { E2E_EMAIL, monitorBrowser, openApp, tabButton } from './support';

function rgb(hex: string): string {
  return `rgb(${[1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;
}

// Real browser CSS matters here: jsdom cannot catch inheritance from the old
// purple bridge, hardcoded white surfaces or stylesheet-order regressions.
for (const mode of ['light', 'dark'] as const) {
  test(`帳號、登入與更新公告沿用六主題的${mode}配色`, async ({ page }) => {
    const assertCleanBrowser = monitorBrowser(page);
    await openApp(page, '/e2e/auth.html');
    console.log('browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
    await tabButton(page, '設定').click();
    await page.getByRole('button', { name: mode === 'light' ? '☀ 淺色' : '☾ 深色', exact: true }).click();

    for (const id of THEME_IDS) {
      const theme = THEMES[id];
      const palette = theme[mode];
      await page.locator('.dp-theme-card').filter({ hasText: theme.desc }).click();
      const account = page.locator('.storage-scope-banner');
      await expect(account).toHaveCSS('background-color', rgb(palette.surface));
      await expect(account).toHaveCSS('color', rgb(palette.fg));
      await expect(account).toHaveCSS('border-top-color', rgb(palette.border));
      await expect(account).toHaveCSS('border-top-width', `${theme.borderWidth}px`);
      await expect(account).toHaveCSS('border-top-left-radius', `${theme.radius}px`);
      await expect(page.locator('.release-panel')).toHaveCSS('background-color', rgb(palette.surface));

      await page.getByRole('button', { name: '登入／註冊', exact: true }).click();
      const auth = page.getByRole('dialog', { name: '保存你的日蹦資料' });
      await expect(auth).toHaveCSS('background-color', rgb(palette.surface));
      await expect(auth).toHaveCSS('color', rgb(palette.fg));
      await expect(auth).toHaveCSS('border-top-width', `${theme.borderWidth}px`);
      await expect(auth.getByRole('heading')).toHaveCSS('font-size', '20px');
      await expect(auth.getByLabel('Email')).toHaveCSS('background-color', rgb(palette.bg));
      await expect(auth.getByLabel('Email')).toHaveCSS('color', rgb(palette.fg));
      const submit = auth.getByRole('button', { name: '登入', exact: true });
      await expect(submit).toHaveCSS('background-color', rgb(palette.accent));
      await expect(submit).toHaveCSS('color', rgb(palette.accentFg));
      await expect(submit).toHaveCSS('border-top-width', `${theme.borderWidth}px`);
      const viewport = await page.locator('.dp-viewport').boundingBox();
      const bounds = await auth.boundingBox();
      expect(viewport).not.toBeNull();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(viewport!.x);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.x + viewport!.width);
      expect(bounds!.y).toBeGreaterThanOrEqual(viewport!.y);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.y + viewport!.height);
      if (id === 'manga') {
        await auth.getByLabel('Email').click();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await expect(submit).toBeFocused();
        await expect(submit).toHaveCSS('outline-width', '2px');
        await expect(submit).toHaveCSS('outline-color', rgb(palette.fg));
      }
      await auth.getByLabel('Email').fill(E2E_EMAIL);
      await auth.getByLabel('密碼', { exact: true }).fill('deliberately-wrong-password');
      await submit.click();
      const feedback = auth.getByRole('status');
      await expect(feedback).toContainText('帳號或密碼錯誤');
      await expect(feedback).toHaveCSS('background-color', rgb(palette.surface2));
      await expect(feedback).toHaveCSS('color', rgb(palette.fg));
      await auth.getByRole('button', { name: '忘記密碼？' }).click();
      await expect(page.getByRole('dialog', { name: '忘記密碼' })).toHaveCSS('background-color', rgb(palette.surface));
      await page.getByRole('button', { name: '關閉登入視窗' }).click();

      await page.getByRole('button', { name: '檢查更新', exact: true }).click();
      const notice = page.getByRole('dialog', { name: '目前已是最新版本' });
      await expect(notice).toHaveCSS('background-color', rgb(palette.surface));
      await expect(notice).toHaveCSS('color', rgb(palette.fg));
      await expect(notice.getByRole('heading', { level: 2 })).toHaveCSS('font-size', '20px');
      await notice.getByRole('button', { name: '知道了' }).click();
      await expect(notice).toBeHidden();
    }
    assertCleanBrowser();
  });
}

for (const viewport of [{ width: 375, height: 667 }, { width: 932, height: 430 }]) {
  test(`登入對話框在 ${viewport.width}×${viewport.height} 可捲動並以畫面座標關閉`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', '桌面專案使用固定展示框');
    const assertCleanBrowser = monitorBrowser(page);
    await page.setViewportSize(viewport);
    await openApp(page, '/e2e/auth.html');
    await tabButton(page, '設定').click();
    await page.getByRole('button', { name: '登入／註冊', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '保存你的日蹦資料' });
    const shape = await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom, overflow: getComputedStyle(element).overflowY };
    });
    expect(shape.top).toBeGreaterThanOrEqual(0);
    expect(shape.bottom).toBeLessThanOrEqual(viewport.height);
    expect(shape.overflow).toBe('auto');
    await dialog.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const close = await dialog.getByRole('button', { name: '繼續使用遊客模式' }).boundingBox();
    expect(close).not.toBeNull();
    expect(close!.y + close!.height).toBeLessThanOrEqual(viewport.height);
    await page.mouse.click(close!.x + close!.width / 2, close!.y + close!.height / 2);
    await expect(dialog).toBeHidden();
    assertCleanBrowser();
  });
}
