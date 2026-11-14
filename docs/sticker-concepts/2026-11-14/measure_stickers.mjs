// DP-244 Phase 1: decode each sticker in Chromium and measure its opaque box.
//
// Usage, from the repository root:
//   node docs/sticker-concepts/2026-11-14/measure_stickers.mjs ASSETS_DIR
// Set CHROMIUM_PATH to use a preinstalled browser instead of Playwright's own.
// The SVGs stay outside the repository while their licence is review-pending
// (OWNER-DECISIONS 2026-11-14, item 6), so the directory is an argument.
//
// Writes measure-results.json beside this file, with each file's SHA-256 so
// the numbers can be matched to asset-hashes.json. "longSide" is the opaque
// bounding box (white die-cut included) as a percentage of the 96-unit canvas;
// STYLE-GUIDE v0.1 asks for the subject to fill about 88%, and the revised set
// is normalised to 92% including the die-cut. Rasterised at 960px, alpha > 16.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const [assets] = process.argv.slice(2);
if (!assets) throw new Error('usage: measure_stickers.mjs ASSETS_DIR');
const names = ['happy', 'gift', 'cake', 'hiking'];
const sets = { current: assets };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
await page.setContent('<!doctype html><body></body>');
const results = {};
for (const [set, dir] of Object.entries(sets)) {
  results[set] = {};
  for (const name of names) {
    const bytes = readFileSync(join(dir, `${name}.svg`));
    const svg = bytes.toString('utf8');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    results[set][name] = { sha256, ...await page.evaluate(async (text) => {
      const N = 960;
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text)));
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = N;
      canvas.height = N;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, N, N);
      const { data } = ctx.getImageData(0, 0, N, N);
      let minX = N, minY = N, maxX = -1, maxY = -1, opaque = 0;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          if (data[(y * N + x) * 4 + 3] > 16) {
            opaque++;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
        }
      }
      const unit = (px) => Math.round((px / N) * 960) / 10;
      return {
        decoded: img.naturalWidth === 96 && img.naturalHeight === 96,
        box: [unit(minX), unit(minY), unit(maxX + 1), unit(maxY + 1)],
        longSide: Math.round((Math.max(maxX - minX + 1, maxY - minY + 1) / N) * 1000) / 10,
        coverage: Math.round((opaque / (N * N)) * 1000) / 10,
      };
    }, svg) };
  }
}
await browser.close();
results.browser = 'Chromium (Playwright)';
writeFileSync(join(here, 'measure-results.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
