import { expect, test, type Page } from '@playwright/test';
import { monitorBrowser, openApp } from '../support';

export async function checkPetCollection(page: Page) {
  const clean = monitorBrowser(page);
  await openApp(page);
  console.log('DP-238 actual browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  const result = await page.evaluate(async () => {
    const path = '/src/screens/calendar/petCollection.ts';
    const { COLLECTION_ASSETS } = await import(/* @vite-ignore */ path);
    const panel = document.createElement('div'); panel.id = 'collection-preview';
    Object.assign(panel.style, { position: 'fixed', inset: '0', zIndex: '10000', background: '#f5f0e9', overflow: 'auto', padding: '20px', color: '#342e42' });
    document.body.append(panel);
    const sizes: number[] = [];
    for (const [kind, poses] of Object.entries(COLLECTION_ASSETS)) {
      const row = document.createElement('section'); row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px';
      const title = document.createElement('h2'); title.textContent = kind; title.style.cssText = 'width:100%;font:18px sans-serif'; row.append(title); panel.append(row);
      for (const [pose, asset] of Object.entries(poses as Record<string, { still: string; animation?: string }>)) {
        const label = document.createElement('div'); label.style.cssText = 'width:78px;text-align:center;font:12px sans-serif';
        const image = new Image(); image.src = asset.animation ?? asset.still; image.width = image.height = 72;
        image.dataset.pose = pose;
        label.append(image, document.createTextNode(pose)); row.append(label);
        await image.decode(); sizes.push(image.naturalWidth);
      }
    }
    return sizes;
  });
  expect(result).toHaveLength(21);
  expect(result.every(size => size === 120)).toBe(true);
  const walks = page.locator('#collection-preview img[data-pose="walk"]');
  await expect(walks).toHaveCount(3);
  // drawImage uses an animated image's default frame. Compare real compositor
  // captures, as in the existing idle animation regression.
  for (const image of await walks.all()) {
    const first = await image.screenshot();
    await expect.poll(async () => (await image.screenshot()).equals(first)).toBe(false);
  }
  await page.screenshot({ path: test.info().outputPath('collection-seven-poses.png'), fullPage: true });
  clean();
}

