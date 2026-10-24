import { expect, test, type Page } from '@playwright/test';
import { monitorBrowser, openApp } from './support';

const pet = (page: Page) => page.locator('button.cal-pet');
const image = (page: Page) => pet(page).locator('img');
async function ready(page: Page, pattern: RegExp) {
  await expect(image(page)).toHaveAttribute('src', pattern);
  await expect(image(page)).toBeVisible();
  expect(await image(page).evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(120);
}
test('預設貓 idle 會動，泡泡靜態，兩次關閉各播放 look 後回 idle；名稱與焦點不變', async ({ page }) => {
  const clean = monitorBrowser(page);
  const requested: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'image' && /orbit-ufo|sleep/.test(request.url())) requested.push(request.url()); });
  await openApp(page);
  console.log('DP-188 browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  await ready(page, /moon-cat-idle.*webp/);
  const before = await image(page).screenshot();
  await page.waitForTimeout(700);
  expect((await image(page).screenshot()).equals(before)).toBe(false);
  await expect(pet(page)).toHaveAccessibleName(/^摩卡，今天/);
  for (let replay = 0; replay < 2; replay++) {
    await pet(page).click(); await ready(page, /idle.*png/);
    await page.getByRole('button', { name: '關閉', exact: true }).click();
    await expect(pet(page)).toBeFocused(); await ready(page, /look.*webp/);
    const first = await image(page).screenshot();
    await page.waitForTimeout(500);
    expect((await image(page).screenshot()).equals(first)).toBe(false);
    await ready(page, /idle.*webp/);
  }
  expect(requested).toEqual([]); clean();
});
test('真正拖移／鍵盤移動使用 grab，放開／取消後回 idle，拖移不誤開泡泡', async ({ page }) => {
  const clean = monitorBrowser(page);
  await openApp(page); await ready(page, /idle.*webp/);
  const initial = (await pet(page).boundingBox())!;
  await page.mouse.move(initial.x + 30, initial.y + 30); await page.mouse.down();
  await page.mouse.move(initial.x + 70, initial.y - 70, { steps: 4 }); await ready(page, /grab.*png/);
  expect(await page.evaluate(() => localStorage.getItem('daypop.pet-placement'))).toBeNull();
  await page.mouse.up(); await ready(page, /idle.*webp/);
  await expect(page.locator('.cal-pet-bubble')).toHaveCount(0);
  await pet(page).click(); await page.getByRole('button', { name: '移動夥伴', exact: true }).click();
  await ready(page, /grab.*png/);
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Escape'); await ready(page, /idle.*webp/);
  clean();
});
test('reduce 使用真正 PNG，暫藏／收起不保留圖片，展開恢復 idle', async ({ page }) => {
  const clean = monitorBrowser(page);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await openApp(page); await ready(page, /idle.*png/);
  const still = await image(page).screenshot(); await page.waitForTimeout(600);
  expect((await image(page).screenshot()).equals(still)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await ready(page, /idle.*webp/);
  await page.getByRole('textbox', { name: '快速新增', exact: true }).focus();
  await expect(pet(page)).toBeHidden(); await expect(image(page)).toHaveCount(0);
  await page.getByRole('textbox', { name: '快速新增', exact: true }).blur(); await ready(page, /idle.*webp/);
  await pet(page).click(); await page.getByRole('button', { name: '收起夥伴', exact: true }).click();
  await expect(page.locator('.cal-pet-art img')).toHaveCount(0);
  await page.getByRole('button', { name: /^展開夥伴/ }).click(); await ready(page, /idle.*webp/);
  clean();
});
test('損壞圖片回原 CSS；泡泡與 reduce 也停止替代角色眨眼', async ({ page }) => {
  const clean = monitorBrowser(page);
  await page.route(/moon-cat-.*\.(webp|png)/, route => route.request().resourceType() === 'image'
    ? route.fulfill({ status: 200, contentType: 'image/webp', body: 'not an image' }) : route.continue());
  await openApp(page); await expect(pet(page).locator('img')).toHaveCount(0);
  const eye = pet(page).locator('.cal-pet-eye.left'); await expect(eye).toBeVisible();
  await expect(pet(page)).toHaveAccessibleName(/^摩卡，今天/);
  await pet(page).click();
  await expect.poll(() => eye.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await page.getByRole('button', { name: '關閉', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => eye.evaluate(element => getComputedStyle(element).animationName)).toBe('none'); clean();
});

test('look 圖片失敗會恢復健康的 idle；尚未解碼就暫藏不會回來補播', async ({ page }) => {
  const clean = monitorBrowser(page);
  let lookRequests = 0;
  await page.route(/moon-cat-look.*webp/, async route => {
    if (route.request().resourceType() !== 'image') return route.continue();
    lookRequests++;
    await route.fulfill({ status: 200, contentType: 'image/webp', body: 'invalid look' });
  });
  await openApp(page); await ready(page, /idle.*webp/);
  await pet(page).click();
  await page.getByRole('button', { name: '關閉', exact: true }).click();
  await expect.poll(() => lookRequests).toBe(1);
  await ready(page, /idle.*webp/);
  // Hold the next look response so hiding definitely precedes image decode.
  await page.unroute(/moon-cat-look.*webp/);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(/moon-cat-look.*webp/, async route => {
    if (route.request().resourceType() !== 'image') return route.continue();
    lookRequests++;
    await pending;
    await route.continue();
  });
  try {
    await pet(page).click();
    await page.getByRole('button', { name: '關閉', exact: true }).click();
    await expect.poll(() => lookRequests).toBe(2);
    await page.getByRole('textbox', { name: '快速新增', exact: true }).focus();
    await expect(image(page)).toHaveCount(0);
    await page.getByRole('textbox', { name: '快速新增', exact: true }).blur();
    await ready(page, /idle.*webp/);
    release();
    await ready(page, /idle.*webp/);
    expect(lookRequests).toBe(2);
  } finally { release(); }
  clean();
});
