import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  agendaRow, calendarViewButton, localTodayKey, monitorBrowser, openApp,
} from './support';

/**
 * DP-155 — the calendar's sheets keep keyboard focus, with real key presses.
 *
 * The 2026-10-13 review measured both: Shift+Tab out of 新增行程 reached the
 * 設定 tab on the fifth press, and 日詳情 never took focus at all, so the first
 * Tab after opening it landed on the 新增 button behind it. Escape used to be
 * decided by one handler in `CalendarScreen`; it is the shared modal stack now,
 * so the stacking cases are covered here too.
 */

function focusIsIn(layer: Locator) {
  return layer.evaluate((element) => element.contains(document.activeElement));
}

async function walk(page: Page, layer: Locator, key: 'Tab' | 'Shift+Tab', presses: number) {
  for (let press = 1; press <= presses; press += 1) {
    await page.keyboard.press(key);
    expect(await focusIsIn(layer), `${key} #${press}`).toBe(true);
  }
}

async function lap(page: Page, layer: Locator) {
  const stops = await layer.locator('button, input, select, textarea').count();
  await walk(page, layer, 'Tab', stops + 2);
  await walk(page, layer, 'Shift+Tab', stops + 2);
}

async function todayCell(page: Page) {
  return page.locator(`[data-date-key="${await localTodayKey(page)}"]`).first();
}

test('日詳情開啟時焦點進入 sheet、Tab 走不出去，Escape 後回到日期格', async ({ page }) => {
  const assertCleanBrowser = monitorBrowser(page);
  await openApp(page);
  const cell = await todayCell(page);
  await cell.click();
  const day = page.locator('.cal-day-layer');
  await expect(day).toBeVisible();
  expect(await focusIsIn(day)).toBe(true);

  await lap(page, day);
  await expect(page.locator('nav.dp-tabbar')).toHaveAttribute('inert', '');

  await page.keyboard.press('Escape');
  await expect(day).toBeHidden();
  await expect(cell).toBeFocused();
  await expect(page.locator('nav.dp-tabbar')).not.toHaveAttribute('inert');

  assertCleanBrowser();
});

test('新增行程開著時 Tab 走不出去，Escape 後焦點回到「新增」', async ({ page }) => {
  const assertCleanBrowser = monitorBrowser(page);
  await openApp(page);
  const add = page.getByRole('button', { name: '新增', exact: true });
  await add.click();
  const sheet = page.locator('.cal-sheet-backdrop');
  await expect(page.getByRole('dialog', { name: '新增行程' })).toBeVisible();
  await expect(sheet.getByLabel('標題', { exact: true })).toBeFocused();

  await lap(page, sheet);

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(add).toBeFocused();

  assertCleanBrowser();
});

test('日詳情上再開新增行程：Escape 只關上層，焦點依序回到「新增事件」與日期格', async ({ page }) => {
  const assertCleanBrowser = monitorBrowser(page);
  await openApp(page);
  const cell = await todayCell(page);
  await cell.click();
  const day = page.locator('.cal-day-layer');
  const newEvent = day.getByRole('button', { name: '＋ 新增事件', exact: true });
  await newEvent.click();
  const sheet = page.locator('.cal-sheet-backdrop');
  await expect(page.getByRole('dialog', { name: '新增行程' })).toBeVisible();
  // The sheet above put the one below out of reach, not just the page.
  await expect(day).toHaveAttribute('inert', '');
  await lap(page, sheet);

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(day).toBeVisible();
  await expect(day).not.toHaveAttribute('inert');
  await expect(newEvent).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(day).toBeHidden();
  await expect(cell).toBeFocused();

  assertCleanBrowser();
});

test('重複事件的範圍對話框：Tab 只在三個按鈕間，Escape 只關它並保留草稿、焦點回到儲存', async ({ page }) => {
  const assertCleanBrowser = monitorBrowser(page);
  await openApp(page);
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新增行程' });
  await create.getByLabel('標題', { exact: true }).fill('每日站會');
  await create.getByLabel('重複', { exact: true }).selectOption('daily');
  await create.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(create).toBeHidden();

  await calendarViewButton(page, '列表').click();
  await agendaRow(page, '每日站會').first().click();
  const edit = page.getByRole('dialog', { name: '編輯行程' });
  await edit.getByLabel('標題', { exact: true }).fill('只改這次的站會');
  const save = edit.getByRole('button', { name: '儲存', exact: true });
  await save.click();

  const scope = page.locator('.cal-scope-layer');
  await expect(page.getByRole('dialog', { name: '修改重複事件' })).toBeVisible();
  await expect(scope.getByRole('button', { name: '只改這一次', exact: true })).toBeFocused();
  await walk(page, scope, 'Tab', 5);
  await walk(page, scope, 'Shift+Tab', 5);

  await page.keyboard.press('Escape');
  await expect(scope).toBeHidden();
  await expect(edit).toBeVisible();
  await expect(edit.getByLabel('標題', { exact: true })).toHaveValue('只改這次的站會');
  await expect(save).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(edit).toBeHidden();

  assertCleanBrowser();
});
