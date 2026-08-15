/**
 * Time maths for the week grid.
 *
 * Constants and formulas are transcribed from `buildWeek()` and the
 * `wkDown`/`wkMove`/`wkUp` pointer handlers of
 * `日曆桌寵 Calendar Pet.dc.html`.
 */

/** First and last hour drawn on the rail, and the pixel height of one hour. */
export const GRID_START_HOUR = 7;
export const GRID_END_HOUR = 22;
export const HOUR_HEIGHT = 44;
/** Trailing space below the last hour line, so a 22:00 event still fits. */
export const GRID_PADDING = 16;
export const GRID_HEIGHT = (GRID_END_HOUR - GRID_START_HOUR) * HOUR_HEIGHT + GRID_PADDING;
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

export interface BlockGeometry {
  top: number;
  height: number;
}

/**
 * Where a timed event sits on the grid. Events starting before `GRID_START_HOUR`
 * are clipped at the top rather than drawn off-grid, as in the原檔.
 */
export function blockGeometry(startMinutes: number, endMinutes: number): BlockGeometry {
  let top = (startMinutes / 60 - GRID_START_HOUR) * HOUR_HEIGHT;
  let height = ((endMinutes - startMinutes) / 60) * HOUR_HEIGHT;
  if (height < MIN_BLOCK_HEIGHT) height = MIN_BLOCK_HEIGHT;
  if (top < 0) {
    height += top;
    top = 0;
  }
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
export function nowLineTop(minutesOfDay: number): number | null {
  const hour = minutesOfDay / 60;
  if (hour < GRID_START_HOUR || hour > GRID_END_HOUR) return null;
  return Math.round((hour - GRID_START_HOUR) * HOUR_HEIGHT);
}

export function hourRail(): { label: string; top: number }[] {
  const rows: { label: string; top: number }[] = [];
  for (let hour = GRID_START_HOUR; hour <= GRID_END_HOUR; hour += 1) {
    rows.push({
      label: `${String(hour).padStart(2, '0')}:00`,
      top: (hour - GRID_START_HOUR) * HOUR_HEIGHT,
    });
  }
  return rows;
}
