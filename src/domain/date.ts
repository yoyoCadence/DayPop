import type { CalendarGridMode } from './types';

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fromDateKey(value: string): Date {
  const [year = 1970, month = 1, day = 1] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

/** Midnight of the same local day. Mirrors `norm()` in the原檔. */
export function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** First day of the week containing `date`. Mirrors `wkStartOf()` in the原檔. */
export function startOfWeek(date: Date, weekStartsOn: 0 | 1): Date {
  const next = startOfDay(date);
  next.setDate(next.getDate() - ((next.getDay() - weekStartsOn + 7) % 7));
  return next;
}

/**
 * Whole days from `from` to `to`; negative when `to` is earlier.
 *
 * Rounded rather than truncated because a local day is 23 or 25 hours long
 * across a DST transition, which would otherwise turn one day into zero.
 */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

/** Whole weeks from `from` to `to`; negative when `to` is earlier. */
export function weeksBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / (7 * 86_400_000));
}

export function buildMonthGrid(
  cursor: Date,
  weekStartsOn: 0 | 1,
  mode: CalendarGridMode,
): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const offset = (first.getDay() - weekStartsOn + 7) % 7;
  const start = addDays(first, -offset);
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const adaptiveWeeks = Math.ceil((offset + daysInMonth) / 7);
  const weeks = mode === 'fixed-six' ? 6 : adaptiveWeeks;
  return Array.from({ length: weeks * 7 }, (_, index) => addDays(start, index));
}

export function monthGridWeekCount(
  cursor: Date,
  weekStartsOn: 0 | 1,
  mode: CalendarGridMode,
): number {
  return buildMonthGrid(cursor, weekStartsOn, mode).length / 7;
}

export function formatMonthTitle(date: Date): string {
  return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long' }).format(date);
}

export function formatDayTitle(dateKey: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(fromDateKey(dateKey));
}
