import { expect, test, type Page } from '@playwright/test';
import { monitorBrowser, openApp, tabButton } from './support';

/**
 * DP-240 foreground excursions in a real browser. The fake clock drives the
 * schedule; CSS transitions and image decoding still run in real time, so the
 * drawn position is polled rather than read once.
 */
const pet = (page: Page) => page.locator('button.cal-pet');
const image = (page: Page) => pet(page).locator('img');
const stored = (page: Page) => page.evaluate(() => ({
  placement: localStorage.getItem('daypop.pet-placement'),
  data: localStorage.getItem('daypop.user-data'),
}));
/** Drawn box relative to the pet layer, in content pixels (the desktop frame may scale). */
const drawn = (page: Page) => pet(page).evaluate(element => {
  const rect = element.getBoundingClientRect();
  const layer = element.parentElement!.getBoundingClientRect();
  const scale = rect.width / 60;
  return { x: Math.round((rect.x - layer.x) / scale), y: Math.round((rect.y - layer.y) / scale) };
});

async function choose(page: Page, name: string) {
  await tabButton(page, '設定').click();
  await page.getByRole('radio', { name, exact: true }).check();
  await tabButton(page, '日曆').click();
  await expect(image(page)).toBeVisible();
}

test('新夥伴安靜時自己走出去、坐下、走回保存位置；中途抓起從所在處拖移，輸入立即回家', async ({ page }) => {
  const clean = monitorBrowser(page);
  await page.clock.install({ time: new Date('2026-11-07T04:00:00Z') });
  await openApp(page);
  console.log('DP-240 browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  await choose(page, '棉花貓');
  await expect(image(page)).toHaveAttribute('src', /marshmallow-cat-idle.*webp/);
  const home = await drawn(page);
  const before = await stored(page);

  // The first excursion starts 30–60 s after the last input.
  await page.clock.fastForward(60_000);
  await expect(pet(page)).toHaveAttribute('data-wander', 'out');
  await expect(image(page)).toHaveAttribute('src', /marshmallow-cat-walk.*webp/);
  // The walk itself is a CSS transition on real time; the fake clock only
  // drives the schedule. Let the leg finish for real, then fire its timer.
  const leg = Number((await pet(page).getAttribute('style'))!.match(/transform (\d+)ms linear/)![1]);
  expect(leg).toBeGreaterThanOrEqual(1_200);
  expect(leg).toBeLessThanOrEqual(3_889);
  await page.waitForTimeout(leg + 200);
  await page.clock.fastForward(leg);
  await expect(pet(page)).toHaveAttribute('data-wander', 'sit');
  await expect(image(page)).toHaveAttribute('src', /marshmallow-cat-sit/);
  await expect.poll(async () => (await drawn(page)).y).toBe(home.y);
  const sitting = await drawn(page);
  expect(Math.abs(sitting.x - home.x)).toBeGreaterThanOrEqual(39);
  expect(Math.abs(sitting.x - home.x)).toBeLessThanOrEqual(141);
  expect(await stored(page)).toEqual(before);

  // Grabbing it where it sits: no jump home, and the drop is where it lands.
  const box = (await pet(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(pet(page)).not.toHaveAttribute('data-wander');
  expect(await drawn(page)).toEqual(sitting);
  // Further away from home: back towards it could land inside the 24px edge snap.
  const direction = sitting.x > home.x ? 1 : -1;
  await page.mouse.move(box.x + box.width / 2 + direction * 30, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const dropped = await drawn(page);
  expect(Math.abs(dropped.x - (sitting.x + direction * 30))).toBeLessThanOrEqual(1);
  const afterDrag = await stored(page);
  expect(afterDrag.placement).not.toBeNull();
  expect(afterDrag.data).toBe(before.data);
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);

  // The next excursion starts from the new saved spot; mid-walk, a key press
  // anywhere ends it at once (the running transition is cancelled, not finished).
  await page.clock.fastForward(60_000);
  await expect(pet(page)).toHaveAttribute('data-wander', 'out');
  await expect.poll(async () => (await drawn(page)).x).not.toBe(dropped.x);
  await page.keyboard.press('Shift');
  await expect(pet(page)).not.toHaveAttribute('data-wander');
  await expect.poll(() => drawn(page)).toEqual(dropped);
  expect(await stored(page)).toEqual(afterDrag);

  // Pressed mid-walk, it stops where it is drawn (a point on the running
  // transition); a tap then sends it home and opens the bubble, saving nothing.
  await page.clock.fastForward(60_000);
  await expect(pet(page)).toHaveAttribute('data-wander', 'out');
  await page.waitForTimeout(400);
  const moving = (await pet(page).boundingBox())!;
  const passing = await drawn(page);
  await page.mouse.move(moving.x + moving.width / 2, moving.y + moving.height / 2);
  await page.mouse.down();
  await expect(pet(page)).not.toHaveAttribute('data-wander');
  const stopped = await drawn(page);
  expect(stopped.x).not.toBe(dropped.x);
  // 36 px/s: a few pixels at most between that reading and the press.
  expect(Math.abs(stopped.x - passing.x)).toBeLessThanOrEqual(4);
  await page.waitForTimeout(400);
  expect(await drawn(page)).toEqual(stopped);
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await drawn(page)).toEqual(dropped);
  expect(await stored(page)).toEqual(afterDrag);
  await page.getByRole('button', { name: '關閉', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  clean();
});

test('減少動態與沒有走路動作的夥伴都不會自己移動', async ({ page }) => {
  const clean = monitorBrowser(page);
  await page.clock.install({ time: new Date('2026-11-07T04:00:00Z') });
  await openApp(page);
  // The default partner has no walk: it never leaves its spot.
  await expect(image(page)).toHaveAttribute('src', /moon-cat-idle.*webp/);
  const home = await drawn(page);
  await page.clock.fastForward(60_000);
  await expect(pet(page)).not.toHaveAttribute('data-wander');
  expect(await drawn(page)).toEqual(home);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await choose(page, '蜂蜜熊');
  await page.clock.fastForward(60_000);
  await expect(pet(page)).not.toHaveAttribute('data-wander');
  expect(await drawn(page)).toEqual(home);
  // Motion allowed again: the same partner now does take its excursion.
  // The media change re-renders asynchronously; keep jumping until it has.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(async () => {
    await page.clock.fastForward(30_000);
    return pet(page).getAttribute('data-wander');
  }).toBe('out');
  clean();
});
