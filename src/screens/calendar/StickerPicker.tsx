import { useMemo, useState } from 'react';
import {
  STICKER_CATEGORIES,
  recentStickerGlyphs,
  type StickerCategoryId,
} from '../../domain/stickerGlyphs';
import type { Sticker } from '../../domain/types';

type GroupId = StickerCategoryId | 'recent';

interface StickerGroup {
  id: GroupId;
  label: string;
  glyphs: readonly string[];
}

export interface StickerPickerProps {
  /** Every sticker the user has, for the 「最近」 group. */
  stickers: readonly Sticker[];
  onPick(glyph: string): void;
}

/**
 * The 日詳情 sticker picker — DP-243.
 *
 * The原檔's picker is one box of 63 emoji. With 240 the box would scroll for
 * a long time, so a row of category buttons sits above the grid and the grid
 * shows one category at a time. The buttons reuse the search page's calendar
 * chips (accent fill when pressed, `aria-pressed`); unlike those they wrap
 * instead of scrolling sideways, so every category is visible at once.
 *
 * Mounted only while open: each opening starts at 「最近」 when the user has
 * stuck anything before, otherwise at the first category.
 */
export function StickerPicker({ stickers, onPick }: StickerPickerProps) {
  const recent = useMemo(() => recentStickerGlyphs(stickers), [stickers]);
  const groups = useMemo<StickerGroup[]>(
    () => [
      ...(recent.length > 0 ? [{ id: 'recent' as const, label: '最近', glyphs: recent }] : []),
      ...STICKER_CATEGORIES,
    ],
    [recent],
  );
  const [chosen, setChosen] = useState<GroupId | null>(null);
  // A chosen group that no longer exists (「最近」 after its last sticker was
  // deleted) falls back to the first one rather than showing an empty grid.
  const active = groups.find((group) => group.id === chosen) ?? groups[0]!;

  return (
    <div className="cal-day-sticker-pick" role="group" aria-label="選擇貼圖">
      <div className="cal-day-sticker-cats" role="group" aria-label="貼圖分類">
        {groups.map((group) => (
          <button
            className="cal-day-sticker-cat"
            key={group.id}
            type="button"
            aria-pressed={group.id === active.id}
            onClick={() => setChosen(group.id)}
          >
            {group.label}
          </button>
        ))}
      </div>
      {/* Keyed so switching category starts the grid at its top. */}
      <div
        className="cal-day-sticker-grid"
        key={active.id}
        role="group"
        aria-label={`${active.label}貼圖`}
      >
        {active.glyphs.map((glyph) => (
          <button
            className="cal-day-sticker-option"
            key={glyph}
            type="button"
            aria-label={`加入貼圖 ${glyph}`}
            onClick={() => onPick(glyph)}
          >
            {glyph}
          </button>
        ))}
      </div>
    </div>
  );
}
