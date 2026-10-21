import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, fromDateKey, toDateKey } from '../../domain/date';
import { centredMonthWindow, clampMonthWindowStart, monthWindowBounds } from './monthWindow';

describe('month window date boundaries', () => {
  it.each([0, 1] as const)('centres on the target week and shifts 12 calendar weeks across DST (week start %s)', (weekStartsOn) => {
    const target = fromDateKey('2026-03-08');
    const start = centredMonthWindow(target, weekStartsOn);
    expect(start.getDay()).toBe(weekStartsOn);
    const bounds = monthWindowBounds(start);
    expect(daysBetween(fromDateKey(bounds.startDate), fromDateKey(bounds.endDate))).toBe(370);
    const next = clampMonthWindowStart(addDays(start, 84), weekStartsOn);
    expect(daysBetween(start, next)).toBe(84);
    expect(clampMonthWindowStart(addDays(next, -84), weekStartsOn)).toEqual(start);
  });

  it.each([0, 1] as const)('clamps year-edge windows without parsing adjacent 0099/10000 keys (week start %s)', (weekStartsOn) => {
    const first = centredMonthWindow(fromDateKey('0100-01-01'), weekStartsOn);
    const last = centredMonthWindow(fromDateKey('9999-12-31'), weekStartsOn);
    expect(first.getDay()).toBe(weekStartsOn);
    expect(last.getDay()).toBe(weekStartsOn);
    expect(monthWindowBounds(first).startDate).toBe('0100-01-01');
    expect(monthWindowBounds(last).endDate).toBe('9999-12-31');
    expect(daysBetween(first, addDays(first, 370))).toBe(370);
    expect(toDateKey(first).startsWith('0099')).toBe(true);
    expect(clampMonthWindowStart(addDays(first, -84), weekStartsOn)).toEqual(first);
    expect(clampMonthWindowStart(addDays(last, 84), weekStartsOn)).toEqual(last);
  });
});
