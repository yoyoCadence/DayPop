import { describe, expect, it } from 'vitest';
import { STICKER_GLYPHS, stickerFontSize } from './stickerGlyphs';

describe('stickerFontSize', () => {
  it('shrinks the glyphs as a day fills up, matching the原檔', () => {
    expect(stickerFontSize(1)).toBe(19);
    expect(stickerFontSize(2)).toBe(15);
    expect(stickerFontSize(3)).toBe(12);
    expect(stickerFontSize(4)).toBe(10);
    expect(stickerFontSize(9)).toBe(10);
  });

  it('uses the single-sticker size for an empty day', () => {
    // The row is not rendered at 0, but the size must stay defined.
    expect(stickerFontSize(0)).toBe(19);
  });
});

describe('STICKER_GLYPHS', () => {
  it('carries the原檔 palette in order and without duplicates', () => {
    expect(STICKER_GLYPHS).toHaveLength(63);
    expect(STICKER_GLYPHS[0]).toBe('💲');
    expect(STICKER_GLYPHS.at(-1)).toBe('🏆');
    expect(new Set(STICKER_GLYPHS).size).toBe(STICKER_GLYPHS.length);
  });
});
