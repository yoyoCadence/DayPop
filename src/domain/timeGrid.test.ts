import { describe, expect, it } from 'vitest';
import { BASELINE_HOUR_RANGE } from './displaySegments';
import {
  blockGeometry,
  columnShift,
  gridHeight,
  hourRail,
  minutesFromTime,
  moveRange,
  nowLineTop,
  resizeRange,
  snapMinutes,
  timeFromMinutes,
} from './timeGrid';

/** The原檔's fixed rail, which every week still falls back to. */
const BASELINE = BASELINE_HOUR_RANGE;

describe('time conversion', () => {
  it('round-trips HH:MM', () => {
    expect(minutesFromTime('09:30')).toBe(570);
    expect(timeFromMinutes(570)).toBe('09:30');
    expect(timeFromMinutes(0)).toBe('00:00');
    // Midnight at the end of the day renders as 00:00, as in the原檔.
    expect(timeFromMinutes(1440)).toBe('00:00');
  });

  it('tolerates malformed input rather than producing NaN', () => {
    expect(minutesFromTime('')).toBe(0);
  });
});

describe('grid geometry', () => {
  it('places an event by its start hour', () => {
    // 09:00–10:00 is two hours past the 07:00 rail start.
    expect(blockGeometry(540, 600, BASELINE)).toEqual({ top: 88, height: 44 });
  });

  it('keeps very short events readable', () => {
    expect(blockGeometry(540, 555, BASELINE).height).toBe(20);
  });

  it('clips events that start before the rail', () => {
    // 06:00–08:00 — the first hour is above the grid.
    expect(blockGeometry(360, 480, BASELINE)).toEqual({ top: 0, height: 44 });
  });

  it('draws the rail from 07:00 to 22:00', () => {
    const rail = hourRail(BASELINE);
    expect(rail).toHaveLength(16);
    expect(rail[0]).toEqual({ label: '07:00', top: 0 });
    expect(rail[15]).toEqual({ label: '22:00', top: 660 });
    expect(gridHeight(BASELINE)).toBe(676);
  });
});

/**
 * The rail used to be a fixed 07:00–22:00, so a 23:00 event was drawn on the
 * 22:00 line — the wrong time, which is what DP-064 §9 forbids. Every function
 * that positions something now takes the week's own range.
 */
describe('dynamic hour range', () => {
  const EXTENDED = { startHour: 6, endHour: 24 };

  it('places a block against the extended rail, not the baseline', () => {
    // 23:00–24:00 on a 06:00 rail: seventeen hours down, one hour tall. On the
    // baseline rail this same block computed a top of 704px on a 676px grid.
    expect(blockGeometry(1380, 1440, EXTENDED)).toEqual({ top: 748, height: 44 });
    expect(blockGeometry(1380, 1440, BASELINE).top).toBeGreaterThan(gridHeight(BASELINE));
  });

  it('starts a continuation at the top of the day when the rail reaches midnight', () => {
    expect(blockGeometry(0, 30, { startHour: 0, endHour: 24 })).toEqual({ top: 0, height: 22 });
  });

  it('grows the rail and the grid together', () => {
    const rail = hourRail(EXTENDED);
    expect(rail).toHaveLength(19);
    expect(rail[0]).toEqual({ label: '06:00', top: 0 });
    // The last row of a full day reads 24:00, not 00:00 — the same rule
    // `segmentClock()` follows for the end of a cross-midnight segment.
    expect(rail.at(-1)).toEqual({ label: '24:00', top: 792 });
    // The grid has to end where the rail does, or the two stop lining up.
    expect(gridHeight(EXTENDED)).toBe(792 + 16);
  });

  it('moves the now line with the rail', () => {
    // 08:00 is one hour down a 07:00 rail and two down a 06:00 one.
    expect(nowLineTop(480, BASELINE)).toBe(44);
    expect(nowLineTop(480, EXTENDED)).toBe(88);
    // 23:00 is off the baseline rail but on the extended one.
    expect(nowLineTop(1380, BASELINE)).toBeNull();
    expect(nowLineTop(1380, EXTENDED)).toBe(748);
  });
});

describe('drag maths', () => {
  it('snaps vertical movement to quarter hours', () => {
    expect(snapMinutes(0)).toBe(0);
    expect(snapMinutes(11)).toBe(15);
    expect(snapMinutes(44)).toBe(60);
    expect(snapMinutes(-44)).toBe(-60);
  });

  it('moves a block without changing its length', () => {
    expect(moveRange({ startMinutes: 540, endMinutes: 600 }, 30)).toEqual({
      startMinutes: 570,
      endMinutes: 630,
    });
  });

  it('pushes a block back inside the day instead of clipping it', () => {
    expect(moveRange({ startMinutes: 30, endMinutes: 90 }, -60)).toEqual({
      startMinutes: 0,
      endMinutes: 60,
    });
    expect(moveRange({ startMinutes: 1350, endMinutes: 1410 }, 60)).toEqual({
      startMinutes: 1380,
      endMinutes: 1440,
    });
  });

  it('never resizes below one snap step', () => {
    expect(resizeRange({ startMinutes: 540, endMinutes: 600 }, -120)).toEqual({
      startMinutes: 540,
      endMinutes: 555,
    });
  });

  it('shifts columns and clamps to the visible week', () => {
    expect(columnShift(60, 2)).toBe(3);
    expect(columnShift(-120, 2)).toBe(0);
    expect(columnShift(600, 2)).toBe(6);
    expect(columnShift(20, 2)).toBe(2);
  });
});

describe('now line', () => {
  /** Minutes from local midnight, which is what the caller reads in the display zone. */
  const at = (hour: number, minute = 0) => hour * 60 + minute;

  it('is placed by hour and minute', () => {
    expect(nowLineTop(at(7), BASELINE)).toBe(0);
    expect(nowLineTop(at(9, 30), BASELINE)).toBe(110);
  });

  it('is hidden outside the rail', () => {
    expect(nowLineTop(at(6, 59), BASELINE)).toBeNull();
    expect(nowLineTop(at(23), BASELINE)).toBeNull();
  });
});
