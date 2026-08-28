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
/** A leap year — the widest window any DayPop pane asks for (綜覽's 年 view). */
const WIDEST_WINDOW_DAYS = 366;

/**
 * True when this event's rule can be expanded without blowing the cap — DP-081.
 *
 * Judged by **how much it actually generates**, not by which FREQ it uses.
 * `FREQ=HOURLY;COUNT=2` is two rows and draws fine; `FREQ=SECONDLY;COUNT=20000`
 * is twenty thousand inside one day and cannot. Banning the sub-daily
 * frequencies outright was the first attempt and it was wrong: it rejected
 * perfectly drawable .ics files and quietly narrowed what DayPop imports, which
 * is a product decision rather than a crash fix.
 *
 * **No probe window is used, because none is safe.** Both earlier attempts
 * sampled a calendar range and both were dodgeable: DTSTART's own day misses
 * `BYDAY=TU` when DTSTART is a Monday, and a year from DTSTART misses
 * `BYMONTH=2;BYMONTHDAY=29` starting in March, whose next hit is three years
 * out. Where the dense days *land* is exactly what a sampled window cannot see.
 *
 * So the rule is judged on what it can produce, not on where it lands:
 *
 * - **Bounded rules** (COUNT or UNTIL) are counted exactly. They terminate, so
 *   this is cheap, and it is the only way to see that
 *   `FREQ=SECONDLY;UNTIL=…T010005Z` is six occurrences rather than a wall.
 * - **Unbounded rules** repeat forever at a fixed density, so the densest
 *   possible day is computed from FREQ and the BY* time parts and weighed
 *   against the widest window DayPop draws (綜覽's 年 view). Occurrence counts
 *   only grow with the window, so fitting a year means fitting every pane.
 *
 * `expandSafely()` stays the backstop for a month buffer scrolled wider still.
 *
 * Deliberately **not** part of `parseRecurrenceRule()`, and therefore not part
 * of document validation: making it a validation rule would turn a document
 * that already holds such an event into an unreadable one, sending the whole
 * calendar to the recovery screen over a single row. New data is refused at the
 * boundary; data already stored stays readable and degrades in the view.
 */
export function isExpandableEvent(event: CalendarEvent): boolean {
  if (event.recurrence === null) return true;
  let parsed;
  try {
    parsed = parseRecurrenceRule(event.recurrence.rule, event.allDay);
  } catch {
    return false;
  }

  const hasCount = parsed.options.count !== undefined && parsed.options.count !== null;
  if (hasCount || parsed.until !== undefined) {
    try {
      return countBoundedOccurrences(event, parsed) <= MAX_OCCURRENCES_PER_WINDOW;
    } catch {
      return false;
    }
  }
  return maxOccurrencesPerDay(parsed.options) * WIDEST_WINDOW_DAYS <= MAX_OCCURRENCES_PER_WINDOW;
}

/**
 * Exact occurrence count for a rule that ends by itself.
 *
 * Counting stops once the cap is passed, so a `COUNT=20000` rule costs 10,001
 * candidate dates rather than twenty thousand, and no wall time is resolved.
 */
function countBoundedOccurrences(
  event: CalendarEvent,
  parsed: ReturnType<typeof parseRecurrenceRule>,
): number {
  const startDate = event.allDay
    ? event.startDate
    : instantDateInZone(event.startsAt, event.timezone);
  const startTime = event.allDay ? '00:00' : instantTimeInZone(event.startsAt, event.timezone);

  // RRule is working in floating calendar fields here, so a timed UNTIL — which
  // is a real UTC instant — has to be read as the event's own wall clock first,
  // or a five-second rule is counted as if it ran for a whole day. Every IANA
  // offset is a whole number of minutes, so the seconds carry across unchanged.
  let until = parsed.options.until ?? null;
  if (!event.allDay && parsed.until !== undefined) {
    const instant = parseBasicUtcDateTime(parsed.until);
    const iso = instant.toISOString();
    until = new Date(
      floatingDate(
        instantDateInZone(iso, event.timezone),
        instantTimeInZone(iso, event.timezone),
      ).getTime() +
        instant.getUTCSeconds() * 1000,
    );
  }

  const rule = new RRule({
    ...parsed.options,
    dtstart: floatingDate(startDate, startTime),
    until,
  });
  return rule.all((_candidate, length) => length <= MAX_OCCURRENCES_PER_WINDOW).length;
}

/**
 * The most occurrences an unbounded rule can put on one day.
 *
 * RFC 5545 §3.3.10 decides whether a BY* part limits or expands from FREQ: for
 * a sub-daily FREQ the time parts narrow an otherwise full day, and for DAILY
 * and coarser they multiply a single DTSTART time. This reads that table, which
 * is why it does not care where the rule's days actually fall.
 */
function maxOccurrencesPerDay(options: ReturnType<typeof parseRecurrenceRule>['options']): number {
  // `parseRecurrenceRule()` has already refused a rule without FREQ; defaulting
  // to the densest frequency keeps this conservative rather than optimistic if
  // that ever stops being true.
  const freq = options.freq ?? RRule.SECONDLY;
  const size = (part: unknown, fallback: number) =>
    Array.isArray(part) ? Math.max(1, part.length) : part === undefined || part === null ? fallback : 1;

  const hours = size(options.byhour, freq >= RRule.HOURLY ? 24 : 1);
  const minutes = size(options.byminute, freq >= RRule.MINUTELY ? 60 : 1);
  const seconds = size(options.bysecond, freq >= RRule.SECONDLY ? 60 : 1);
  const perDay = hours * minutes * seconds;
  // An INTERVAL only thins a sub-daily rule; on DAILY and coarser it skips whole
  // days, which this per-day figure already treats as the busiest one.
  const interval = Math.max(1, options.interval ?? 1);
  return freq >= RRule.HOURLY ? Math.ceil(perDay / interval) : perDay;
}

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

/**
 * The floating calendar dates a rule generates inside `window`.
 *
 * Split out of `expandBaseEvent()` so the import probe can count what a rule
 * produces without paying for `shiftEvent()` on every candidate — resolving
 * wall times is what made a year-wide probe take tens of seconds.
 */
function recurrenceCandidates(
  event: CalendarEvent & { recurrence: { rule: string } },
  window: OccurrenceWindow,
): Date[] {
  const startDate = event.allDay
    ? event.startDate
    : instantDateInZone(event.startsAt, event.timezone);
  const startTime = event.allDay ? '00:00' : instantTimeInZone(event.startsAt, event.timezone);
  const endDate = event.allDay
    ? event.endDate
    : instantDateInZone(event.endsAt, event.timezone);
  const spanDays = daysBetween(fromDateKey(startDate), fromDateKey(endDate));
  const parsed = parseRecurrenceRule(event.recurrence.rule, event.allDay);
  const options = {
    ...parsed.options,
    dtstart: floatingDate(startDate, startTime),
    // A timed UNTIL is a real UTC instant. RRule is operating on floating
    // calendar fields here, so filter it after wall-time resolution instead.
    until: event.allDay ? parsed.options.until : null,
  };
  const rule = new RRule(options);
  const after = floatingDate(
    toDateKey(addDays(fromDateKey(window.startDate), -Math.max(0, spanDays))),
    '00:00',
  );
  const before = floatingDate(toDateKey(addDays(fromDateKey(window.endDate), 1)), '00:00');

  const candidates = rule.between(
    after,
    before,
    true,
    (_candidate, length) => length <= MAX_OCCURRENCES_PER_WINDOW,
  );
  if (candidates.length > MAX_OCCURRENCES_PER_WINDOW) {
    throw new RecurrenceRuleError('recurrence rule produces too many occurrences in this window');
  }
  return candidates;
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
  const actualUntil =
    !event.allDay && parsed.until ? parseBasicUtcDateTime(parsed.until).getTime() : null;

  const candidates = recurrenceCandidates(
    event as CalendarEvent & { recurrence: { rule: string } },
    window,
  );

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
