import { isDateKey } from './validation';

/** A refused date-range command, rather than an invalid persisted document. */
export class AllDayInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllDayInputError';
  }
}

export function allDayDateIssue(startDate: string, endDate: string): string | null {
  if (!isDateKey(startDate) || !isDateKey(endDate)) return '請填寫有效的開始與結束日期。';
  if (endDate < startDate) return '結束日期不能早於開始日期。';
  return null;
}

/** UTC fields are date arithmetic only: all-day dates have no device zone. */
export function dateKeyDaysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000;
}

/** Null when shifting would leave the canonical four-digit date range. */
export function shiftDateKey(date: string, days: number): string | null {
  if (!isDateKey(date) || !Number.isInteger(days)) return null;
  const cursor = new Date(`${date}T00:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  if (!Number.isFinite(cursor.getTime())) return null;
  const shifted = cursor.toISOString().slice(0, 10);
  return isDateKey(shifted) ? shifted : null;
}
