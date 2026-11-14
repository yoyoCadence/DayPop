import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STICKER_CATEGORIES } from './stickerGlyphs';

/**
 * DP-244: the image-sticker manifest must stay in step with the DP-243 catalogue.
 *
 * Every image sticker falls back to its `glyph` wherever the art cannot be
 * shown (an old App, a backup, an unknown key, an offline miss), so the
 * fallback has to be an emoji the picker really offers, in the same category.
 * The SVG files themselves are kept out of the repository while their licence
 * is `review-pending` (OWNER-DECISIONS 2026-11-14, item 6); this test checks
 * the manifest only. `docs/sticker-concepts/2026-11-14/check_stickers.py`
 * checks the files against the same manifest and the pinned hashes.
 */
const MANIFEST = join(process.cwd(), 'docs', 'sticker-concepts', '2026-11-14', 'manifest.csv');
const COLUMNS = ['id', 'name', 'category', 'fallback', 'file', 'author', 'source_url', 'license', 'license_url', 'modified'] as const;
type ManifestRow = Record<(typeof COLUMNS)[number], string>;
const PUBLISHABLE = ['owner-original', 'CC0', 'CC BY 4.0', 'MIT', 'Apache 2.0', 'SIL OFL 1.1'];

function readManifest(text: string): ManifestRow[] {
  const [header, ...lines] = text.replace(/^\uFEFF/, '').trimEnd().split('\n');
  expect(header!.split(',')).toEqual(COLUMNS);
  return lines.map((line) => {
    const cells = line.split(',');
    // No field may contain a comma: the manifest is read without quoting.
    expect(cells).toHaveLength(COLUMNS.length);
    return Object.fromEntries(COLUMNS.map((column, index) => [column, cells[index]!])) as ManifestRow;
  });
}

const rows = readManifest(readFileSync(MANIFEST, 'utf8'));
const categoryOf = new Map(STICKER_CATEGORIES.flatMap((category) => category.glyphs.map((glyph) => [glyph, category.id] as const)));

describe('DP-244 sticker asset manifest', () => {
  it('falls back to an emoji the DP-243 picker offers, in the same category', () => {
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.length).toBeLessThanOrEqual(24);
    for (const row of rows) {
      expect(categoryOf.get(row.fallback), `${row.id} fallback ${row.fallback}`).toBe(row.category);
    }
  });

  it('fixes hiking to ⛰️, not the 🏔️ the first handoff used', () => {
    expect(rows.find((row) => row.id === 'hiking')?.fallback).toBe('⛰️');
    expect(categoryOf.has('🏔️')).toBe(false);
  });

  it('keeps ids stable-looking and unique, one SVG each', () => {
    const ids = rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of rows) {
      expect(row.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(row.file).toBe(`${row.id}.svg`);
    }
  });

  it('never marks a sticker as licensed without the owner’s sign-off', () => {
    // Until the rights review is signed, every row stays review-pending; a
    // publishable licence also needs its source and licence links.
    for (const row of rows) {
      expect(['review-pending', ...PUBLISHABLE]).toContain(row.license);
      if (row.license !== 'review-pending' && row.license !== 'owner-original') {
        expect(row.source_url, row.id).not.toBe('');
        expect(row.license_url, row.id).not.toBe('');
      }
    }
  });
});
