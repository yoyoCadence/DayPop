// DP-244 Phase 1: put the image stickers into the real App's month cells and
// day sheet, without changing any product code.
//
// Usage, from the repository root, with the dev server running
// (`npm run dev -- --host 127.0.0.1 --port 4180`, empty Supabase env):
//   node docs/sticker-concepts/2026-11-14/month_cell_harness.mjs ASSETS_DIR OUT_DIR [BASE_URL]
// Set CHROMIUM_PATH to use a preinstalled browser.
//
// It seeds a guest calendar with 1–4 emoji stickers on four days, lets the App
// lay the cells out with its own CSS (stickerFontSize 19/15/12/10px, day sheet
// 20px), then swaps each glyph <span>'s text for an <img> of the matching SVG
// at the font size the App gave that span. Screenshots before (emoji) and after
// (images) are taken at a phone DPR of 3, in the light and dark manga theme.
// This is a substitution in the DOM, not the Phase 3 integration: it shows
// how the art reads inside real cells, nothing about loading or fallback.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [assets, out, base = 'http://127.0.0.1:4180/'] = process.argv.slice(2);
if (!assets || !out) throw new Error('usage: month_cell_harness.mjs ASSETS_DIR OUT_DIR [BASE_URL]');
mkdirSync(out, { recursive: true });
const manifest = readFileSync(new URL('./manifest.csv', import.meta.url), 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/).slice(1)
  .map((line) => line.split(','))
  .map(([id, name, , fallback, file]) => ({ id, name, fallback, uri: 'data:image/svg+xml;base64,' + readFileSync(join(assets, file)).toString('base64') }));

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const results = [];
for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, timezoneId: 'Asia/Taipei' });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(base);
  const days = await page.evaluate(async ({ glyphs, theme }) => {
    const { createEmptyUserData } = await import('/src/domain/types.ts');
    const now = new Date().toISOString();
    const data = createEmptyUserData({ now });
    data.preferences.timezone = 'Asia/Taipei';
    data.preferences.petEnabled = false;
    data.preferences.theme = theme;
    const key = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' })
      .format(new Date(Date.now() + offset * 86_400_000));
    const days = [key(-1), key(0), key(1), key(2)];
    days.forEach((date, index) => glyphs.slice(0, index + 1).forEach((glyph, order) => data.stickers.push({
      id: crypto.randomUUID(), calendarId: data.calendars[0].id, date, glyph, assetKey: null, sortOrder: order, createdAt: now, updatedAt: now,
    })));
    localStorage.setItem('daypop.release-notes-seen', '9999.0.0');
    localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 5, revision: 0, updatedAt: now, data }));
    return days;
  }, { glyphs: manifest.map((m) => m.fallback), theme });
  await page.reload();
  await page.locator(`[data-date-key="${days[3]}"] .cal-cell-stickers`).first().waitFor();
  console.log(`${theme}: actual browser timezone`, await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));

  const clip = await page.evaluate((days) => {
    const rects = days.map((d) => document.querySelector(`[data-date-key="${d}"]`).getBoundingClientRect());
    const left = Math.min(...rects.map((r) => r.left)), top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right)), bottom = Math.max(...rects.map((r) => r.bottom));
    return { x: Math.max(0, left - 4), y: Math.max(0, top - 4), width: Math.min(390, right + 4) - Math.max(0, left - 4), height: bottom - top + 8 };
  }, days);
  await page.screenshot({ path: join(out, `month-${theme}-emoji.png`), clip });
  const swap = (selector) => page.evaluate(({ selector, manifest }) => {
    const sizes = [];
    for (const span of document.querySelectorAll(selector)) {
      const entry = manifest.find((m) => m.fallback === span.textContent.trim());
      if (!entry) continue;
      const px = parseFloat(getComputedStyle(span).fontSize);
      span.textContent = '';
      const img = Object.assign(document.createElement('img'), { src: entry.uri, width: px, height: px, alt: entry.name });
      img.style.display = 'inline-block';
      img.style.verticalAlign = 'bottom';
      span.append(img);
      sizes.push(px);
    }
    return sizes;
  }, { selector, manifest });
  const cellSizes = await swap('.cal-cell-stickers > span');
  await page.waitForFunction(() => [...document.querySelectorAll('.cal-cell-stickers img')].every((i) => i.complete && i.naturalWidth > 0));
  await page.screenshot({ path: join(out, `month-${theme}-images.png`), clip });

  await page.locator(`[data-date-key="${days[3]}"]`).first().click();
  const row = page.locator('.cal-day-stickers');
  await row.waitFor();
  await row.screenshot({ path: join(out, `day-${theme}-emoji.png`) });
  const sheetSizes = await swap('.cal-day-sticker');
  await page.waitForFunction(() => [...document.querySelectorAll('.cal-day-sticker img')].every((i) => i.complete && i.naturalWidth > 0));
  await row.screenshot({ path: join(out, `day-${theme}-images.png`) });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  results.push({ theme, days, cellSizes, sheetSizes, overflow, problems });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
