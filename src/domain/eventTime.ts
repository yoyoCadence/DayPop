import { addDays, fromDateKey, toDateKey } from './date';
import type { CalendarEvent, TimedCalendarEvent } from './types';

export interface EventWallTime {
  date: string;
  start: string;
  end: string;
}

export function eventWallTime(event: CalendarEvent): EventWallTime {
  if (event.allDay) return { date: event.startDate, start: '', end: '' };
  return {
    date: instantDateInZone(event.startsAt, event.timezone),
    start: instantTimeInZone(event.startsAt, event.timezone),
    end: instantTimeInZone(event.endsAt, event.timezone),
  };
}

export function eventDate(event: CalendarEvent): string {
  return event.allDay ? event.startDate : instantDateInZone(event.startsAt, event.timezone);
}

export function eventStartTime(event: CalendarEvent): string {
  return event.allDay ? '' : instantTimeInZone(event.startsAt, event.timezone);
}

export function eventEndTime(event: CalendarEvent): string {
  return event.allDay ? '' : instantTimeInZone(event.endsAt, event.timezone);
}

export function wallTimeToInstant(date: string, time: string, timezone: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year!, month! - 1, day, hour, minute);
  let guess = target;

  // Recalculate once because the first offset can land across a DST boundary.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = zonedParts(new Date(guess), timezone);
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
    );
    guess = target - (representedAsUtc - guess);
  }
  return new Date(guess).toISOString();
}

export function timedEventFromWallTime(
  common: Omit<TimedCalendarEvent, 'allDay' | 'startsAt' | 'endsAt' | 'timezone'>,
  wallTime: EventWallTime,
  timezone: string,
): TimedCalendarEvent {
  const startsAt = wallTimeToInstant(wallTime.date, wallTime.start, timezone);
  let endsAt = wallTimeToInstant(wallTime.date, wallTime.end, timezone);
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    // An end at or before the start means the event runs into the next day.
    // The end wall time is resolved again *on that day* rather than shifted by
    // 24 hours: on the night the clocks change a local day is 23 or 25 hours
    // long, so a fixed shift lands on the wrong wall clock — a 23:00–00:30
    // event became 23:00–01:30 across a spring-forward boundary.
    endsAt = wallTimeToInstant(
      toDateKey(addDays(fromDateKey(wallTime.date), 1)),
      wallTime.end,
      timezone,
    );
  }
  return { ...common, allDay: false, startsAt, endsAt, timezone };
}

function instantDateInZone(instant: string, timezone: string): string {
  const parts = zonedParts(new Date(instant), timezone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function instantTimeInZone(instant: string, timezone: string): string {
  const parts = zonedParts(new Date(instant), timezone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

function zonedParts(date: Date, timezone: string) {
  const result: Record<string, number> = {};
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  for (const part of parts) {
    if (part.type !== 'literal') result[part.type] = Number(part.value);
  }
  return {
    year: result.year!,
    month: result.month!,
    day: result.day!,
    hour: result.hour!,
    minute: result.minute!,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
