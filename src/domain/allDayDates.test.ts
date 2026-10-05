import { describe, expect, it } from 'vitest';
import { allDayDateIssue, dateKeyDaysBetween, shiftDateKey } from './allDayDates';

describe('timezone-free all-day date arithmetic (DP-127)', () => {
  it.each([
    ['2026-03-07', '2026-03-10', 3], ['2026-10-31', '2026-11-02', 2],
    ['2011-12-29', '2011-12-31', 2], ['2028-02-28', '2028-03-01', 2],
  ])('moves %s..%s by calendar days, including dates skipped by a device zone', (from, to, days) => {
    expect(dateKeyDaysBetween(from, to)).toBe(days);
    expect(shiftDateKey(from, days)).toBe(to);
    expect(shiftDateKey(to, -days)).toBe(from);
  });
  it.each(['', '2026-02-30', '10000-01-01', '0099-12-31'])('refuses invalid canonical dates: %s', (date) => {
    expect(allDayDateIssue(date, '2026-03-01')).not.toBeNull();
    expect(shiftDateKey(date, 1)).toBeNull();
  });
  it('accepts inclusive same-day ranges, refuses reversal and date overflow', () => {
    expect(allDayDateIssue('2026-03-01', '2026-03-01')).toBeNull();
    expect(allDayDateIssue('2026-03-02', '2026-03-01')).toContain('不能早於');
    expect(shiftDateKey('9999-12-31', 0)).toBe('9999-12-31');
    expect(shiftDateKey('9999-12-31', 1)).toBeNull();
    expect(shiftDateKey('0100-01-01', -1)).toBeNull();
  });
});
