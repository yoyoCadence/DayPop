import { describe, expect, it } from 'vitest';
import {
  RECENT_STICKER_LIMIT,
  STICKER_CATEGORIES,
  STICKER_GLYPHS,
  recentStickerGlyphs,
  stickerFontSize,
} from './stickerGlyphs';
import type { Sticker } from './types';

/** `get STK()` from `日曆桌寵 Calendar Pet.dc.html`, verbatim and in order. */
const ORIGINAL_GLYPHS = ['💲', '💰', '💵', '💳', '❤️', '💕', '💖', '💘', '😍', '💍', '💐', '🥂', '🎂', '🎉', '🎊', '🎁', '🥳', '🎈', '⭐', '🌟', '❗', '⚠️', '🔥', '📌', '🚩', '✈️', '🏖️', '🚗', '🧳', '🗺️', '☕', '🍽️', '🍕', '🍔', '🍺', '🍰', '💼', '📝', '📎', '💻', '📚', '🎓', '✅', '❌', '💊', '🏥', '💪', '🏃', '🦷', '📞', '📷', '🎵', '🎮', '🐾', '💡', '🌙', '☀️', '🌧️', '🌸', '🍁', '⏰', '🎯', '🏆'];

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

describe('STICKER_CATEGORIES (DP-243)', () => {
  it('keeps every glyph the原檔 offered', () => {
    expect(ORIGINAL_GLYPHS).toHaveLength(63);
    expect(ORIGINAL_GLYPHS.filter((glyph) => !STICKER_GLYPHS.includes(glyph))).toEqual([]);
  });

  it('offers 240 glyphs in eleven named categories, each glyph once', () => {
    expect(STICKER_CATEGORIES.map((category) => category.label)).toEqual([
      '標記', '心情', '慶祝', '工作', '金錢', '健康', '出遊', '美食', '生活', '休閒', '天氣',
    ]);
    expect(new Set(STICKER_CATEGORIES.map((category) => category.id)).size).toBe(11);
    expect(STICKER_GLYPHS).toHaveLength(240);
    expect(new Set(STICKER_GLYPHS).size).toBe(STICKER_GLYPHS.length);
    for (const category of STICKER_CATEGORIES) {
      // The category row is sized for two-character labels.
      expect([...category.label]).toHaveLength(2);
      expect(category.glyphs.length).toBeGreaterThanOrEqual(12);
    }
  });

  it('holds only single, fully qualified emoji that older systems can draw', () => {
    // `v`-flag property of strings: matches one RGI emoji and nothing else,
    // which already rejects a missing U+FE0F (`☀` instead of `☀️`).
    const rgiEmoji = new RegExp('^\\p{RGI_Emoji}$', 'v');
    const failures = STICKER_GLYPHS.filter((glyph) => {
      const codePoints = [...glyph].map((char) => char.codePointAt(0)!);
      const extra = codePoints.slice(1).filter((codePoint) => codePoint !== 0xfe0f);
      // ZWJ sequences, skin tones, flags and keycaps would all add a code point.
      return !rgiEmoji.test(glyph) || extra.length > 0 || codePoints.length > 2;
    });
    expect(failures).toEqual([]);
  });
});

describe('recentStickerGlyphs (DP-243)', () => {
  const sticker = (glyph: string | null, createdAt: string, id = glyph ?? 'x'): Sticker => ({
    id,
    calendarId: 'calendar',
    date: '2026-11-14',
    glyph,
    assetKey: null,
    sortOrder: 0,
    createdAt,
    updatedAt: createdAt,
  });

  it('lists the newest glyphs first without repeats', () => {
    expect(recentStickerGlyphs([
      sticker('🎂', '2026-11-01T00:00:00.000Z', 'a'),
      sticker('🍜', '2026-11-03T00:00:00.000Z', 'b'),
      sticker('🎂', '2026-11-05T00:00:00.000Z', 'c'),
      sticker('✈️', '2026-11-04T00:00:00.000Z', 'd'),
    ])).toEqual(['🎂', '✈️', '🍜']);
  });

  it('compares instants rather than strings, so server and client timestamps mix', () => {
    // The account adapter reads PostgREST's `+00:00`; the guest writes `.000Z`.
    expect(recentStickerGlyphs([
      sticker('🎂', '2026-11-05T08:00:00+00:00'),
      sticker('🍜', '2026-11-05T09:00:00.000Z'),
      sticker('✈️', '2026-11-05T16:30:00+08:00'),
    ])).toEqual(['🍜', '✈️', '🎂']);
  });

  it('breaks a timestamp tie by array order, newest last', () => {
    const time = '2026-11-05T00:00:00.000Z';
    expect(recentStickerGlyphs([sticker('🎂', time), sticker('🍜', time)])).toEqual(['🍜', '🎂']);
  });

  it('skips glyphs the picker does not offer and empty glyphs', () => {
    expect(recentStickerGlyphs([
      sticker('一段很長的文字', '2026-11-06T00:00:00.000Z', 'text'),
      sticker(null, '2026-11-07T00:00:00.000Z', 'asset'),
      sticker('🎂', '2026-11-01T00:00:00.000Z', 'cake'),
    ])).toEqual(['🎂']);
  });

  it('stops at the limit', () => {
    const many = STICKER_GLYPHS.slice(0, 30).map((glyph, index) =>
      sticker(glyph, new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()));
    const recent = recentStickerGlyphs(many);
    expect(recent).toHaveLength(RECENT_STICKER_LIMIT);
    expect(recent[0]).toBe(STICKER_GLYPHS[29]);
  });

  it('is empty for a user with no stickers', () => {
    expect(recentStickerGlyphs([])).toEqual([]);
  });
});
