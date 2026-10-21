import { addDays, fromDateKey, startOfWeek, toDateKey } from '../../domain/date';

export const MONTH_WINDOW_WEEKS = 53;
export const MONTH_SHIFT_WEEKS = 12;

// Keep native Dates internally: a partial boundary week can start in year 0099
// or end in 10000, neither of which is a supported domain date key.
export function clampMonthDate(date: Date): Date {
  const min = fromDateKey('0100-01-01');
  const max = fromDateKey('9999-12-31');
  return new Date(Math.max(min.getTime(), Math.min(max.getTime(), date.getTime())));
}

export function clampMonthWindowStart(start: Date, weekStartsOn: 0 | 1): Date {
  const min = startOfWeek(fromDateKey('0100-01-01'), weekStartsOn);
  const max = addDays(startOfWeek(fromDateKey('9999-12-31'), weekStartsOn), -(MONTH_WINDOW_WEEKS - 1) * 7);
  const aligned = startOfWeek(start, weekStartsOn);
  return new Date(Math.max(min.getTime(), Math.min(max.getTime(), aligned.getTime())));
}

export function centredMonthWindow(date: Date, weekStartsOn: 0 | 1): Date {
  return clampMonthWindowStart(addDays(startOfWeek(date, weekStartsOn), -26 * 7), weekStartsOn);
}

export function monthWindowBounds(start: Date) {
  return {
    startDate: toDateKey(clampMonthDate(start)),
    endDate: toDateKey(clampMonthDate(addDays(start, MONTH_WINDOW_WEEKS * 7 - 1))),
  };
}
