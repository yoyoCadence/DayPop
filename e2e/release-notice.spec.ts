import { expect, test } from '@playwright/test';
import { monitorBrowser, openApp, reloadApp, tabButton } from './support';

/**
 * DP-090 — release notes reach people, and 檢查更新 always answers.
 *
 * Before this, notes were only ever shown by the update prompt, and that prompt
 * only appears in a session that was already running the old build: the
 * service worker serves navigations network-first, so simply relaunching the
 * app ran the new build, the version check found nothing newer, and nobody saw
 * the notes. A manual 檢查更新 that found nothing newer showed nothing at all.
 *
 * The first test does not seed "already seen" (see `openApp`), so it exercises
 * the real first launch and the real record that the notes were shown.
 */
test('第一次開啟這個版本會自動顯示更新內容，看過後重新整理不再出現', async ({ page }) => {
  const assertCleanBrowser = monitorBrowser(page);
  await openApp(page, '/', { releaseNotesSeen: false });

  const notice = page.getByRole('dialog').filter({ hasText: '已更新 · v' });
  await expect(notice).toBeVisible();
  await expect(notice.locator('li').first()).toBeVisible();
  await notice.getByRole('button', { name: '知道了' }).click();
  await expect(notice).toBeHidden();

  await reloadApp(page);
  // The check runs just after first paint; without a settle this would pass
  // before the dialog had any chance to come back.
  await page.waitForTimeout(1_500);
  await expect(notice).toHaveCount(0);

  assertCleanBrowser();
});

test('設定的「檢查更新」在已是最新版本時會明確說明', async ({ page }) => {
  const assertCleanBrowser = monitorBrowser(page);
  await openApp(page);

  await tabButton(page, '設定').click();
  await page.getByRole('button', { name: '檢查更新' }).click();

  const result = page.getByRole('dialog', { name: '目前已是最新版本' });
  await expect(result).toBeVisible();
  await expect(result).toContainText('已是最新版本 · v');
  await result.getByRole('button', { name: '知道了' }).click();
  await expect(result).toBeHidden();

  assertCleanBrowser();
});

test('檢查更新失敗時也會說明原因', async ({ page }) => {
  // No `monitorBrowser` here: Chromium logs the deliberate 503 below as a
  // console error, which is the point of the test rather than a regression.
  await openApp(page);
  await page.route('**/version.json*', (route) => route.fulfill({ status: 503, body: 'down' }));

  await tabButton(page, '設定').click();
  await page.getByRole('button', { name: '檢查更新' }).click();

  const result = page.getByRole('dialog', { name: '暫時無法檢查更新' });
  await expect(result).toBeVisible();
  await expect(result).toContainText('HTTP 503');
  await result.getByRole('button', { name: '知道了' }).click();
  await expect(result).toBeHidden();
});
