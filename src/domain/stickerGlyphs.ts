/**
 * The sticker palette, copied verbatim from `get STK()` in
 * `日曆桌寵 Calendar Pet.dc.html` — same glyphs, same order, so the picker
 * reads exactly like the原檔's.
 *
 * These are emoji today. The domain `Sticker` already carries an `assetKey`
 * beside `glyph` so a future art set can be introduced without a data
 * migration: new stickers would store an `assetKey`, and existing rows keep
 * rendering their glyph.
 */
export const STICKER_GLYPHS = [
  '💲',
  '💰',
  '💵',
  '💳',
  '❤️',
  '💕',
  '💖',
  '💘',
  '😍',
  '💍',
  '💐',
  '🥂',
  '🎂',
  '🎉',
  '🎊',
  '🎁',
  '🥳',
  '🎈',
  '⭐',
  '🌟',
  '❗',
  '⚠️',
  '🔥',
  '📌',
  '🚩',
  '✈️',
  '🏖️',
  '🚗',
  '🧳',
  '🗺️',
  '☕',
  '🍽️',
  '🍕',
  '🍔',
  '🍺',
  '🍰',
  '💼',
  '📝',
  '📎',
  '💻',
  '📚',
  '🎓',
  '✅',
  '❌',
  '💊',
  '🏥',
  '💪',
  '🏃',
  '🦷',
  '📞',
  '📷',
  '🎵',
  '🎮',
  '🐾',
  '💡',
  '🌙',
  '☀️',
  '🌧️',
  '🌸',
  '🍁',
  '⏰',
  '🎯',
  '🏆',
] as const;

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
