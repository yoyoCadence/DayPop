import { expect, test, type Page } from '@playwright/test';
import {
  E2E_EMAIL,
  E2E_PASSWORD,
  agendaRow,
  calendarViewButton,
  monitorBrowser,
  openApp,
  tabButton,
} from './support';

/**
 * Focusing the attachment picker must not move the App — DP-136.
 *
 * The visually hidden file input was `position: absolute` inside a label that
 * was not a containing block, so it sat at its unscrolled layout position
 * under `.cal-sheet-backdrop`, far below the screen. `.dp-viewport` clips with
 * `overflow: hidden`, which a finger cannot scroll but a focus change can: the
 * moment the input took focus — Tab, or simply pressing 選擇附件 — the browser
 * scrolled the whole App up to reveal it, and on a 375×667 phone 取消／儲存 left
 * the screen with no way to bring them back.
 *
 * `locator.click()` would hide this the same way it hid the update dialog bug:
 * Playwright scrolls ancestors into view first. So the picker is pressed by its
 * on-screen position, after scrolling only the sheet body the way a finger does.
 */
async function openEventWithPicker(page: Page) {
  await openApp(page, '/e2e/auth.html');
  await tabButton(page, '設定').click();
  await page.getByRole('button', { name: '登入／註冊', exact: true }).click();
  const auth = page.getByRole('dialog', { name: '保存你的日蹦資料' });
  await auth.getByLabel('Email').fill(E2E_EMAIL);
  await auth.getByLabel('密碼', { exact: true }).fill(E2E_PASSWORD);
  await auth.getByRole('button', { name: '登入', exact: true }).click();
  await tabButton(page, '設定').click();
  await expect(page.getByText('● 已同步', { exact: true })).toBeVisible();

  await tabButton(page, '日曆').click();
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新增行程', exact: true });
  await create.getByLabel('標題').fill('附件焦點');
  await create.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(create).toHaveCount(0);
  await calendarViewButton(page, '列表').click();
  await agendaRow(page, '附件焦點').click();
  const edit = page.getByRole('dialog', { name: '編輯行程', exact: true });
  await expect(edit.locator('.cal-attachment-picker')).toHaveCount(1);
  // Let the sheet's entry animation finish before measuring positions.
  await expect.poll(() => edit.evaluate((sheet) => sheet.getAnimations().length)).toBe(0);
  return edit;
}

/** What the user can see: where the App and the sheet's title bar are. */
const layout = (page: Page) => page.evaluate(() => {
  const viewport = document.querySelector('.dp-viewport')!;
  const input = document.querySelector('.cal-attachment-picker input')!;
  return {
    appScrollTop: viewport.scrollTop,
    appScrollRange: viewport.scrollHeight - viewport.clientHeight,
    barTop: Math.round(document.querySelector('.cal-sheet-bar')!.getBoundingClientRect().top),
    focusOnPicker: document.activeElement === input,
  };
});

for (const size of [null, { width: 375, height: 667 }]) {
  const name = size ? `iPhone SE（${size.width}×${size.height}）` : '預設尺寸';

  test(`${name}：按下選擇附件後 App 不會被捲走`, async ({ page }, testInfo) => {
    test.skip(size !== null && testInfo.project.name !== 'mobile-chrome', '小螢幕只在手機專案驗證');
    const clean = monitorBrowser(page);
    if (size) await page.setViewportSize(size);
    const edit = await openEventWithPicker(page);
    const before = await layout(page);
    expect(before.appScrollTop).toBe(0);

    // Scroll only the sheet body, as a finger would, then press by position.
    const picker = edit.locator('.cal-attachment-picker');
    await picker.evaluate((label) => {
      const body = label.closest('.cal-sheet-body')!;
      body.scrollTop = body.scrollHeight;
    });
    await expect(picker).toBeInViewport({ ratio: 1 });
    const box = (await picker.boundingBox())!;
    const chooser = page.waitForEvent('filechooser');
    if (testInfo.project.name === 'mobile-chrome') {
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await chooser;

    const after = await layout(page);
    expect(after.focusOnPicker).toBe(true);
    expect(after).toMatchObject({ appScrollTop: 0, barTop: before.barTop });
    await expect(edit.getByRole('button', { name: '取消', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(edit.getByRole('button', { name: '儲存', exact: true })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    clean();
  });

  test(`${name}：Tab 到選擇附件時只捲動表單內容並顯示焦點框`, async ({ page }, testInfo) => {
    test.skip(size !== null && testInfo.project.name !== 'mobile-chrome', '小螢幕只在手機專案驗證');
    const clean = monitorBrowser(page);
    if (size) await page.setViewportSize(size);
    const edit = await openEventWithPicker(page);
    const before = await layout(page);
    // Nothing may give the clipped App a range that focus could scroll into.
    expect(before).toMatchObject({ appScrollTop: 0, appScrollRange: 0 });

    await edit.getByLabel('備註', { exact: true }).focus();
    await edit.locator('.cal-sheet-body').evaluate((body) => { body.scrollTop = 0; });
    await page.keyboard.press('Tab');
    const after = await layout(page);
    expect(after.focusOnPicker).toBe(true);
    expect(after).toMatchObject({ appScrollTop: 0, barTop: before.barTop });

    const picker = edit.locator('.cal-attachment-picker');
    await expect(picker).toBeInViewport({ ratio: 1 });
    expect(await picker.evaluate((label) => {
      const style = getComputedStyle(label);
      return `${style.outlineStyle} ${style.outlineWidth}`;
    })).toBe('solid 2px');
    await expect(edit.getByRole('button', { name: '儲存', exact: true })).toBeInViewport({ ratio: 1 });
    clean();
  });
}
