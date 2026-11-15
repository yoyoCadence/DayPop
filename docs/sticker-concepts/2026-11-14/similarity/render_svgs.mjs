// Render SVG files to 128×128 transparent PNGs in Chromium for the similarity check.
// Usage, from the repository root:
//   node docs/sticker-concepts/2026-11-14/similarity/render_svgs.mjs OUT_DIR ours=STICKER_DIR \
//     twemoji=GLYPHS/twemoji openmoji=GLYPHS/openmoji fluent=GLYPHS/fluent
// Set PLAYWRIGHT_CHROMIUM to a Chromium binary when Playwright's own is not installed.
// The images are review-pending stickers and third-party emoji, so OUT_DIR must be outside the repo.
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const { chromium } = createRequire(join(repo, 'package.json'))('playwright');
const [outArg, ...sets] = process.argv.slice(2);
const out = resolve(outArg);
const inside = relative(repo, out);
if (!inside.startsWith('..') && !isAbsolute(inside)) {
  console.error('OUT_DIR is inside the repository; review-pending and third-party art must stay outside it');
  process.exit(1);
}
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 128, height: 128 }, deviceScaleFactor: 1 });
let count = 0;
for (const spec of sets) {
  const [name, dir] = spec.split('=');
  mkdirSync(join(out, name), { recursive: true });
  for (const file of readdirSync(dir).filter(f => f.endsWith('.svg'))) {
    const svg = readFileSync(join(dir, file)).toString('base64');
    await page.setContent(`<html><body style="margin:0;background:transparent"><img style="width:128px;height:128px;display:block" src="data:image/svg+xml;base64,${svg}"></body></html>`);
    await page.locator('img').evaluate(img => img.decode());
    await page.screenshot({ path: join(out, name, file.replace(/\.svg$/, '.png')), omitBackground: true });
    count += 1;
  }
}
await browser.close();
console.log('rendered', count);
