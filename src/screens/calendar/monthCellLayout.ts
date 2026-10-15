/**
 * How many event chips a month cell can draw without squeezing them — DP-165.
 *
 * The原檔 always drew three chips and a `+N`. That fits a 114px row (390×844),
 * but a 360×640 phone gets 73px rows and the fixed six-row grid 61px, and the
 * flex column then crushed the chips and the lunar line to 6px and 3px. Now the
 * cell shows as many whole chips as fit, and the rest become the `+N`.
 *
 * The heights below are the natural heights measured in Chromium for the rules
 * in calendar.css. `e2e/month-cell-fit.spec.ts` lays out real cells and fails
 * if any chip or the lunar line is drawn shorter than that, so a change to the
 * CSS that this file does not follow shows up there.
 */

/** Chips drawn at most, as in the原檔. */
export const MAX_CELL_EVENTS = 3;

/**
 * `.cal-cell`'s 3px top padding and 1px bottom border. Its 2px bottom padding is
 * still inside the clip, so the last line may run into it: at 73px three
 * chips need 0.08px more than the content box and are drawn whole.
 */
const CELL_CHROME = 4;
/** Every child after the first sits `gap: 2px` below the previous one. */
const GAP = 2;
/** `.cal-cell-day` (12px × 1.1) and `.cal-cell-lunar` (8px × 1). */
const HEADER = 13.2 + GAP + 8;
/** `.cal-cell-event`: 8.5px × 1.25 plus 1px padding top and bottom. */
const CHIP = 12.625;
/** `.cal-cell-more` at 8px in the inherited line height. */
const MORE = 11;
/** `.cal-cell-stickers` has 1px bottom padding under one line of glyphs. */
const STICKER_ROW_PADDING = 1;

export interface CellChipBudget {
  /** Chips to draw, in order. */
  shown: number;
  /** Events left for the `+N` line, 0 when there is none. */
  hidden: number;
}

/**
 * Chips for one cell. Room is reserved for one line of stickers, because they
 * are pinned to the bottom. More stickers than fit on that line are what gets
 * cut off, never a chip: the day sheet shows them all.
 *
 * The count beats the titles. When even one chip and the `+N` do not fit, the
 * cell keeps the `+N` alone.
 */
export function cellChipBudget(
  rowHeight: number,
  eventCount: number,
  stickerFontSize: number | null,
): CellChipBudget {
  const stickers = stickerFontSize === null ? 0 : GAP + stickerFontSize + STICKER_ROW_PADDING;
  const room = rowHeight - CELL_CHROME - HEADER - stickers;
  const upTo = Math.min(eventCount, MAX_CELL_EVENTS);
  for (let shown = upTo; shown > 0; shown -= 1) {
    const hidden = eventCount - shown;
    const height = shown * (GAP + CHIP) + (hidden > 0 ? GAP + MORE : 0);
    if (height <= room) return { shown, hidden };
  }
  return { shown: 0, hidden: eventCount };
}
