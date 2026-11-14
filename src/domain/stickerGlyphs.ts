import type { Sticker } from './types';

/**
 * The sticker palette, grouped by what a day is about — DP-243.
 *
 * The原檔 (`get STK()` in `日曆桌寵 Calendar Pet.dc.html`) had one flat row of
 * 63 emoji. The owner asked for more and for categories, so the picker now
 * offers 240 in eleven groups. Every one of the原檔's 63 is still here
 * (`stickerGlyphs.test.ts` checks), so nothing a user picked before disappears
 * from the picker.
 *
 * Rules for adding a glyph, so it renders on every device a user may open:
 * - one fully qualified emoji: the code point plus U+FE0F where the emoji has
 *   text presentation by default (`☀️`, not `☀`);
 * - no ZWJ sequences, skin tones, flags or keycaps — those fall apart into
 *   several glyphs on older systems;
 * - Emoji 12.0 (2019) or older. Newer ones show as an empty box on Windows 10
 *   and older phones; that is why 🧋 and 🪙 are not here. The list was checked
 *   against the Unicode data once, see docs/sticker-catalog.md;
 * - each glyph in exactly one category.
 *
 * These are emoji today. The domain `Sticker` already carries an `assetKey`
 * beside `glyph` so a future art set can be introduced without a data
 * migration: new stickers would store an `assetKey`, and existing rows keep
 * rendering their glyph (docs/sticker-asset-spec.md).
 */
export interface StickerCategory {
  id: StickerCategoryId;
  /** Two characters, so the category row stays two lines on a 360px phone. */
  label: string;
  glyphs: readonly string[];
}

export type StickerCategoryId =
  | 'mark'
  | 'mood'
  | 'celebrate'
  | 'work'
  | 'money'
  | 'health'
  | 'travel'
  | 'food'
  | 'home'
  | 'fun'
  | 'weather';

export const STICKER_CATEGORIES: readonly StickerCategory[] = [
  {
    id: 'mark',
    label: '標記',
    glyphs: ['⭐', '🌟', '❗', '❓', '⚠️', '🔥', '📌', '📍', '🚩', '✅', '❌', '⭕', '💯', '🔔', '⏰', '⏳', '🎯', '🏆', '💡', '🆕', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣'],
  },
  {
    id: 'mood',
    label: '心情',
    glyphs: ['😀', '😊', '😂', '🥰', '😍', '🤩', '😎', '😇', '😌', '🤔', '😴', '🥱', '😢', '😭', '😤', '😡', '🥺', '🤯', '❤️', '🧡', '💛', '💚', '💙', '💜', '🤍', '🖤', '💔', '💕', '💖', '💘'],
  },
  {
    id: 'celebrate',
    label: '慶祝',
    glyphs: ['🎂', '🎉', '🎊', '🎁', '🥳', '🎈', '🥂', '🍾', '💍', '💐', '💒', '💝', '🎀', '🎄', '🎃', '🧧', '🏮', '🥮', '🎆', '🎇', '🕯️'],
  },
  {
    id: 'work',
    label: '工作',
    glyphs: ['💼', '📝', '📎', '💻', '📚', '🎓', '📞', '📅', '📊', '📋', '🗂️', '📁', '✏️', '✉️', '🖨️', '🏢', '🏫', '🔍', '🤝', '📢'],
  },
  {
    id: 'money',
    label: '金錢',
    glyphs: ['💲', '💰', '💵', '💳', '💸', '🧾', '🏦', '🏧', '📈', '📉', '🧮', '🏷️', '💎'],
  },
  {
    id: 'health',
    label: '健康',
    glyphs: ['💊', '🏥', '🩺', '💉', '🩸', '🩹', '😷', '🤒', '🦷', '💪', '🏃', '🚴', '🏊', '🧘', '🏋️', '⚽', '🏀', '⚾', '🏸', '🎾', '🏓', '⛳', '🛌'],
  },
  {
    id: 'travel',
    label: '出遊',
    glyphs: ['✈️', '🏖️', '🗺️', '🧳', '🚗', '🚕', '🚌', '🚇', '🚄', '🛵', '🚲', '🚢', '⛽', '🅿️', '⛺', '⛰️', '🏝️', '🏨', '🎡', '🎢', '🎫', '🧭'],
  },
  {
    id: 'food',
    label: '美食',
    glyphs: ['☕', '🍽️', '🍕', '🍔', '🍺', '🍰', '🍜', '🍣', '🍱', '🍙', '🥟', '🍲', '🍳', '🥐', '🥗', '🍎', '🍓', '🍦', '🍩', '🍪', '🍿', '🍷', '🍻', '🥤', '🍵'],
  },
  {
    id: 'home',
    label: '生活',
    glyphs: ['🏠', '🛒', '🛍️', '🧺', '🧹', '🧼', '🔧', '🔑', '📦', '📬', '🗑️', '✂️', '💇', '💅', '👪', '👶', '🧸', '🐶', '🐱', '🐾', '🌱', '🛏️'],
  },
  {
    id: 'fun',
    label: '休閒',
    glyphs: ['📷', '🎵', '🎮', '🎬', '🎤', '🎧', '🎸', '🎹', '🎨', '📺', '📖', '🎭', '🎲', '🧩', '🀄', '🎳', '🎣', '🧶'],
  },
  {
    id: 'weather',
    label: '天氣',
    glyphs: ['☀️', '⛅', '☁️', '🌧️', '⛈️', '☔', '🌀', '❄️', '⛄', '🌈', '🌡️', '🌊', '🌙', '🌕', '🌸', '🌷', '🌻', '🍂', '🍁', '🌳'],
  },
];

/** Every glyph the picker offers, in category order. */
export const STICKER_GLYPHS: readonly string[] = STICKER_CATEGORIES.flatMap(
  (category) => category.glyphs,
);

/** Two rows of the picker grid on a 360–390px phone. */
export const RECENT_STICKER_LIMIT = 12;

/**
 * The glyphs this user stuck on a day most recently, newest first, without
 * repeats — the picker's 「最近」 group (DP-243).
 *
 * Derived from the stickers themselves rather than a separate "recently used"
 * record: nothing new to store, back up or migrate, and an account sees the
 * same list on every device. Deleting a sticker drops it from here.
 *
 * Only glyphs in the catalogue count. A backup or an old import may hold any
 * text in `glyph`; the picker's 38px buttons are built for one emoji.
 */
export function recentStickerGlyphs(
  stickers: readonly Sticker[],
  limit = RECENT_STICKER_LIMIT,
): string[] {
  const catalogue = new Set(STICKER_GLYPHS);
  const newestFirst = stickers
    .map((sticker, index) => {
      const time = Date.parse(sticker.createdAt);
      return { glyph: sticker.glyph, index, time: Number.isFinite(time) ? time : 0 };
    })
    // Later in the array is newer when two share a timestamp: the domain
    // appends, and one import writes a whole batch at the same server time.
    .sort((a, b) => b.time - a.time || b.index - a.index);

  const recent: string[] = [];
  for (const { glyph } of newestFirst) {
    if (recent.length >= limit) break;
    if (glyph && catalogue.has(glyph) && !recent.includes(glyph)) recent.push(glyph);
  }
  return recent;
}

/**
 * Month-cell glyph size by how many stickers share the day, from the原檔's
 * `stkSize`. More stickers shrink so the row still fits one cell.
 */
export function stickerFontSize(count: number): number {
  if (count <= 1) return 19;
  if (count === 2) return 15;
  if (count === 3) return 12;
  return 10;
}
