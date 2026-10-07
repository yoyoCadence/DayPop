import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { agendaRow, calendarViewButton, localTodayKey, openApp, tabButton } from './support';

/**
 * A render error must not leave a blank page — DP-139.
 *
 * The dev server serves every source module on its own URL, so a screen can be
 * swapped for one that throws without adding a test hook to production code.
 * These run the real `main.tsx` composition, which no unit test covers.
 *
 * React reports caught errors through `console.error`, so unlike most specs
 * these do not assert a clean console.
 */
const GUEST_KEY = 'daypop.user-data';

function breakModule(page: Page, file: RegExp, source: string) {
  return page.route(file, (route) => route.fulfill({ contentType: 'text/javascript', body: source }));
}

async function createEvent(page: Page, title: string) {
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新增行程', exact: true });
  await create.getByLabel('標題').fill(title);
  await create.getByLabel('日期', { exact: true }).fill(await localTodayKey(page));
  await create.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(create).toHaveCount(0);
}

const guestBytes = (page: Page) => page.evaluate((key) => localStorage.getItem(key), GUEST_KEY);

test('單一畫面出錯時只換掉那個畫面，其他分頁、匯出備份與資料都不受影響', async ({ page }, testInfo) => {
  const searchScreen = /\/src\/screens\/SearchScreen\.tsx(\?.*)?$/;
  await breakModule(
    page,
    searchScreen,
    `export function SearchScreen() { throw new Error('DP-139 測試錯誤：搜尋畫面壞了'); }`,
  );
  await openApp(page);
  await createEvent(page, '錯誤邊界行程');
  const stored = await guestBytes(page);
  expect(stored).toContain('錯誤邊界行程');

  await tabButton(page, '搜尋').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('這個畫面暫時無法顯示');
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('你的資料沒有被刪除');
  await expect(alert).toBeInViewport();
  await expect(page.getByText('「設定」匯出備份')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主導覽' })).toBeVisible();
  await page.getByText('錯誤訊息', { exact: true }).click();
  await expect(page.getByText('DP-139 測試錯誤：搜尋畫面壞了')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // The exit the fallback points at works: a real backup with the event in it.
  await tabButton(page, '設定').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('設定');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '⬇ 匯出資料', exact: true }).click();
  const download = await pending;
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  expect(await readFile(path, 'utf8')).toContain('錯誤邊界行程');

  await tabButton(page, '日曆').click();
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, '錯誤邊界行程')).toHaveCount(1);
  expect(await guestBytes(page)).toBe(stored);

  // 重新載入 App really reloads: with the module healthy again 搜尋 is back.
  await tabButton(page, '搜尋').click();
  await page.unroute(searchScreen);
  await page.getByRole('button', { name: '重新載入 App', exact: true }).click();
  await expect(page.locator('.dp-viewport')).toBeVisible();
  await tabButton(page, '搜尋').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('搜尋');
  expect(await guestBytes(page)).toBe(stored);
});

test('App 無法啟動時顯示說明與重新載入，裝置上的資料原封不動', async ({ page }) => {
  await openApp(page);
  await createEvent(page, '啟動錯誤前的行程');
  const stored = await guestBytes(page);

  const app = /\/src\/App\.tsx(\?.*)?$/;
  await breakModule(
    page,
    app,
    `export default function App() { throw new Error('DP-139 測試錯誤：App 無法啟動'); }`,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  const alert = page.getByRole('alert');
  await expect(alert.getByRole('heading', { level: 1 })).toHaveText('日蹦暫時無法啟動');
  await expect(alert).toContainText('資料沒有被刪除');
  await expect(alert.getByRole('button', { name: '重新載入', exact: true })).toBeInViewport();
  await expect(page.locator('.dp-viewport')).toHaveCount(0);
  expect(await guestBytes(page)).toBe(stored);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.unroute(app);
  await alert.getByRole('button', { name: '重新載入', exact: true }).click();
  await expect(page.locator('.dp-viewport')).toBeVisible();
  await calendarViewButton(page, '列表').click();
  await expect(agendaRow(page, '啟動錯誤前的行程')).toHaveCount(1);
  expect(await guestBytes(page)).toBe(stored);
});
