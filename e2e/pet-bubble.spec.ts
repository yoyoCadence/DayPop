import { expect, test, type Page } from '@playwright/test';
import { createEmptyUserData, type DayPopUserData } from '../src/domain/types';
import { monitorBrowser, openApp, reloadApp, tabButton } from './support';

/**
 * The pet's speech bubble — DP-169, ported from the原檔 (`:488-530`,
 * `:1153-1157`, `:1307`).
 *
 * The unit cases cover the lists and the add form. This covers what only a
 * browser shows: that the bubble sits where the原檔 puts it with its tail over
 * the pet, that tapping outside it — the tab bar included — only closes it,
 * the keyboard, that what it adds is saved on the right day, and that it stays
 * on screen and scrolls on a short phone.
 */

const NOW = '2026-10-17T02:00:00.000Z'; // Saturday 10:00 in Asia/Taipei
const TODAY = '2026-10-17';
const TOMORROW = '2026-10-18';

function seeded(): DayPopUserData {
  const data = createEmptyUserData({ now: NOW });
  data.preferences.timezone = 'Asia/Taipei';
  data.preferences.petName = '摩卡';
  const common = {
    calendarId: data.calendars[0]!.id,
    parentId: null,
    completedAt: null,
    sharingScope: 'inherit' as const,
    createdAt: NOW,
    updatedAt: NOW,
  };
  data.todos = [
    { ...common, id: '16900000-0000-4000-8000-000000000001', title: '繳電費', dueDate: '2026-10-15', priority: 'high', sortOrder: 0 },
    { ...common, id: '16900000-0000-4000-8000-000000000002', title: '買牛奶', dueDate: TODAY, priority: 'none', sortOrder: 1 },
  ];
  return data;
}

async function open(page: Page) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript((data) => {
    if (!localStorage.getItem('daypop.user-data')) {
      localStorage.setItem(
        'daypop.user-data',
        JSON.stringify({ schemaVersion: 4, revision: 0, updatedAt: data.calendars[0]!.createdAt, data }),
      );
    }
  }, seeded());
  await openApp(page);
  console.log('DP-169 browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
}

const pet = (page: Page) => page.locator('button.cal-pet');
const bubble = (page: Page) => page.getByRole('dialog', { name: '摩卡', exact: true });
const stored = (page: Page): Promise<DayPopUserData> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('daypop.user-data')!).data);

test('點寵物先打招呼，再列出今日與明日待辦；新增的待辦存在對的那一天', async ({ page }) => {
  const clean = monitorBrowser(page);
  await open(page);
  await expect(pet(page)).toHaveAccessibleName('摩卡，今天還有 2 件待辦');
  await pet(page).click();
  await expect(bubble(page)).toContainText('嗨，我是摩卡！今天還有 2 件待辦，其中 1 件重要，要一起看看嗎？');
  await expect(bubble(page).getByRole('button', { name: '看待辦', exact: true })).toBeFocused();

  // Where the原檔 puts it: 12px from the left, 150px above the bottom, the
  // tail over the pet's head. Measured once the pop-in has finished.
  const geometry = await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished),
    );
    const viewport = document.querySelector('.dp-viewport')!.getBoundingClientRect();
    const box = document.querySelector('.cal-pet-bubble')!.getBoundingClientRect();
    const character = document.querySelector('button.cal-pet')!.getBoundingClientRect();
    return {
      left: Math.round(box.left - viewport.left),
      bottom: Math.round(viewport.bottom - box.bottom),
      width: Math.round(box.width),
      petLeft: Math.round(character.left - viewport.left),
      petBottom: Math.round(viewport.bottom - character.bottom),
      tailAbovePet: box.bottom < character.top && character.top - box.bottom < 20,
    };
  });
  expect(geometry).toEqual({ left: 12, bottom: 150, width: 270, petLeft: 26, petBottom: 78, tailAbovePet: true });

  await bubble(page).getByRole('button', { name: '看待辦', exact: true }).click();
  await expect(bubble(page).getByRole('heading', { name: '今日待辦' })).toBeFocused();
  await expect(bubble(page).getByText('逾期・原10/15', { exact: true })).toBeVisible();
  await bubble(page).getByLabel('新增今日待辦').fill('買麵包');
  await bubble(page).getByLabel('新增今日待辦').press('Enter');
  await expect(bubble(page).getByRole('button', { name: '完成 買麵包', exact: true })).toBeVisible();
  await expect(bubble(page).getByLabel('新增今日待辦')).toHaveValue('');
  await bubble(page).getByLabel('新增明日待辦').fill('寄包裹');
  await bubble(page).getByLabel('新增明日待辦').press('Enter');
  await expect(bubble(page).getByRole('button', { name: '完成 寄包裹', exact: true })).toBeVisible();
  await bubble(page).getByRole('button', { name: '完成 買牛奶', exact: true }).click();
  await expect(bubble(page).getByRole('button', { name: '完成 買牛奶', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Ticking an overdue todo takes it off 今日; focus stays in the bubble.
  await bubble(page).getByRole('button', { name: '完成 繳電費', exact: true }).click();
  await expect(bubble(page).getByText('繳電費', { exact: true })).toHaveCount(0);
  await expect(bubble(page).getByRole('heading', { name: '今日待辦' })).toBeFocused();

  const saved = await stored(page);
  expect(saved.todos.map((todo) => [todo.title, todo.dueDate, todo.completedAt !== null])).toEqual([
    ['繳電費', '2026-10-15', true],
    ['買牛奶', TODAY, true],
    ['買麵包', TODAY, false],
    ['寄包裹', TOMORROW, false],
  ]);
  await expect(page.locator('.cal-pet-badge')).toHaveText('1');

  await bubble(page).getByRole('button', { name: '關閉', exact: true }).click();
  await expect(bubble(page)).toHaveCount(0);
  await expect(pet(page)).toBeFocused();
  // The day sheet agrees about the day: 寄包裹 is tomorrow's.
  await page.locator(`[data-date-key="${TOMORROW}"]`).first().click();
  await expect(page.getByRole('dialog', { name: '10月18日 週日' }).getByRole('button', { name: '完成 寄包裹' })).toBeVisible();
  await page.keyboard.press('Escape');

  // A new session greets again; the lists come back from storage.
  await reloadApp(page);
  await pet(page).click();
  await expect(bubble(page)).toContainText('嗨，我是摩卡！今天還有 1 件待辦，要一起看看嗎？');
  await bubble(page).getByRole('button', { name: '看待辦', exact: true }).click();
  await expect(bubble(page).getByRole('button', { name: '完成 買麵包', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(bubble(page).getByRole('button', { name: '完成 寄包裹', exact: true })).toBeVisible();
  clean();
});

test('點泡泡外面，連分頁列在內，只會關掉泡泡；之後直接打開待辦', async ({ page }) => {
  const clean = monitorBrowser(page);
  await open(page);
  await pet(page).click();
  await expect(bubble(page)).toBeVisible();
  // At the screen position, not through the locator: the tab is inert behind
  // the bubble, and what has to answer the tap is the catcher in front of it.
  const settings = (await tabButton(page, '設定').boundingBox())!;
  await page.mouse.click(settings.x + settings.width / 2, settings.y + settings.height / 2);
  await expect(bubble(page)).toHaveCount(0);
  await expect(tabButton(page, '日曆')).toHaveAttribute('aria-current', 'page');

  await pet(page).click();
  await expect(bubble(page).getByRole('heading', { name: '今日待辦' })).toBeVisible();
  await expect(bubble(page).getByText('嗨，我是摩卡', { exact: false })).toHaveCount(0);
  const month = (await page.locator(`[data-date-key="${TODAY}"]`).first().boundingBox())!;
  await page.mouse.click(month.x + month.width / 2, month.y + month.height / 2);
  await expect(bubble(page)).toHaveCount(0);
  // The tap only closed the bubble; it did not also open 日詳情.
  await expect(page.locator('.cal-day-layer')).toHaveCount(0);
  clean();
});

test('鍵盤：Enter 打開、Tab 留在泡泡裡、Escape 關閉並回到寵物', async ({ page }) => {
  const clean = monitorBrowser(page);
  await open(page);
  await pet(page).focus();
  await page.keyboard.press('Enter');
  await expect(bubble(page).getByRole('button', { name: '看待辦', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(bubble(page).getByRole('heading', { name: '今日待辦' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(bubble(page).getByRole('button', { name: '完成 繳電費', exact: true })).toBeFocused();
  // Shift+Tab past the first control wraps to the last one, not to the page.
  await bubble(page).getByRole('button', { name: '關閉', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(bubble(page).getByRole('button', { name: '收起夥伴', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(bubble(page).getByRole('button', { name: '關閉', exact: true })).toBeFocused();
  await bubble(page).getByLabel('新增今日待辦').focus();
  await expect(pet(page)).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(bubble(page)).toHaveCount(0);
  await expect(pet(page)).toBeFocused();
  clean();
});

for (const size of [
  { width: 375, height: 667 },
  { width: 932, height: 430 },
]) {
  test(`${size.width}×${size.height}：泡泡與 ✕ 都在畫面內，放不下的清單在泡泡裡捲動`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', '手機尺寸；桌面是固定的預覽外框');
    const clean = monitorBrowser(page);
    await page.setViewportSize(size);
    await open(page);
    await pet(page).click();
    await bubble(page).getByRole('button', { name: '看待辦', exact: true }).click();
    for (const title of ['一', '二', '三', '四', '五']) {
      await bubble(page).getByLabel('新增今日待辦').fill(`第${title}件`);
      await bubble(page).getByLabel('新增今日待辦').press('Enter');
      await expect(bubble(page).getByRole('button', { name: `完成 第${title}件`, exact: true })).toBeVisible();
    }
    const layout = await page.evaluate(() => {
      const box = document.querySelector('.cal-pet-bubble')!.getBoundingClientRect();
      const close = document.querySelector('.cal-pet-bubble-close')!.getBoundingClientRect();
      const body = document.querySelector<HTMLElement>('.cal-pet-bubble-body')!;
      return {
        inside: box.top >= 0 && close.top >= 0 && box.right <= innerWidth && close.right <= innerWidth,
        // DP-170: an active form hides the character, without closing its
        // bubble or moving the saved position.
        petHidden: document.querySelector<HTMLButtonElement>('button.cal-pet')!.hidden,
        scrolls: body.scrollHeight > body.clientHeight,
        pageScrolls: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(layout).toEqual({ inside: true, petHidden: true, scrolls: size.height < 500, pageScrolls: false });

    // Scroll the list the way a finger would, then tap the last field where it
    // is on screen: a locator click would scroll it into view for us.
    await page.locator('.cal-pet-bubble-body').evaluate((body) => {
      body.scrollTop = body.scrollHeight;
    });
    const field = bubble(page).getByLabel('新增明日待辦');
    const box = (await field.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(field).toBeFocused();
    clean();
  });
}
