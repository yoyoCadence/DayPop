import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

/**
 * Rasterises the PWA install icons from the canonical artwork — DP-019.
 *
 * `public/icons/daypop.svg` stays the single source of the DayPop mark; this
 * script only re-frames it per platform, so the PNGs can never drift from the
 * SVG. Run `npm run icons` after changing the artwork and commit the output —
 * the build does not generate these, because installed icons must stay byte
 * stable across releases (an icon that changes shape looks like a new app).
 *
 * Three framings, from the same drawing:
 *
 * - `any`      the mark as designed: its own rounded plate, transparent corners.
 * - `maskable` full-bleed plate colour with the mark scaled into the 80% safe
 *              zone, so Android may crop it to a circle/squircle without
 *              clipping the calendar card (https://w3c.github.io/manifest/#icon-masks).
 * - `apple`    full-bleed and fully opaque at natural size. iOS composites
 *              transparency onto black and applies its own corner mask, so an
 *              icon with baked-in rounded corners gets black slivers.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = resolve(root, 'public/icons');
const sourcePath = resolve(iconsDir, 'daypop.svg');

/** Matches the plate fill in `daypop.svg`; the bleed must be invisible. */
const PLATE_COLOR = '#f4ce3f';

/** Fraction of the icon box the artwork occupies inside a maskable safe zone. */
const SAFE_ZONE_SCALE = 0.8;

const TARGETS = [
  { file: 'icon-192.png', size: 192, background: null, scale: 1 },
  { file: 'icon-512.png', size: 512, background: null, scale: 1 },
  { file: 'maskable-192.png', size: 192, background: PLATE_COLOR, scale: SAFE_ZONE_SCALE },
  { file: 'maskable-512.png', size: 512, background: PLATE_COLOR, scale: SAFE_ZONE_SCALE },
  { file: 'apple-touch-icon-180.png', size: 180, background: PLATE_COLOR, scale: 1 },
];

const svg = await readFile(sourcePath, 'utf8');
const svgDataUri = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;

await mkdir(iconsDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const target of TARGETS) {
    const page = await browser.newPage({
      viewport: { width: target.size, height: target.size },
      deviceScaleFactor: 1,
    });

    const artwork = Math.round(target.size * target.scale);
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>
         html, body { margin: 0; padding: 0; background: transparent; }
         #box {
           width: ${target.size}px;
           height: ${target.size}px;
           background: ${target.background ?? 'transparent'};
           display: grid;
           place-items: center;
         }
         img { width: ${artwork}px; height: ${artwork}px; display: block; }
       </style>
       <div id="box"><img alt="" src="${svgDataUri}"></div>`,
    );

    const buffer = await page.locator('#box').screenshot({
      omitBackground: target.background === null,
    });
    await writeFile(resolve(iconsDir, target.file), buffer);
    await page.close();

    console.log(`Generated public/icons/${target.file} (${target.size}×${target.size})`);
  }
} finally {
  await browser.close();
}
