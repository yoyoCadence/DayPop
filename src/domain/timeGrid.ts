/**
 * Time maths for the week grid.
 *
 * Constants and formulas are transcribed from `buildWeek()` and the
 * `wkDown`/`wkMove`/`wkUp` pointer handlers of
 * `日曆桌寵 Calendar Pet.dc.html`.
 *
 * The rail's first and last hour used to be module constants here (07:00–22:00,
 * as in the原檔). They are now a parameter — DP-064: the range is derived per
 * week from the segments that week actually contains, so a 23:00 event is drawn
 * at 23:00 instead of being clamped onto the 22:00 line. `hourRangeForSegments()`
 * in `displaySegments.ts` is the one place that derives it; the four functions
 * below all take the result, because a rail, a now line and a block computed
 * against different ranges would not line up.
 */

import { type HourRange } from './displaySegments';

/** Pixel height of one hour. */
export const HOUR_HEIGHT = 44;
/** Trailing space below the last hour line, so an event on it still fits. */
export const GRID_PADDING = 16;
/** Width of one day column, and of the hour rail on its left. */
export const COLUMN_WIDTH = 60;
export const RAIL_WIDTH = 36;
/** Dragging snaps to quarter hours. */
export const SNAP_MINUTES = 15;
/** Shortest block the grid will draw, so a 15-minute event stays readable. */
export const MIN_BLOCK_HEIGHT = 20;

const MINUTES_PER_DAY = 1440;

export function minutesFromTime(time: string): number {
  const [hour = 0, minute = 0] = (time || '0:0').split(':').map(Number);
  return hour * 60 + minute;
}

export function timeFromMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(minutes)));
  const hour = Math.floor(clamped / 60) % 24;
  return `${String(hour).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/** Pixel height of a grid drawn for `range`. */
export function gridHeight(range: HourRange): number {
  return (range.endHour - range.startHour) * HOUR_HEIGHT + GRID_PADDING;
}

export interface BlockGeometry {
  top: number;
  height: number;
}

/**
 * Where a timed event sits on the grid.
 *
 * Blocks starting before `range.startHour` are clipped at the top rather than
 * drawn off-grid, as in the原檔. A committed segment never needs that clip now
 * that the range is derived from the week's own segments; a *drag preview* still
 * can, because `moveRange()` bounds a drag by the day rather than by the rail.
 * That is transient — the range is recomputed once the drag commits.
 */
export function blockGeometry(
  startMinutes: number,
  endMinutes: number,
  range: HourRange,
): BlockGeometry {
  let top = (startMinutes / 60 - range.startHour) * HOUR_HEIGHT;
  let height = ((endMinutes - startMinutes) / 60) * HOUR_HEIGHT;
  if (top < 0) {
    height += top;
    top = 0;
  }
  // Floored *after* the clip, not before: flooring first let the clip subtract
  // from an already-minimal height and hand back a negative one — a 30-minute
  // preview dragged to 00:00 on a 07:00 rail came out at -286px, which §6
  // forbids and the browser drops as an invalid length.
  if (height < MIN_BLOCK_HEIGHT) height = MIN_BLOCK_HEIGHT;
  return { top: Math.round(top), height: Math.round(height) };
}

/** Pixels dragged vertically converted to snapped minutes. */
export function snapMinutes(deltaPixels: number): number {
  return Math.round(deltaPixels / HOUR_HEIGHT / (SNAP_MINUTES / 60)) * SNAP_MINUTES;
}

export interface DragRange {
  startMinutes: number;
  endMinutes: number;
}

/**
 * Move the whole block, keeping its length and staying inside the day — the
 *原檔 pushes the block back in rather than clipping it.
 */
export function moveRange(range: DragRange, deltaMinutes: number): DragRange {
  let start = range.startMinutes + deltaMinutes;
  let end = range.endMinutes + deltaMinutes;
  if (start < 0) {
    end -= start;
    start = 0;
  }
  if (end > MINUTES_PER_DAY) {
    start -= end - MINUTES_PER_DAY;
    end = MINUTES_PER_DAY;
  }
  return { startMinutes: start, endMinutes: end };
}

/** Drag the bottom edge; the block never becomes shorter than one snap step. */
export function resizeRange(range: DragRange, deltaMinutes: number): DragRange {
  const end = Math.min(
    MINUTES_PER_DAY,
    Math.max(range.startMinutes + SNAP_MINUTES, range.endMinutes + deltaMinutes),
  );
  return { startMinutes: range.startMinutes, endMinutes: end };
}

/** Horizontal drag converted to a column shift, clamped to the visible week. */
export function columnShift(deltaPixels: number, fromIndex: number): number {
  const shift = Math.round(deltaPixels / COLUMN_WIDTH);
  return Math.max(0, Math.min(6, fromIndex + shift));
}

/**
 * Offset of the current-time line, or `null` when now is off the rail.
 *
 * Takes minutes from local midnight rather than a `Date` — DP-064. Reading
 * `now.getHours()` here meant the line was drawn on the *device's* clock while
 * the columns around it were drawn on the display timezone's.
 */
export function nowLineTop(minutesOfDay: number, range: HourRange): number | null {
  const hour = minutesOfDay / 60;
  if (hour < range.startHour || hour > range.endHour) return null;
  return Math.round((hour - range.startHour) * HOUR_HEIGHT);
}

/**
 * The hour labels down the left rail.
 *
 * The last row of a full day reads `24:00`, not `00:00` — the same rule
 * `segmentClock()` follows, and the one §6 of the ADR fixes for the end of a
 * cross-midnight segment.
 */
export function hourRail(range: HourRange): { label: string; top: number }[] {
  const rows: { label: string; top: number }[] = [];
  for (let hour = range.startHour; hour <= range.endHour; hour += 1) {
    rows.push({
      label: `${String(hour).padStart(2, '0')}:00`,
      top: (hour - range.startHour) * HOUR_HEIGHT,
    });
  }
  return rows;
}
