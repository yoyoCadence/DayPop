import { expect, test, type Locator, type Page } from '@playwright/test';
import { E2E_EMAIL, monitorBrowser, openApp, tabButton } from './support';

/**
 * DP-156 — the account, update, release-notes and import dialogs keep keyboard
 * focus, with real key presses, and a notice never opens over a dialog the
 * person has open.
 *
 * The 2026-10-13 review measured all four letting focus reach the page: the
 * update prompt took no focus at all, the sign-in dialog left it on the button
 * that opened it, release notes lost it on the first Shift+Tab, and the
 * import preview on the second Tab.
 */

function focusIsIn(layer: Locator) {
  return layer.evaluate((element) => element.contains(document.activeElement));
}

async function lap(page: Page, layer: Locator) {
  const stops = await layer.locator('button, input, select, textarea').count();
  for (const key of ['Tab', 'Shift+Tab'] as const) {
    for (let press = 1; press <= stops + 2; press += 1) {
      await page.keyboard.press(key);
      expect(await focusIsIn(layer), `${key} #${press}`).toBe(true);
    }
  }
}

test('更新提示不會蓋在打開的日曆對話框上：等它關掉才出現，焦點在提示裡', async ({ page }) => {
  const assertCleanBrowser = monitorBrowser(page);
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await page.route('**/version.json*', async (route) => {
    await answered;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: '99.0.0',
        releasedAt: '2026-10-14',
        title: '下一版',
        changes: ['改了一件事'],
      }),
    });
  });
  await openApp(page);
  await tabButton(page, '設定').click();
  const add = page.getByRole('button', { name: '＋ 新增日曆', exact: true });
  await add.click();
  const calendar = page.getByRole('dialog', { name: '新增日曆' });
  await calendar.getByLabel('名稱').fill('還沒存的日曆');

  // The version check answers while the person is still typing.
  const delivered = page.waitForResponse('**/version.json*');
  answer();
  await delivered;
  const update = page.locator('.dialog-backdrop').filter({ hasText: '立即更新' });
  await page.waitForTimeout(300);
  await expect(update).toHaveCount(0);
  await expect(calendar.getByLabel('名稱')).toBeFocused();
  await expect(calendar.getByLabel('名稱')).toHaveValue('還沒存的日曆');

  await page.keyboard.press('Escape');
  await expect(calendar).toBeHidden();
  await expect(update).toBeVisible();
  expect(await focusIsIn(update)).toBe(true);
  await lap(page, update);
  await expect(page.locator('nav.dp-tabbar')).toHaveAttribute('inert', '');

  // Escape is 稍後提醒; focus goes back where it was before the prompt.
  await page.keyboard.press('Escape');
  await expect(update).toHaveCount(0);
  await expect(add).toBeFocused();

  assertCleanBrowser();
});

test('版本公告：焦點在「知道了」，Tab 不離開，Escape 等於知道了', async ({ page }) => {
  const assertCleanBrowser = monitorBrowser(page);
  await openApp(page, '/', { releaseNotesSeen: false });
  const notice = page.locator('.dialog-backdrop').filter({ hasText: '已更新 · v' });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole('button', { name: '知道了' })).toBeFocused();
  await lap(page, notice);

  await page.keyboard.press('Escape');
  await expect(notice).toHaveCount(0);
  await expect(page.locator('nav.dp-tabbar')).not.toHaveAttribute('inert');

  assertCleanBrowser();
});

test('登入對話框：開啟時焦點進入，Tab 不離開，Escape 關閉後回到「登入／註冊」', async ({ page }) => {
  const assertCleanBrowser = monitorBrowser(page);
  await openApp(page, '/e2e/auth.html');
  await tabButton(page, '設定').click();
  const open = page.getByRole('button', { name: '登入／註冊', exact: true });
  await open.click();
  const auth = page.locator('.auth-backdrop');
  await expect(page.getByRole('dialog', { name: '保存你的日蹦資料' })).toBeVisible();
  expect(await focusIsIn(auth)).toBe(true);
  await auth.getByLabel('Email').fill(E2E_EMAIL);
  await lap(page, auth);

  await page.keyboard.press('Escape');
  await expect(auth).toHaveCount(0);
  await expect(open).toBeFocused();

  assertCleanBrowser();
});

test('匯入預覽：焦點在「取代資料」，Tab 不離開圖層，Escape 取消匯入', async ({ page }, testInfo) => {
  const assertCleanBrowser = monitorBrowser(page);
  await openApp(page);
  await tabButton(page, '設定').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '⬇ 匯出資料', exact: true }).click();
  const path = testInfo.outputPath('backup.json');
  await (await download).saveAs(path);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '⬆ 匯入資料', exact: true }).click();
  await (await chooser).setFiles(path);

  const preview = page.locator('.data-import-layer');
  await expect(page.getByRole('dialog', { name: '匯入預覽' })).toBeVisible();
  await expect(preview.getByRole('button', { name: '取代資料', exact: true })).toBeFocused();
  await lap(page, preview);

  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(page.locator('nav.dp-tabbar')).not.toHaveAttribute('inert');

  assertCleanBrowser();
});
