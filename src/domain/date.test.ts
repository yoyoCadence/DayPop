import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  buildMonthGrid,
  daysBetween,
  formatDayTitle,
  formatMonthTitle,
  fromDateKey,
  startOfDay,
  startOfWeek,
  toDateKey,
  weeksBetween,
} from './date';

/**
 * `date.ts` is the calendar's local-time layer: every screen turns a
 * `YYYY-MM-DD` key into a `Date` and back through it, so a mistake here shows
 * up as an off-by-one day in the month grid, the week grid and 綜覽 at once.
 *
 * The assertions are written to hold in any zone the tests happen to run in —
 * dates are built with the local `Date` constructor and compared as keys. The
 * instant/IANA-timezone half of the boundary is covered by `eventTime.test.ts`,
 * which names its zones explicitly.
 */

describe('date keys', () => {
  it('pads month and day and round-trips through a Date', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
    expect(toDateKey(fromDateKey('2026-08-06'))).toBe('2026-08-06');
  });

  it('reads a key as local midnight, not as UTC', () => {
    const date = fromDateKey('2026-08-06');

    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 7, 6]);
    expect([date.getHours(), date.getMinutes()]).toEqual([0, 0]);
  });

  /**
   * Why callers such as `CalendarScreen` validate a date key before seeding
   * state with it. An unusable key never throws, and the empty string is the
   * dangerous one: it parses to year 0, which `Date` maps to 1900, so the
   * calendar quietly jumps a century instead of failing where it went wrong.
   */
  it('does not report an unusable key — it invents a date or an Invalid Date', () => {
    expect(toDateKey(fromDateKey(''))).toBe('1900-01-01');
    expect(Number.isNaN(fromDateKey('沒有日期').getTime())).toBe(true);
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries in both directions', () => {
    expect(toDateKey(addDays(fromDateKey('2026-01-31'), 1))).toBe('2026-02-01');
    expect(toDateKey(addDays(fromDateKey('2026-12-31'), 1))).toBe('2027-01-01');
    expect(toDateKey(addDays(fromDateKey('2026-03-01'), -1))).toBe('2026-02-28');
    // 2028 is a leap year, so February has a 29th to land on.
    expect(toDateKey(addDays(fromDateKey('2028-03-01'), -1))).toBe('2028-02-29');
  });

  it('leaves its input alone', () => {
    const original = fromDateKey('2026-08-06');
    addDays(original, 5);

    expect(toDateKey(original)).toBe('2026-08-06');
  });
});

describe('addMonths', () => {
  it('keeps the day of month when the target month is long enough', () => {
    expect(toDateKey(addMonths(fromDateKey('2026-08-13'), 1))).toBe('2026-09-13');
    expect(toDateKey(addMonths(fromDateKey('2026-08-13'), -1))).toBe('2026-07-13');
  });

  it('clamps instead of overflowing into the following month', () => {
    // Plain setMonth() turns this into 3月3日, which would make PageDown skip
    // February altogether.
    expect(toDateKey(addMonths(fromDateKey('2026-01-31'), 1))).toBe('2026-02-28');
    expect(toDateKey(addMonths(fromDateKey('2028-01-31'), 1))).toBe('2028-02-29');
    expect(toDateKey(addMonths(fromDateKey('2026-03-31'), -1))).toBe('2026-02-28');
    expect(toDateKey(addMonths(fromDateKey('2026-05-31'), 1))).toBe('2026-06-30');
  });

  it('crosses year boundaries in both directions', () => {
    expect(toDateKey(addMonths(fromDateKey('2026-12-15'), 1))).toBe('2027-01-15');
    expect(toDateKey(addMonths(fromDateKey('2026-01-15'), -1))).toBe('2025-12-15');
    expect(toDateKey(addMonths(fromDateKey('2026-06-15'), 12))).toBe('2027-06-15');
  });

  it('leaves its input alone', () => {
    const original = fromDateKey('2026-01-31');
    addMonths(original, 1);

    expect(toDateKey(original)).toBe('2026-01-31');
  });
});

describe('startOfDay', () => {
  it('zeroes the clock without mutating the input', () => {
    const afternoon = new Date(2026, 7, 6, 15, 42, 30, 500);

    const start = startOfDay(afternoon);

    expect([start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds()])
      .toEqual([0, 0, 0, 0]);
    expect(toDateKey(start)).toBe('2026-08-06');
    expect(afternoon.getHours()).toBe(15);
  });
});

describe('startOfWeek', () => {
  // 2026-08-06 is a Thursday.
  it('walks back to Sunday or to Monday, following the preference', () => {
    expect(toDateKey(startOfWeek(fromDateKey('2026-08-06'), 0))).toBe('2026-08-02');
    expect(toDateKey(startOfWeek(fromDateKey('2026-08-06'), 1))).toBe('2026-08-03');
  });

  it('keeps a date that is already the first day of its week', () => {
    expect(toDateKey(startOfWeek(fromDateKey('2026-08-02'), 0))).toBe('2026-08-02');
    expect(toDateKey(startOfWeek(fromDateKey('2026-08-03'), 1))).toBe('2026-08-03');
  });

  // The case the two preferences disagree about most: a Sunday belongs to the
  // week that started the Monday before it when 週一 is the first day.
  it('puts a Sunday in the previous week when weeks start on Monday', () => {
    expect(toDateKey(startOfWeek(fromDateKey('2026-08-09'), 1))).toBe('2026-08-03');
    expect(toDateKey(startOfWeek(fromDateKey('2026-08-09'), 0))).toBe('2026-08-09');
  });
});

describe('daysBetween', () => {
  it('counts forwards, backwards and not at all', () => {
    expect(daysBetween(fromDateKey('2026-08-06'), fromDateKey('2026-08-09'))).toBe(3);
    expect(daysBetween(fromDateKey('2026-08-09'), fromDateKey('2026-08-06'))).toBe(-3);
    expect(daysBetween(fromDateKey('2026-08-06'), fromDateKey('2026-08-06'))).toBe(0);
  });

  it('ignores the time of day on either side', () => {
    const morning = new Date(2026, 7, 6, 1, 0);
    const night = new Date(2026, 7, 7, 23, 30);

    expect(daysBetween(morning, night)).toBe(1);
  });

  // A local day is 23 or 25 hours long across a DST transition. Whichever zone
  // the test runs in, one step must still count as exactly one day.
  it('counts every step of a whole year as one day, including any DST change', () => {
    let cursor = fromDateKey('2026-01-01');
    for (let step = 0; step < 365; step += 1) {
      const next = addDays(cursor, 1);
      expect(daysBetween(cursor, next)).toBe(1);
      cursor = next;
    }
    expect(toDateKey(cursor)).toBe('2027-01-01');
  });
});

describe('weeksBetween', () => {
  it('counts whole weeks in both directions', () => {
    expect(weeksBetween(fromDateKey('2026-08-02'), fromDateKey('2026-08-23'))).toBe(3);
    expect(weeksBetween(fromDateKey('2026-08-23'), fromDateKey('2026-08-02'))).toBe(-3);
    expect(weeksBetween(fromDateKey('2026-08-02'), fromDateKey('2026-08-02'))).toBe(0);
  });

  // `MonthView` uses this to find the row for today inside its scroll buffer, so
  // a rounding slip would land the initial scroll on the wrong week.
  it('rounds a partial week to the nearest whole one', () => {
    expect(weeksBetween(fromDateKey('2026-08-02'), fromDateKey('2026-08-06'))).toBe(1);
    expect(weeksBetween(fromDateKey('2026-08-02'), fromDateKey('2026-08-04'))).toBe(0);
  });
});

describe('buildMonthGrid', () => {
  it('always returns six weeks of consecutive days', () => {
    const grid = buildMonthGrid(new Date(2026, 7, 15), 0, 'fixed-six');

    expect(grid).toHaveLength(42);
    for (let index = 1; index < grid.length; index += 1) {
      expect(daysBetween(grid[index - 1]!, grid[index]!)).toBe(1);
    }
  });

  it('starts on the configured first day of the week', () => {
    expect(buildMonthGrid(new Date(2026, 7, 15), 0, 'fixed-six')[0]?.getDay()).toBe(0);
    expect(buildMonthGrid(new Date(2026, 7, 15), 1, 'fixed-six')[0]?.getDay()).toBe(1);
  });

  it('covers the whole cursor month with leading and trailing days', () => {
    const grid = buildMonthGrid(new Date(2026, 7, 15), 0, 'fixed-six').map(toDateKey);

    // 2026-08-01 is a Saturday, so a Sunday-start grid opens on 2026-07-26.
    expect(grid[0]).toBe('2026-07-26');
    expect(grid).toContain('2026-08-01');
    expect(grid).toContain('2026-08-31');
    expect(grid.at(-1)).toBe('2026-09-05');
  });

  it('does not depend on which day of the month the cursor is', () => {
    const first = buildMonthGrid(new Date(2026, 7, 1), 1, 'fixed-six').map(toDateKey);
    const last = buildMonthGrid(new Date(2026, 7, 31), 1, 'fixed-six').map(toDateKey);

    expect(first).toEqual(last);
  });

  it('uses only the 4-6 weeks an adaptive month actually needs', () => {
    // February 2026 starts on Sunday and has exactly four complete weeks.
    expect(buildMonthGrid(new Date(2026, 1, 1), 0, 'adaptive')).toHaveLength(28);
    expect(buildMonthGrid(new Date(2026, 5, 1), 0, 'adaptive')).toHaveLength(35);
    expect(buildMonthGrid(new Date(2026, 7, 1), 0, 'adaptive')).toHaveLength(42);
    expect(buildMonthGrid(new Date(2026, 1, 1), 0, 'fixed-six')).toHaveLength(42);
  });
});

/**
 * These two are the only `Intl` formatters in the module. No screen calls them
 * today — the ported header labels are built inline so they match the原檔
 * wording exactly — so the tests pin the shape rather than assume a caller.
 */
describe('title formatting', () => {
  it('writes a zh-TW month title', () => {
    expect(formatMonthTitle(new Date(2026, 7, 6))).toBe('2026年8月');
  });

  it('writes a zh-TW day title with its weekday', () => {
    // Whether ICU inserts a space before the weekday varies by build.
    expect(formatDayTitle('2026-08-06')).toMatch(/^8月6日\s*週四$/);
  });
});
