import { describe, expect, it } from 'vitest';
import {
  blockGeometry,
  columnShift,
  GRID_HEIGHT,
  hourRail,
  minutesFromTime,
  moveRange,
  nowLineTop,
  resizeRange,
  snapMinutes,
  timeFromMinutes,
} from './timeGrid';

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
    expect(blockGeometry(540, 600)).toEqual({ top: 88, height: 44 });
  });

  it('keeps very short events readable', () => {
    expect(blockGeometry(540, 555).height).toBe(20);
  });

  it('clips events that start before the rail', () => {
    // 06:00–08:00 — the first hour is above the grid.
    expect(blockGeometry(360, 480)).toEqual({ top: 0, height: 44 });
  });

  it('draws the rail from 07:00 to 22:00', () => {
    const rail = hourRail();
    expect(rail).toHaveLength(16);
    expect(rail[0]).toEqual({ label: '07:00', top: 0 });
    expect(rail[15]).toEqual({ label: '22:00', top: 660 });
    expect(GRID_HEIGHT).toBe(676);
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
    expect(nowLineTop(at(7))).toBe(0);
    expect(nowLineTop(at(9, 30))).toBe(110);
  });

  it('is hidden outside the rail', () => {
    expect(nowLineTop(at(6, 59))).toBeNull();
    expect(nowLineTop(at(23))).toBeNull();
  });
});
