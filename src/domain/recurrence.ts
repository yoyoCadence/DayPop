import { RRule } from 'rrule';
import { addDays, daysBetween, fromDateKey, toDateKey } from './date';
import {
  instantDateInZone,
  instantTimeInZone,
  wallTimeToInstant,
} from './eventTime';
import type {
  CalendarEvent,
  DayPopUserData,
  EventException,
  EventOccurrence,
} from './types';

const DATE_UNTIL = /^\d{8}$/;
const UTC_DATE_TIME_UNTIL = /^\d{8}T\d{6}Z$/;
const POSITIVE_INTEGER = /^[1-9]\d*$/;
const ALL_DAY_TIME_PARTS = new Set(['BYHOUR', 'BYMINUTE', 'BYSECOND']);
const MAX_OCCURRENCES_PER_WINDOW = 10_000;

export class RecurrenceRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecurrenceRuleError';
  }
}

export interface OccurrenceWindow {
  /** Inclusive DayPop date boundary. */
  startDate: string;
  /** Inclusive DayPop date boundary. */
  endDate: string;
}

export interface ResolvedEventOccurrence {
  /** Stable render key for this source occurrence. */
  key: string;
  sourceEventId: string;
  occurrence: EventOccurrence;
  event: CalendarEvent;
  replacementEventId: string | null;
}

/**
 * Parse the RFC 5545 RECUR value stored by DayPop.
 *
 * DTSTART and TZID belong to the event, not the RRULE column. Keeping them out
 * of the stored text lets all-day and timed events share one DB field while
 * expansion can still anchor the rule to the event's canonical start.
 */
export function parseRecurrenceRule(rule: string, allDay: boolean) {
  const canonical = rule.trim().toUpperCase();
  if (!canonical || canonical.includes('\n') || canonical.startsWith('RRULE:')) {
    throw new RecurrenceRuleError('recurrence rule must contain only the RECUR value');
  }

  const parts = new Map<string, string>();
  for (const part of canonical.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0 || separator === part.length - 1) {
      throw new RecurrenceRuleError('recurrence rule contains an invalid rule part');
    }
    const name = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (parts.has(name)) {
      throw new RecurrenceRuleError(`recurrence rule repeats ${name}`);
    }
    parts.set(name, value);
  }

  if (!parts.has('FREQ')) throw new RecurrenceRuleError('recurrence rule requires FREQ');
  if (parts.has('COUNT') && parts.has('UNTIL')) {
    throw new RecurrenceRuleError('recurrence rule cannot contain both COUNT and UNTIL');
  }
  for (const name of ['COUNT', 'INTERVAL']) {
    const value = parts.get(name);
    if (value !== undefined && !POSITIVE_INTEGER.test(value)) {
      throw new RecurrenceRuleError(`${name} must be a positive integer`);
    }
  }

  const until = parts.get('UNTIL');
  if (until !== undefined) {
    const valid = allDay ? DATE_UNTIL.test(until) : UTC_DATE_TIME_UNTIL.test(until);
    if (!valid) {
      throw new RecurrenceRuleError(
        allDay
          ? 'all-day UNTIL must be an RFC 5545 DATE'
          : 'timed UNTIL must be an RFC 5545 UTC DATE-TIME',
      );
    }
  }
  if (allDay) {
    for (const name of ALL_DAY_TIME_PARTS) {
      if (parts.has(name)) {
        throw new RecurrenceRuleError(`${name} is not valid for an all-day DTSTART`);
      }
    }
  }

  try {
    return { canonical, options: RRule.parseString(canonical), until };
  } catch (error) {
    throw new RecurrenceRuleError(
      error instanceof Error ? error.message : 'recurrence rule is invalid',
    );
  }
}

export function isRecurrenceRule(rule: unknown, allDay: boolean): rule is string {
  if (typeof rule !== 'string' || rule.trim() !== rule) return false;
  try {
    parseRecurrenceRule(rule, allDay);
    return true;
  } catch {
    return false;
  }
}

/** The five repeat choices in the canonical prototype, expressed as RRULEs. */
export function recurrenceRuleForPreset(
  preset: 'none' | 'daily' | 'weekday' | 'weekly' | 'monthly' | 'yearly',
): string | null {
  switch (preset) {
    case 'none':
      return null;
    case 'daily':
      return 'FREQ=DAILY';
    case 'weekday':
      return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'weekly':
      return 'FREQ=WEEKLY';
    case 'monthly':
      return 'FREQ=MONTHLY';
    case 'yearly':
      return 'FREQ=YEARLY';
  }
}

/**
 * Resolve base events plus exception rows into concrete occurrences.
 *
 * RRule generates calendar fields in a floating UTC frame. Timed results are
 * then resolved through DayPop's wall-time boundary. This deliberately avoids
 * adding fixed milliseconds: a daily 09:00 stays 09:00 when DST changes.
 */
export function resolveEventOccurrences(
  data: Pick<DayPopUserData, 'events' | 'eventExceptions'>,
  window: OccurrenceWindow,
): ResolvedEventOccurrence[] {
  if (window.endDate < window.startDate) {
    throw new RangeError('occurrence window endDate must be on or after startDate');
  }

  const eventsById = new Map(data.events.map((event) => [event.id, event]));
  const replacementIds = new Set(
    data.eventExceptions
      .map((exception) => exception.replacementEventId)
      .filter((id): id is string => id !== null),
  );
  const exceptionsByEvent = groupExceptions(data.eventExceptions);
  const includedReplacements = new Set<string>();
  const resolved: ResolvedEventOccurrence[] = [];

  for (const event of data.events) {
    if (replacementIds.has(event.id)) continue;
    if (event.recurrence === null) {
      if (eventOverlapsWindow(event, window)) {
        const occurrence = eventOccurrence(event);
        resolved.push(toResolved(event.id, occurrence, event, null));
      }
      continue;
    }

    for (const shifted of expandBaseEvent(event, window)) {
      const occurrence = eventOccurrence(shifted);
      const exception = exceptionsByEvent.get(event.id)?.get(occurrenceKey(occurrence));
      if (exception?.isCancelled) continue;
      if (exception && exception.replacementEventId !== null) {
        const replacement = eventsById.get(exception.replacementEventId);
        if (replacement && eventOverlapsWindow(replacement, window)) {
          resolved.push(
            toResolved(event.id, occurrence, replacement, exception.replacementEventId),
          );
          includedReplacements.add(exception.replacementEventId);
        }
      } else if (eventOverlapsWindow(shifted, window)) {
        resolved.push(toResolved(event.id, occurrence, shifted, null));
      }
    }
  }

  // A replacement can move into this window from an original occurrence that
  // lies outside it. Include it once without expanding an unbounded base range.
  for (const exception of data.eventExceptions) {
    if (exception.isCancelled || includedReplacements.has(exception.replacementEventId)) continue;
    const replacement = eventsById.get(exception.replacementEventId);
    if (replacement && eventOverlapsWindow(replacement, window)) {
      resolved.push(
        toResolved(
          exception.eventId,
          exception.occurrence,
          replacement,
          exception.replacementEventId,
        ),
      );
      includedReplacements.add(exception.replacementEventId);
    }
  }

  return resolved.sort(compareOccurrences);
}

function expandBaseEvent(event: CalendarEvent, window: OccurrenceWindow): CalendarEvent[] {
  if (event.recurrence === null) return [event];
  const startDate = event.allDay
    ? event.startDate
    : instantDateInZone(event.startsAt, event.timezone);
  const startTime = event.allDay ? '00:00' : instantTimeInZone(event.startsAt, event.timezone);
  const endDate = event.allDay
    ? event.endDate
    : instantDateInZone(event.endsAt, event.timezone);
  const endTime = event.allDay ? '00:00' : instantTimeInZone(event.endsAt, event.timezone);
  const spanDays = daysBetween(fromDateKey(startDate), fromDateKey(endDate));
  const parsed = parseRecurrenceRule(event.recurrence.rule, event.allDay);
  const dtstart = floatingDate(startDate, startTime);
  const options = {
    ...parsed.options,
    dtstart,
    // A timed UNTIL is a real UTC instant. RRule is operating on floating
    // calendar fields here, so filter it after wall-time resolution instead.
    until: event.allDay ? parsed.options.until : null,
  };
  const rule = new RRule(options);
  const after = floatingDate(
    toDateKey(addDays(fromDateKey(window.startDate), -Math.max(0, spanDays))),
    '00:00',
  );
  const before = floatingDate(
    toDateKey(addDays(fromDateKey(window.endDate), 1)),
    '00:00',
  );
  const actualUntil =
    !event.allDay && parsed.until ? parseBasicUtcDateTime(parsed.until).getTime() : null;

  const candidates = rule.between(
    after,
    before,
    true,
    (_candidate, length) => length <= MAX_OCCURRENCES_PER_WINDOW,
  );
  if (candidates.length > MAX_OCCURRENCES_PER_WINDOW) {
    throw new RecurrenceRuleError('recurrence rule produces too many occurrences in this window');
  }

  return candidates
    .map((candidate) => floatingDateKey(candidate))
    .map((candidateDate) => shiftEvent(event, candidateDate, startTime, endTime, spanDays))
    .filter((candidate): candidate is CalendarEvent => candidate !== null)
    .filter(
      (candidate) =>
        actualUntil === null ||
        (candidate.allDay ? true : Date.parse(candidate.startsAt) <= actualUntil),
    );
}

function shiftEvent(
  event: CalendarEvent,
  candidateDate: string,
  startTime: string,
  endTime: string,
  spanDays: number,
): CalendarEvent | null {
  if (event.allDay) {
    return {
      ...event,
      startDate: candidateDate,
      endDate: toDateKey(addDays(fromDateKey(candidateDate), spanDays)),
    };
  }

  const startsAt = wallTimeToInstant(candidateDate, startTime, event.timezone);
  // RFC 5545 omits generated instances whose local DTSTART does not exist,
  // such as 02:30 during a spring-forward gap.
  if (
    instantDateInZone(startsAt, event.timezone) !== candidateDate ||
    instantTimeInZone(startsAt, event.timezone) !== startTime
  ) {
    return null;
  }
  const occurrenceEndDate = toDateKey(addDays(fromDateKey(candidateDate), spanDays));
  const endsAt = wallTimeToInstant(occurrenceEndDate, endTime, event.timezone);
  return { ...event, startsAt, endsAt };
}

function eventOverlapsWindow(event: CalendarEvent, window: OccurrenceWindow): boolean {
  const start = event.allDay
    ? event.startDate
    : instantDateInZone(event.startsAt, event.timezone);
  const end = event.allDay ? event.endDate : instantDateInZone(event.endsAt, event.timezone);
  return start <= window.endDate && end >= window.startDate;
}

function eventOccurrence(event: CalendarEvent): EventOccurrence {
  return event.allDay
    ? { kind: 'all-day', date: event.startDate }
    : { kind: 'timed', startsAt: event.startsAt };
}

function groupExceptions(exceptions: EventException[]) {
  const grouped = new Map<string, Map<string, EventException>>();
  for (const exception of exceptions) {
    const byOccurrence = grouped.get(exception.eventId) ?? new Map<string, EventException>();
    byOccurrence.set(occurrenceKey(exception.occurrence), exception);
    grouped.set(exception.eventId, byOccurrence);
  }
  return grouped;
}

function occurrenceKey(occurrence: EventOccurrence): string {
  return occurrence.kind === 'all-day'
    ? `all-day:${occurrence.date}`
    : `timed:${occurrence.startsAt}`;
}

function toResolved(
  sourceEventId: string,
  occurrence: EventOccurrence,
  event: CalendarEvent,
  replacementEventId: string | null,
): ResolvedEventOccurrence {
  return {
    key: `${sourceEventId}:${occurrenceKey(occurrence)}`,
    sourceEventId,
    occurrence,
    event,
    replacementEventId,
  };
}

function compareOccurrences(left: ResolvedEventOccurrence, right: ResolvedEventOccurrence): number {
  const leftStart = left.event.allDay ? left.event.startDate : left.event.startsAt;
  const rightStart = right.event.allDay ? right.event.startDate : right.event.startsAt;
  return leftStart.localeCompare(rightStart) || left.key.localeCompare(right.key);
}

function floatingDate(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!));
}

function floatingDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function parseBasicUtcDateTime(value: string): Date {
  return new Date(
    Date.UTC(
      Number(value.slice(0, 4)),
      Number(value.slice(4, 6)) - 1,
      Number(value.slice(6, 8)),
      Number(value.slice(9, 11)),
      Number(value.slice(11, 13)),
      Number(value.slice(13, 15)),
    ),
  );
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
