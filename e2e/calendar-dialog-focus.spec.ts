import { expect, test, type Locator, type Page } from '@playwright/test';
import { monitorBrowser, openApp, tabButton } from './support';

/**
 * DP-154 — the calendar dialog keeps keyboard focus, with real key presses.
 *
 * The 2026-10-13 review: 設定 → 新增日曆 → type a name → Shift+Tab reached the
 * 設定 tab, Shift+Tab again 綜覽, Enter switched tabs, and the dialog and the
 * typed name were gone. `aria-modal="true"` had stopped none of it.
 */

/** Whether focus is anywhere in the dialog's layer, backdrop included. */
function focusIsIn(dialog: Locator) {
  return dialog.evaluate((element) =>
    Boolean(element.closest('.cal-manage-layer')?.contains(document.activeElement)),
  );
}

async function walk(page: Page, dialog: Locator, key: 'Tab' | 'Shift+Tab', presses: number) {
  for (let press = 1; press <= presses; press += 1) {
    await page.keyboard.press(key);
    expect(await focusIsIn(dialog), `${key} #${press}`).toBe(true);
  }
}

test('新增日曆開著時，Tab 與 Shift+Tab 都走不出對話框，Escape 關閉後焦點回到新增按鈕', async ({ page }) => {
  const assertCleanBrowser = monitorBrowser(page);
  await openApp(page);
  await tabButton(page, '設定').click();
  const add = page.getByRole('button', { name: '＋ 新增日曆', exact: true });
  await add.click();
  const dialog = page.getByRole('dialog', { name: '新增日曆' });
  const name = dialog.getByLabel('名稱');
  await expect(name).toBeFocused();
  await name.fill('審查用草稿');

  // The review's two presses, then a full lap each way and then some.
  await walk(page, dialog, 'Shift+Tab', 2);
  const stops = await dialog.locator('input, button').count();
  await walk(page, dialog, 'Tab', stops + 2);
  await walk(page, dialog, 'Shift+Tab', stops + 2);

  await expect(page.locator('nav.dp-tabbar')).toHaveAttribute('inert', '');
  await expect(page.locator('main.dp-appbody')).toHaveAttribute('inert', '');
  await expect(tabButton(page, '設定')).toHaveAttribute('aria-current', 'page');
  await expect(name).toHaveValue('審查用草稿');

  await name.focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();
  await expect(page.locator('nav.dp-tabbar')).not.toHaveAttribute('inert');
  // Escape cancels: nothing was saved.
  await expect(page.locator('.cal-manage-name', { hasText: '審查用草稿' })).toHaveCount(0);

  assertCleanBrowser();
});

test('編輯日曆以 Escape 關閉後，焦點回到那個日曆的編輯按鈕', async ({ page }) => {
  const assertCleanBrowser = monitorBrowser(page);
  await openApp(page);
  await tabButton(page, '設定').click();
  const open = page.locator('.cal-manage-open').first();
  await open.click();
  const dialog = page.getByRole('dialog', { name: '編輯日曆' });
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();

  assertCleanBrowser();
});
