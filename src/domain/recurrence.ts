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
 * The question is whether any window DayPop draws — at widest, 綜覽的 年 view —
 * could ever hold more occurrences than the resolver accepts. **Ever** is the
 * hard part, and eight rounds of review were spent learning it cannot be
 * answered by looking:
 *
 * - Sampling DTSTART’s own day missed `BYDAY=TU` when DTSTART is a Monday.
 * - Sampling a year missed a leap-day rule whose next hit was three years out.
 * - Walking a look-ahead missed one whose next hit was 27 years out, then — with
 *   the look-ahead widened — one that skipped 2100 because a century year is not
 *   a leap year, and finally one that showed 6,000 rows on the sparse years it
 *   did reach and 12,000 on a leap year it did not.
 *
 * Every one of those was the same mistake: treating what a finite look-ahead
 * happened to show as a statement about all future time. So nothing is sampled
 * any more. Two bounds are computed instead, both of which hold forever:
 *
 * - **What the rule can ever produce.** A rule with COUNT or UNTIL ends, and no
 *   window can hold more than the whole of it. Counting stops at the cap, so a
 *   runaway COUNT is cheap to reject, and this is what lets a five-second
 *   `FREQ=SECONDLY;UNTIL=…` through as the six rows it really is.
 * - **What one expansion can ever produce** — `windowCeiling()`, an upper bound
 *   with no calendar arithmetic that could drift. It is charged against the
 *   span the resolver really walks, not the window width: `expandBaseEvent()`
 *   looks back by the event's own length so a long occurrence that reaches
 *   into the window is not missed, which is why a 2000–2028 all-day event on a
 *   plain `FREQ=DAILY` costs twenty-eight years of candidates to draw one year.
 *
 * The smaller of the two decides. Neither can be dodged by a rule that behaves
 * differently in some year nobody looked at.
 *
 * Deliberately **not** part of `parseRecurrenceRule()`, and therefore not part
 * of document validation: making it a validation rule would turn a document
 * that already holds such an event into an unreadable one, sending the whole
 * calendar to the recovery screen over a single row. New data is refused at the
 * boundary; data already stored stays readable and degrades in the view via
 * `expandSafely()`.
 */
export function isExpandableEvent(event: CalendarEvent): boolean {
  if (event.recurrence === null) return true;
  let parsed;
  try {
    parsed = parseRecurrenceRule(event.recurrence.rule, event.allDay);
  } catch {
    return false;
  }

  if (windowCeiling(parsed.options, expansionDays(event)) <= MAX_OCCURRENCES_PER_WINDOW) {
    return true;
  }

  // Only a rule that ends can be cleared by counting it.
  const bounded =
    (parsed.options.count !== undefined && parsed.options.count !== null) ||
    parsed.until !== undefined;
  if (!bounded) return false;
  try {
    return lifetimeCount(event, parsed) <= MAX_OCCURRENCES_PER_WINDOW;
  } catch {
    return false;
  }
}

/**
 * Exact occurrence count for a rule that ends by itself.
 *
 * Counting stops once the cap is passed, so `COUNT=20000` costs 10,001 candidate
 * dates rather than twenty thousand, and no wall time is resolved.
 */
function lifetimeCount(
  event: CalendarEvent,
  parsed: ReturnType<typeof parseRecurrenceRule>,
): number {
  const startDate = event.allDay
    ? event.startDate
    : instantDateInZone(event.startsAt, event.timezone);
  const startTime = event.allDay ? '00:00' : instantTimeInZone(event.startsAt, event.timezone);

  // RRule works in floating calendar fields here, so a timed UNTIL — a real UTC
  // instant — has to be read as the event’s own wall clock first, or a
  // five-second rule counts as if it ran all day. Every IANA offset is a whole
  // number of minutes, so the seconds carry across unchanged.
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

/** How many values a BY* part names, or `null` when it is absent. */
function listSize(part: unknown): number | null {
  if (Array.isArray(part)) return Math.max(1, part.length);
  if (part === undefined || part === null) return null;
  return 1;
}

/**
 * Days `expandBaseEvent()` actually generates candidates across for one window.
 *
 * It starts the expansion at `window.startDate - spanDays` so an occurrence
 * that began earlier but still reaches into the window is not missed. A long
 * event therefore costs far more candidates than the window is wide: a
 * 2000–2028 all-day event drawn in 2028 makes a plain `FREQ=DAILY` look back
 * twenty-eight years, which is over ten thousand candidates even though only
 * 366 of them start inside the window.
 *
 * The `+ 1` is not slack. `expandBaseEvent()` ends the range at
 * `window.endDate + 1` and asks `rule.between(after, before, true)`, which
 * includes both ends, so a daily rule yields `window + span + 1` candidates.
 * Charging only `window + span` left exactly one unaccounted for, which is
 * enough: a 2001-08-16 → 2028-01-01 event measured 10,000 here and produced
 * 10,001 in the resolver.
 */
function expansionDays(event: CalendarEvent): number {
  const startDate = event.allDay
    ? event.startDate
    : instantDateInZone(event.startsAt, event.timezone);
  const endDate = event.allDay ? event.endDate : instantDateInZone(event.endsAt, event.timezone);
  const spanDays = daysBetween(fromDateKey(startDate), fromDateKey(endDate));
  return WIDEST_WINDOW_DAYS + Math.max(0, spanDays) + 1;
}

/**
 * The most occurrences one expansion could ever produce, for any year.
 *
 * Every unknown resolves the expensive way round, so this can be far too large
 * but never too small — which is the only property that makes it safe to accept
 * on. INTERVAL is ignored and BYSETPOS is only ever allowed to reduce, because
 * reading either as a reduction is what made earlier versions accept rules they
 * should not have.
 *
 * `days` is the expansion span rather than the window width, so the event's own
 * length is charged for; see `expansionDays()`.
 */
function windowCeiling(
  options: ReturnType<typeof parseRecurrenceRule>['options'],
  days: number,
): number {
  const perDay = maxPerFiringDay(options);
  let ceiling = perDay * maxFiringDays(options, days);

  // BYSETPOS keeps at most this many occurrences out of each period, whatever
  // the rest of the rule generated.
  const bySetPos = listSize(options.bysetpos);
  if (bySetPos !== null) {
    ceiling = Math.min(ceiling, bySetPos * maxPeriods(options, days));
  }
  return ceiling;
}

/**
 * Occurrences a single firing day can hold.
 *
 * Only the time parts can put more than one occurrence on a day. RFC 5545
 * §3.3.10 decides whether each limits or expands: below DAILY they narrow an
 * otherwise full day, at DAILY and coarser they multiply DTSTART’s own time.
 */
function maxPerFiringDay(options: ReturnType<typeof parseRecurrenceRule>['options']): number {
  const freq = options.freq ?? RRule.SECONDLY;
  return (
    (listSize(options.byhour) ?? (freq >= RRule.HOURLY ? 24 : 1)) *
    (listSize(options.byminute) ?? (freq >= RRule.MINUTELY ? 60 : 1)) *
    (listSize(options.bysecond) ?? (freq >= RRule.SECONDLY ? 60 : 1))
  );
}

/**
 * Days inside one window on which the rule could fire.
 *
 * Anything not clearly narrower falls back to every day, so a bare `BYDAY=MO`
 * under MONTHLY — every Monday of the month, not one day — is never mistaken
 * for a single day again. A window straddles two years, hence the doubling.
 */
function maxFiringDays(
  options: ReturnType<typeof parseRecurrenceRule>['options'],
  days: number,
): number {
  const freq = options.freq ?? RRule.SECONDLY;
  const byMonth = listSize(options.bymonth);
  const byMonthDay = listSize(options.bymonthday);
  const byYearDay = listSize(options.byyearday);
  const byWeekday = listSize(options.byweekday);
  const byWeekNo = listSize(options.byweekno);
  const capped = (value: number) => Math.min(days, Math.max(1, value));
  // Calendar units the span can touch. Each is rounded up and given one more,
  // so a span that straddles a boundary is never charged too little.
  const years = Math.ceil(days / 365) + 1;
  const months = Math.ceil(days / 28) + 1;
  const weeks = Math.ceil(days / 7) + 1;

  if (byYearDay !== null) return capped(years * byYearDay);
  if (byMonthDay !== null) return capped(years * byMonthDay * (byMonth ?? 12));
  // A non-ordinal BYDAY selects every matching weekday in its period; only the
  // weekly case has a bound worth computing, and the rest stay at every day.
  if (byWeekday !== null) return freq === RRule.WEEKLY ? capped(weeks * byWeekday) : days;
  if (byWeekNo !== null) return days;
  if (byMonth !== null) return capped(years * byMonth * 31);

  if (freq === RRule.YEARLY) return capped(years);
  if (freq === RRule.MONTHLY) return capped(months);
  if (freq === RRule.WEEKLY) return capped(weeks);
  return days;
}

/** FREQ periods that can start inside the expansion span, ignoring INTERVAL. */
function maxPeriods(
  options: ReturnType<typeof parseRecurrenceRule>['options'],
  days: number,
): number {
  const freq = options.freq ?? RRule.SECONDLY;
  if (freq === RRule.YEARLY) return Math.ceil(days / 365) + 1;
  if (freq === RRule.MONTHLY) return Math.ceil(days / 28) + 1;
  if (freq === RRule.WEEKLY) return Math.ceil(days / 7) + 1;
  if (freq === RRule.DAILY) return days;
  if (freq === RRule.HOURLY) return days * 24;
  if (freq === RRule.MINUTELY) return days * 24 * 60;
  return days * 24 * 60 * 60;
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
