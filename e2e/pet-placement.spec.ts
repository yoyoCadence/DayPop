import { expect, test, type Page } from '@playwright/test';
import { monitorBrowser, openApp, reloadApp, tabButton } from './support';

const pet = (page: Page) => page.locator('button.cal-pet');
const key = 'daypop.pet-placement';
const saved = (page: Page) => page.evaluate(key => localStorage.getItem(key), key);
const relativeBox = (page: Page) => pet(page).evaluate(element => {
  const rect = element.getBoundingClientRect();
  const layer = element.parentElement!.getBoundingClientRect();
  return { x: rect.x - layer.x, y: rect.y - layer.y, width: rect.width, height: rect.height };
});
async function moveWithKeyboard(page: Page) {
  await pet(page).click();
  await page.getByRole('button', { name: '移動夥伴', exact: true }).click();
  await expect(pet(page)).toBeFocused();
  await expect(page.getByRole('status')).toContainText('方向鍵移動');
  await expect(page.locator('.cal-pet-move-note')).toBeInViewport();
}
async function clearOfControls(page: Page) {
  expect(await page.evaluate(() => {
    const p = document.querySelector('.cal-pet, .cal-pet-tab')!.getBoundingClientRect();
    const f = document.querySelector('.cal-fab')!.getBoundingClientRect();
    const h = document.querySelector('.cal-header')!.getBoundingClientRect();
    const t = document.querySelector('.dp-tabbar')!.getBoundingClientRect();
    return p.top >= h.bottom && p.bottom < t.top && (p.right + 7 < f.left || p.left > f.right + 7 || p.bottom + 7 < f.top || p.top > f.bottom + 7);
  })).toBe(true);
}
test('鍵盤移動可取消／保存，收起側籤交接焦點，跨分頁與重載保留；表單暫藏不改位置', async ({ page }) => {
  const clean = monitorBrowser(page);
  await openApp(page);
  console.log('DP-170 browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  const initial = await relativeBox(page);
  await moveWithKeyboard(page);
  await page.keyboard.press('ArrowUp');
  expect((await relativeBox(page)).y).toBeLessThan(initial.y);
  expect(await saved(page)).toBeNull();
  await page.keyboard.press('Escape');
  expect(await relativeBox(page)).toEqual(initial);
  await moveWithKeyboard(page);
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  const placement = await saved(page);
  expect(placement).not.toBeNull();
  await clearOfControls(page);
  const freePosition = await relativeBox(page);
  await tabButton(page, '搜尋').click();
  await tabButton(page, '日曆').click();
  expect(await relativeBox(page)).toEqual(freePosition);
  await pet(page).click();
  await page.getByRole('button', { name: '收起夥伴', exact: true }).click();
  const tab = page.getByRole('button', { name: /^展開夥伴/ });
  await expect(tab).toBeFocused();
  expect((await tab.boundingBox())!.width).toBe(44);
  await reloadApp(page);
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(pet(page)).toBeFocused();
  expect(await relativeBox(page)).toEqual(freePosition);
  expect(await saved(page)).toBe(placement);
  await page.getByRole('textbox', { name: '快速新增', exact: true }).focus();
  await expect(pet(page)).toBeHidden();
  await page.getByRole('textbox', { name: '快速新增', exact: true }).blur();
  await expect(pet(page)).toBeVisible();
  await page.getByRole('button', { name: '新增', exact: true }).click();
  await expect(pet(page)).toBeHidden();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(pet(page)).toBeVisible();
  expect(await saved(page)).toBe(placement);
  clean();
});
test('實際 pointer 拖曳只有放開才保存，24px 靠邊；避開新增與分頁列，縮放只調整顯示', async ({ page }, info) => {
  const clean = monitorBrowser(page);
  await openApp(page);
  const start = (await pet(page).boundingBox())!;
  const layer = (await page.locator('.cal-pet-layer').boundingBox())!;
  const content = (await page.locator('.cal-screen').boundingBox())!;
  await page.mouse.move(start.x + 30, start.y + 30);
  await page.mouse.down();
  await page.mouse.move(layer.x + layer.width - 30, content.y + content.height - 44, { steps: 8 });
  expect(await saved(page)).toBeNull();
  await page.mouse.up();
  await expect(page.locator('.cal-pet-bubble')).toHaveCount(0);
  expect(JSON.parse((await saved(page))!).x).toBe(1);
  await clearOfControls(page);
  const placement = await saved(page);
  if (info.project.name === 'mobile-chrome') {
    await page.setViewportSize({ width: 844, height: 390 });
    await clearOfControls(page);
    expect(await saved(page)).toBe(placement);
    await page.setViewportSize({ width: 390, height: 200 });
    await expect(pet(page)).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(pet(page)).toBeVisible();
    expect(await saved(page)).toBe(placement);
  }
  await pet(page).click();
  await expect(page.locator('.cal-pet-bubble')).toBeVisible();
  clean();
});
