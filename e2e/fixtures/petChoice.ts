import { expect, test, type Page } from '@playwright/test';
import { createEmptyUserData } from '../../src/domain/types';
import { monitorBrowser, openApp, tabButton } from '../support';

export async function checkPetChoice(page: Page) {
  const clean = monitorBrowser(page);
  const instant = '2026-11-04T04:00:00.000Z';
  const current = createEmptyUserData({ now: instant });
  current.preferences = { ...current.preferences, theme: 'dark', themeId: 'warm', petName: '原本的夥伴' };
  const { petKind: _kind, ...preferences } = current.preferences;
  expect(_kind).toBe('moon_cat');
  const data = { ...current, preferences };
  await page.addInitScript(({ data, instant }) => {
    if (!localStorage.getItem('daypop.user-data')) localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 4, revision: 7, updatedAt: instant, data }));
  }, { data, instant });
  await openApp(page);
  console.log('DP-239 actual browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('daypop.user-data')!));
  await expect.poll(saved).toEqual({ schemaVersion: 5, revision: 7, updatedAt: instant, data: current });
  await tabButton(page, '設定').click();
  for (const [name, key] of [['棉花貓', 'marshmallow_cat'], ['蜂蜜熊', 'honey_bear'], ['蜜桃兔', 'peach_bunny'], ['軌道噗', 'orbit_ufo'], ['月光貓', 'moon_cat']]) {
    await page.getByRole('radio', { name: name!, exact: true }).check();
    await expect.poll(async () => (await saved()).data.preferences.petKind).toBe(key);
    await expect(page.getByRole('radio', { name: name!, exact: true })).toBeChecked();
    await tabButton(page, '日曆').click();
    const pet = page.locator('button.cal-pet img');
    await expect(pet).toBeVisible();
    await expect(pet).toHaveAttribute('src', new RegExp(key!.replaceAll('_', '-') + '-idle.*webp'));
    await page.reload();
    await expect(pet).toBeVisible();
    await expect(pet).toHaveAttribute('src', new RegExp(key!.replaceAll('_', '-') + '-idle.*webp'));
    const after = await saved();
    expect({ ...after.data, preferences: { ...after.data.preferences, petKind: 'moon_cat' } }).toEqual(current);
    await tabButton(page, '設定').click();
    await expect(page.getByRole('radio', { name: name!, exact: true })).toBeChecked();
  }
  await page.getByRole('radio', { name: '蜂蜜熊', exact: true }).check();
  await expect.poll(async () => (await saved()).data.preferences.petKind).toBe('honey_bear');
  await page.getByRole('group', { name: '選擇夥伴', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('partner-choice.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('radio', { name: '蜂蜜熊', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: '蜜桃兔', exact: true })).toBeChecked();
  await expect.poll(async () => (await saved()).data.preferences.petKind).toBe('peach_bunny');
  clean();
}
