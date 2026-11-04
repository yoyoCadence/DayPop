import { expect, test, type Locator, type Page } from '@playwright/test';
import { reminderDialog, reminderLogin } from '../reminder-support';
import { calendarViewButton, monitorBrowser, tabButton } from '../support';
import { chooseMonthMode, seedMonthPaging, swipeMonth } from './monthPaging';

async function fitsHorizontally(dialog: Locator) {
  await dialog.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
  const geometry = await dialog.evaluate(el => {
    const bounds = el.getBoundingClientRect();
    const viewport = el.closest('.dp-viewport')!.getBoundingClientRect();
    const fields = [...el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:not([type="file"]), select, textarea')];
    return {
      left: bounds.left, right: bounds.right, viewportLeft: viewport.left, viewportRight: viewport.right,
      horizontalOverflow: el.scrollWidth - el.clientWidth,
      outsideFields: fields.filter(field => {
        const rect = field.getBoundingClientRect();
        return rect.left < bounds.left || rect.right > bounds.right;
      }).map(field => field.getAttribute('aria-label') ?? field.id),
      smallFields: fields.filter(field => !['checkbox', 'radio'].includes(field.type) && parseFloat(getComputedStyle(field).fontSize) < 16).map(field => field.getAttribute('aria-label') ?? field.id),
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.viewportLeft);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportRight);
  expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(geometry.outsideFields).toEqual([]);
  expect.soft(geometry.smallFields, 'editing must not invite mobile focus zoom').toEqual([]);
  const body = dialog.locator('.cal-sheet-body');
  if (await body.count()) expect(await body.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
}

/** Uses synthetic account/reminder ports; no real account, subscription or OS permission. */
export async function checkMobileDialogs(page: Page) {
  const clean = monitorBrowser(page);
  await reminderLogin(page);
  await page.locator('.cal-manage-open').first().click();
  const calendar = page.getByRole('dialog', { name: '編輯日曆', exact: true });
  await calendar.getByLabel('名稱', { exact: true }).fill('CalendarWithoutSpaces'.repeat(4));
  await calendar.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(calendar).toBeHidden();
  const personal = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('daypop.account-cache.')).map(key => [key, localStorage.getItem(key)])));
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 568, height: 320 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.locator('.reminder-calendar-row').click();
    const reminder = reminderDialog(page);
    await reminder.getByLabel('開啟這本日曆的提醒').check();
    await fitsHorizontally(reminder);
    if (viewport.width === 390 || viewport.width === 1280) await page.screenshot({ path: test.info().outputPath(`reminder-${viewport.width}.png`) });
    await reminder.getByLabel('全天事項與待辦的時刻').fill('08:30');
    await reminder.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.locator('.reminder-calendar-row')).toBeFocused();

    await tabButton(page, '日曆').click();
    await page.getByRole('button', { name: '新增', exact: true }).click();
    const event = page.getByRole('dialog', { name: '新增行程', exact: true });
    await event.getByLabel('標題', { exact: true }).fill('手機表單寬度驗證');
    await fitsHorizontally(event);
    if (viewport.width === 390 || viewport.width === 1280) await page.screenshot({ path: test.info().outputPath(`event-${viewport.width}.png`) });
    await event.getByLabel('開始', { exact: true }).fill('09:00');
    await event.getByLabel('結束', { exact: true }).fill('10:00');
    await event.getByLabel('備註', { exact: true }).fill('上下捲動後仍可編輯');
    await fitsHorizontally(event);
    await event.getByRole('button', { name: '取消', exact: true }).click();
    await expect(event).toBeHidden();
    await tabButton(page, '設定').click();
  }
  expect(await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('daypop.account-cache.')).map(key => [key, localStorage.getItem(key)])))).toEqual(personal);
  clean();
}

export async function checkInstalledPageGestures(page: Page, nativeTouch: boolean) {
  const clean = monitorBrowser(page);
  // Explicit installed-mode substitute, not a claim about actual iPhone UI.
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }));
  await seedMonthPaging(page);
  const viewport = page.locator('.dp-viewport');
  await expect(viewport).toHaveAttribute('data-installed', '');
  expect(await viewport.evaluate(el => getComputedStyle(el).touchAction)).toBe('pan-x pan-y');
  expect(await page.getByRole('textbox', { name: '快速新增', exact: true }).evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  expect(await viewport.evaluate(el => {
    const gesture = new Event('gesturestart', { bubbles: true, cancelable: true });
    const move = new Event('touchmove', { bubbles: true, cancelable: true });
    el.dispatchEvent(gesture); el.dispatchEvent(move);
    return { pinchCancelled: gesture.defaultPrevented, moveCancelled: move.defaultPrevented };
  })).toEqual({ pinchCancelled: true, moveCancelled: false });
  const before = await page.evaluate(() => localStorage.getItem('daypop.user-data'));
  await chooseMonthMode(page, '單月翻頁');
  await swipeMonth(page, nativeTouch);
  await expect(page.locator('h1.cal-period')).toHaveText('2026年 12月');
  await calendarViewButton(page, '週').click();
  expect(await page.locator('.cal-week').evaluate(el => { el.scrollLeft = el.scrollWidth; return el.scrollLeft; })).toBeGreaterThan(0);
  await calendarViewButton(page, '月').click();
  await tabButton(page, '搜尋').click();
  await tabButton(page, '設定').click();
  expect(await viewport.locator('input, select, textarea').evaluateAll(fields => fields.filter(field => parseFloat(getComputedStyle(field).fontSize) < 16).length)).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(before);
  clean();
}
