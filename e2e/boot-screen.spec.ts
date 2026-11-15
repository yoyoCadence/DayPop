import { expect, test } from '@playwright/test';
import { monitorBrowser } from './support';

// DP-258: the start-up cover stays until the data is ready, then leaves with
// the calendar and any release notice already on the page underneath.
test('開啟時先顯示載入畫面，資料備妥後與更新公告一起交接', async ({ page }) => {
  const clean = monitorBrowser(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/src/main.tsx', async (route) => { await gate; await route.continue(); });
  // Module scripts run before DOMContentLoaded, so the held entry holds that
  // event too; the cover is already in the parsed markup by then.
  await page.goto('/', { waitUntil: 'commit' });
  const boot = page.locator('#boot');
  await expect(boot).toBeAttached();
  await expect(boot).toHaveAttribute('role', 'status');
  await expect(boot).toHaveAttribute('aria-label', '日蹦載入中');
  await expect(page.locator('.dp-viewport')).toHaveCount(0);
  release();
  await expect(boot).toHaveCount(0);
  await expect(page.locator('.dp-viewport')).toBeVisible();
  // A first run on this device shows the current release's notes.
  await expect(page.getByRole('dialog')).toBeVisible();
  clean();
});

test('要求減少動態效果時，載入畫面直接移除不淡出', async ({ page }) => {
  const clean = monitorBrowser(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const removed = page.waitForFunction(() => !document.getElementById('boot'));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await removed;
  expect(await page.evaluate(() => document.querySelector('.dp-boot.is-done'))).toBeNull();
  clean();
});
