import { expect, type Page } from '@playwright/test';
import { monitorBrowser, openApp } from '../support';

/** Behavioural clock only; native WebP decoding still runs in the real browser. */
export async function checkPetSleep(page: Page, wheel = true) {
  const clean = monitorBrowser(page);
  await page.clock.install({ time: new Date('2026-10-24T04:00:00Z') });
  await openApp(page);
  await expect(page).toHaveTitle('日蹦 DayPop');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  const pet = page.locator('button.cal-pet');
  const image = pet.locator('img');
  async function ready(pattern: RegExp) {
    await expect(image).toHaveAttribute('src', pattern);
    await expect(image).toBeVisible();
    expect(await image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(120);
  }
  await ready(/idle.*webp/);
  await page.clock.pauseAt(new Date('2026-10-24T04:10:00Z'));
  await pet.focus();
  await page.keyboard.press('Shift');
  const bytes = await page.evaluate(() => localStorage.getItem('daypop.user-data'));
  console.log('DP-193 browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  await page.clock.fastForward(119999); await ready(/idle.*webp/);
  await page.clock.fastForward(1); await ready(/sleep.*webp/);
  await expect(pet).toBeFocused();
  const bounds = (await pet.boundingBox())!;
  expect([bounds.width, bounds.height]).toEqual([60, 60]);
  if (wheel) {
    await page.mouse.wheel(0, 1); await ready(/idle.*webp/);
    await page.clock.fastForward(120000); await ready(/sleep.*webp/);
  }
  await page.keyboard.press('Shift'); await ready(/idle.*webp/);
  await page.clock.fastForward(120000); await ready(/sleep.*webp/);
  await page.locator('.cal-today-full').click(); await ready(/idle.*webp/);
  await page.clock.fastForward(120000); await ready(/sleep.*webp/);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await ready(/sleep.*png/);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await ready(/sleep.*webp/);
  const quick = page.getByRole('textbox', { name: '快速新增', exact: true });
  await quick.focus(); await expect(image).toHaveCount(0);
  await page.clock.fastForward(240000); await expect(image).toHaveCount(0);
  await quick.blur(); await ready(/idle.*webp/);
  await page.clock.fastForward(119999); await ready(/idle.*webp/);
  await page.clock.fastForward(1); await ready(/sleep.*webp/);
  // An actual click wakes and opens the existing bubble; closing keeps look priority.
  await pet.click(); await ready(/idle.*png/);
  await page.clock.fastForward(240000); await ready(/idle.*png/);
  await page.getByRole('button', { name: '關閉', exact: true }).click(); await ready(/look.*webp/);
  await page.clock.fastForward(1600); await ready(/idle.*webp/);
  await pet.click(); await page.getByRole('button', { name: '移動夥伴', exact: true }).click();
  await page.clock.fastForward(240000); await ready(/grab.*png/);
  await page.keyboard.press('Escape'); await ready(/idle.*webp/);
  expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(bytes);
  clean();
}
