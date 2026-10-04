import { addDays, daysBetween, fromDateKey, toDateKey } from './date';
import { instantDateInZone, instantTimeInZone, wallTimeToInstant } from './eventTime';
import { minutesFromTime, timeFromMinutes } from './timeGrid';
import type { TimedCalendarEvent } from './types';

/** Complete endpoints, never the truncated segment that happened to be grabbed. */
export type TimedInterval = Pick<TimedCalendarEvent, 'startsAt' | 'endsAt'>;

function shiftedClock(instant: string, zone: string, minutes: number, days: number): string {
  const clock = minutesFromTime(instantTimeInZone(instant, zone)) + minutes;
  const date = toDateKey(addDays(fromDateKey(instantDateInZone(instant, zone)), days + Math.floor(clock / 1440)));
  return wallTimeToInstant(date, timeFromMinutes(((clock % 1440) + 1440) % 1440), zone);
}

/** Each endpoint moves by calendar days / wall minutes, not a fixed instant delta. */
export function draggedInterval(
  event: TimedCalendarEvent, zone: string, minutes: number, days: number, mode: 'move' | 'resize',
): TimedInterval | null {
  if (!Number.isInteger(minutes) || !Number.isInteger(days)) return null;
  if (minutes === 0 && days === 0) return { startsAt: event.startsAt, endsAt: event.endsAt };
  const startsAt = mode === 'resize' ? event.startsAt : shiftedClock(event.startsAt, zone, minutes, days);
  const endsAt = shiftedClock(event.endsAt, zone, minutes, days);
  const duration = Date.parse(endsAt) - Date.parse(startsAt);
  // A DST fold can reverse two wall readings; reject rather than reinterpret
  // the user's gesture. A resize also cannot shorten below one snap step.
  if (duration <= 0 || (mode === 'resize' && duration < 15 * 60_000)) return null;
  return { startsAt, endsAt };
}

/** Apply the concrete dragged clocks / end-day span back to the series anchor. */
export function seriesIntervalForDrag(
  series: TimedCalendarEvent, occurrence: TimedCalendarEvent, moved: TimedInterval,
): TimedInterval {
  const zone = series.timezone;
  const beforeDate = instantDateInZone(occurrence.startsAt, zone);
  const afterDate = instantDateInZone(moved.startsAt, zone);
  const shift = daysBetween(fromDateKey(beforeDate), fromDateKey(afterDate));
  const anchor = toDateKey(addDays(fromDateKey(instantDateInZone(series.startsAt, zone)), shift));
  const span = daysBetween(fromDateKey(afterDate), fromDateKey(instantDateInZone(moved.endsAt, zone)));
  return {
    startsAt: wallTimeToInstant(anchor, instantTimeInZone(moved.startsAt, zone), zone),
    endsAt: wallTimeToInstant(toDateKey(addDays(fromDateKey(anchor), span)), instantTimeInZone(moved.endsAt, zone), zone),
  };
}
