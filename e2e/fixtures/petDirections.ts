import { expect, type Page } from '@playwright/test';
import { monitorBrowser, openApp } from '../support';

export async function checkPetDirections(page: Page) {
  const clean = monitorBrowser(page);
  await openApp(page);
  console.log('DP-260 actual browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  const sizes = await page.evaluate(async () => {
    const module = '/src/screens/calendar/petDirections.ts';
    const { DIRECTION_ASSETS } = await import(/* @vite-ignore */ module);
    const panel = document.createElement('section');
    panel.id = 'new-pet-poses';
    Object.assign(panel.style, { position: 'fixed', inset: '0', zIndex: '10000', overflow: 'auto', background: '#f6efe5' });
    document.body.append(panel);
    const images: HTMLImageElement[] = [];
    for (const kind of Object.keys(DIRECTION_ASSETS)) {
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', flexWrap: 'wrap' });
      panel.append(row);
      for (const [pose, asset] of Object.entries(DIRECTION_ASSETS[kind] as Record<string, { still: string; animation: string }>)) {
        for (const src of [asset.still, asset.animation]) {
          const image = new Image(84, 84);
          image.dataset.pose = pose;
          image.dataset.animation = String(src === asset.animation);
          if (kind === 'pixel_cat') image.style.imageRendering = 'pixelated';
          image.src = src;
          row.append(image);
          images.push(image);
        }
      }
    }
    return Promise.all(images.map(async img => {
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    }));
  });
  expect(sizes).toHaveLength(56);
  expect(sizes.every(([width, height]) => width === 120 && height === 120)).toBe(true);
  const walks = page.locator('#new-pet-poses img[data-pose="walk"][data-animation="true"]');
  await expect(walks).toHaveCount(4);
  for (const image of await walks.all()) {
    const initial = await image.screenshot();
    await expect.poll(async () => (await image.screenshot()).equals(initial)).toBe(false);
  }
  clean();
}
