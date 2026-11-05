import { expect, test, type Page } from '@playwright/test';
import { createEmptyUserData, type PetKind } from '../../src/domain/types';
import { monitorBrowser, openApp, tabButton } from '../support';

async function start(page: Page, kind: PetKind) {
  await page.clock.install({ time: new Date('2026-11-05T04:00:00.000Z') });
  const data = createEmptyUserData({ now: '2026-11-05T04:00:00.000Z' });
  data.preferences = { ...data.preferences, petKind: kind, theme: 'dark' };
  await page.addInitScript(data => {
    Math.random = () => 0; // Explicit deterministic route, real browser geometry/rendering.
    if (!localStorage.getItem('daypop.user-data')) localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 5, revision: 7, updatedAt: data.calendars[0]!.createdAt, data }));
  }, data);
  await openApp(page);
  await expect(page.locator('button.cal-pet img')).toBeVisible();
  console.log('DP-240 actual browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
}

async function safe(page: Page) {
  expect(await page.locator('button.cal-pet').evaluate(element => {
    const pet = element.getBoundingClientRect();
    const screen = element.closest('.cal-screen')!;
    const header = screen.querySelector('.cal-header')!.getBoundingClientRect();
    const fab = screen.querySelector('.cal-fab')!.getBoundingClientRect();
    const viewport = element.closest('.dp-viewport')!.getBoundingClientRect();
    const tabs = document.querySelector('.dp-tabbar')!.getBoundingClientRect();
    return pet.left >= viewport.left && pet.right <= viewport.right && pet.top >= header.bottom && pet.bottom <= tabs.top &&
      (pet.right + 7 < fab.left || pet.left > fab.right + 7 || pet.bottom + 7 < fab.top || pet.top > fab.bottom + 7);
  })).toBe(true);
}

export async function checkPetAutonomy(page: Page, kind: PetKind = 'honey_bear', interactions = true) {
  const clean = monitorBrowser(page);
  await start(page, kind);
  const pet = page.locator('button.cal-pet');
  const relative = () => pet.evaluate(element => {
    const box = element.getBoundingClientRect(), screen = element.closest('.cal-screen')!.getBoundingClientRect();
    return { x: box.left - screen.left, y: box.top - screen.top };
  });
  const initial = (await pet.boundingBox())!;
  const bytes = await page.evaluate(() => localStorage.getItem('daypop.user-data'));
  const placement = () => page.evaluate(() => localStorage.getItem('daypop.pet-placement'));
  expect(await placement()).toBeNull();
  await page.clock.fastForward(8000);
  await expect(pet).toHaveAttribute('data-activity', 'walk');
  await expect(pet.locator('img')).toHaveAttribute('src', /walk.*webp/);
  await expect.poll(async () => (await pet.boundingBox())!.x).toBeGreaterThan(initial.x + 2);
  await safe(page);
  await page.screenshot({ path: test.info().outputPath(`${kind}-walking.png`) });
  expect(await placement()).toBeNull();
  if (!interactions) { expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(bytes); clean(); return; }

  // Native mouse movement stops on approach; drag must start from that point,
  // rather than jumping back to the original manual anchor.
  const walking = (await pet.boundingBox())!;
  await page.mouse.move(walking.x + 30, walking.y + 30);
  await expect(pet).toHaveAttribute('data-activity', 'idle');
  const frozen = (await pet.boundingBox())!;
  await page.mouse.move(frozen.x + 30, frozen.y + 30);
  await page.mouse.down(); await page.mouse.move(frozen.x + 60, frozen.y, { steps: 3 });
  await expect(pet).toHaveAttribute('data-activity', 'grab');
  const dragged = (await pet.boundingBox())!;
  const draggedRelative = await relative();
  expect(dragged.x - frozen.x).toBeCloseTo(30, 0);
  expect(dragged.y - frozen.y).toBeCloseTo(-30, 0);
  await page.mouse.up();
  await expect(page.locator('.cal-pet-bubble')).toHaveCount(0);
  const savedPlacement = await placement(); expect(savedPlacement).not.toBeNull();
  await page.mouse.move(0, 0);
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await page.clock.fastForward(8000);
  await expect(pet).toHaveAttribute('data-activity', 'walk');
  await expect.poll(async () => (await pet.boundingBox())!.x).toBeGreaterThan(dragged.x + 2);
  await safe(page); expect(await placement()).toBe(savedPlacement);

  await page.getByRole('button', { name: '新增', exact: true }).click();
  await expect(pet).toBeHidden(); await expect(pet.locator('img')).toHaveCount(0);
  await page.clock.fastForward(30_000);
  await page.getByRole('dialog', { name: '新增行程', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  await expect(pet).toBeVisible(); await safe(page);
  await page.getByRole('textbox', { name: '快速新增', exact: true }).focus();
  await expect(pet).toBeHidden();
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await expect(pet).toBeVisible();
  await page.clock.fastForward(8000); await expect(pet).toHaveAttribute('data-activity', 'walk');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(pet.locator('img')).toHaveAttribute('src', /idle.*png/);
  const quiet = await pet.boundingBox(); await page.clock.fastForward(60_000);
  expect(await pet.boundingBox()).toEqual(quiet);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.fastForward(120_001);
  await expect(pet).toHaveAttribute('data-activity', 'sleep');
  await expect(pet.locator('img')).toHaveAttribute('src', /sleep.*webp/);
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await expect(pet).toHaveAttribute('data-activity', 'idle');
  await page.getByRole('button', { name: '今天', exact: true }).hover();
  await page.mouse.down();
  const held = await pet.boundingBox(); await page.clock.fastForward(30_000);
  expect(await pet.boundingBox()).toEqual(held); await expect(pet).toHaveAttribute('data-activity', 'idle');
  await page.mouse.up();
  expect(await placement()).toBe(savedPlacement);
  expect(await page.evaluate(() => localStorage.getItem('daypop.user-data'))).toBe(bytes);
  await pet.click(); await page.getByRole('button', { name: '收起夥伴', exact: true }).click();
  const tab = page.getByRole('button', { name: /^展開夥伴/ });
  await expect(tab).toBeFocused(); await expect(page.locator('.cal-pet-art img')).toHaveCount(0);
  await page.clock.fastForward(30_000); await tab.click();
  await expect(pet).toBeFocused(); await page.clock.fastForward(30_000);
  await expect(pet).toHaveAttribute('data-activity', 'idle');
  expect(await placement()).toBe(savedPlacement);
  await tabButton(page, '設定').click(); await tabButton(page, '日曆').click();
  await expect(pet).toBeVisible();
  const returned = await relative();
  expect(returned.x).toBeCloseTo(draggedRelative.x, 0); expect(returned.y).toBeCloseTo(draggedRelative.y, 0);
  await safe(page); expect(await placement()).toBe(savedPlacement);
  clean();
}
