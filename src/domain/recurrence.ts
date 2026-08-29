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
const WIDEST_WINDOW_MS = WIDEST_WINDOW_DAYS * 24 * 60 * 60 * 1000;
/** Floor for the look-ahead; see horizonYears(). */
const MIN_HORIZON_YEARS = 8;

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
 * The question is whether any window DayPop draws — at widest, 綜覽's 年 view —
 * can hold more occurrences than the resolver's cap. That is measured by
 * **walking the rule's own occurrences with a sliding window**, in
 * `walkIsSafe()`, behind a cheap upper bound that clears the common rules
 * without walking at all.
 *
 * Earlier versions tried to answer it without walking, and every one of them
 * was wrong in a way that took another round to find:
 *
 * - Sampling DTSTART's own day missed `BYDAY=TU` when DTSTART is a Monday.
 * - Sampling a year from DTSTART missed `BYMONTH=2;BYMONTHDAY=29` starting in
 *   March, whose next hit is three years out.
 * - Computing density arithmetically kept mis-reading RFC 5545 §3.3.10: it
 *   divided by INTERVAL where a BY* part had already aligned the candidates,
 *   compared a whole lifetime against a per-window cap, charged a weekly rule
 *   its busiest day 366 times over, read a bare `BYDAY=MO` under MONTHLY as one
 *   day a month rather than every Monday, and ignored BYSETPOS entirely.
 *
 * The pattern is clear enough to name: re-deriving recurrence semantics beside
 * the library that already implements them keeps producing subtly different
 * answers. Walking rrule's output asks rrule for the semantics instead, so
 * ordinals, expand/limit and BYSETPOS need no second opinion.
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

  // Walking is exact but costs an iteration per occurrence, and the common
  // rules are nowhere near the cap. This bound only ever *over*-counts, so
  // clearing it is proof on its own and the walk can be skipped — which is
  // every ordinary calendar rule, DAILY and WEEKLY and HOURLY included.
  if (ceilingPerWindow(parsed.options) <= MAX_OCCURRENCES_PER_WINDOW) return true;

  const startDate = event.allDay
    ? event.startDate
    : instantDateInZone(event.startsAt, event.timezone);
  const startTime = event.allDay ? '00:00' : instantTimeInZone(event.startsAt, event.timezone);
  const dtstart = floatingDate(startDate, startTime);

  // RRule works in floating calendar fields here, so a timed UNTIL — a real
  // UTC instant — has to be read as the event’s own wall clock first, or a
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

  let rule;
  try {
    rule = new RRule({ ...parsed.options, dtstart, until });
  } catch {
    return false;
  }

  const horizonEnd = new Date(dtstart.getTime());
  horizonEnd.setUTCFullYear(horizonEnd.getUTCFullYear() + horizonYears(parsed.options));
  return walkIsSafe(rule, dtstart, horizonEnd);
}

/**
 * How far ahead the walk has to go before silence means anything.
 *
 * A sparse rule needs a long look-ahead before it produces anything at all:
 * `FREQ=YEARLY;INTERVAL=9` restricted to a leap day lands only where the
 * interval and the leap cycle agree, which a fixed eight-year window missed
 * entirely. Scaling with the interval gives such a rule a fair chance.
 *
 * **This is a budget, not a proof of periodicity.** The Gregorian calendar's
 * century rule means the true cycle can be 400 years — 2100 is divisible by
 * four and still not a leap year — and the clamp below gives up before that in
 * any case. So reaching the end of this look-ahead never means "safe" on its
 * own; `walkIsSafe()` requires positive evidence, and refuses when it has none.
 */
function horizonYears(options: ReturnType<typeof parseRecurrenceRule>['options']): number {
  const freq = options.freq ?? RRule.SECONDLY;
  const interval = Math.max(1, options.interval ?? 1);
  let years = 0;
  if (freq === RRule.YEARLY) years = interval;
  else if (freq === RRule.MONTHLY) years = interval / 12;
  else if (freq === RRule.WEEKLY) years = (interval * 7) / 365;
  else if (freq === RRule.DAILY) years = interval / 365;
  return Math.min(400, Math.max(MIN_HORIZON_YEARS, Math.ceil(4 * years) + MIN_HORIZON_YEARS));
}

/**
 * An upper bound on occurrences per window, cheap enough to compute for free.
 *
 * Every unknown is resolved the expensive way round, so the result can be too
 * large but never too small — which is what makes it safe to accept on. It
 * assumes every day in the window fires, ignores INTERVAL, and ignores
 * BYSETPOS; those can only ever remove occurrences. Reading them as reductions
 * is precisely what made the previous arithmetic version accept rules it
 * should not have.
 */
function ceilingPerWindow(options: ReturnType<typeof parseRecurrenceRule>['options']): number {
  const size = (part: unknown, fallback: number) =>
    Array.isArray(part) ? Math.max(1, part.length) : part === undefined || part === null ? fallback : 1;
  const freq = options.freq ?? RRule.SECONDLY;
  const perDay =
    size(options.byhour, freq >= RRule.HOURLY ? 24 : 1) *
    size(options.byminute, freq >= RRule.MINUTELY ? 60 : 1) *
    size(options.bysecond, freq >= RRule.SECONDLY ? 60 : 1);
  return perDay * WIDEST_WINDOW_DAYS;
}

/**
 * Walks the rule's own occurrences and reports whether it is safe to store.
 *
 * A sliding window measures the densest run rather than a total, so
 * `FREQ=DAILY;COUNT=20000` is twenty thousand rows but only 366 in any one
 * year, and a rule whose busy days are decades out is still caught once the
 * walk reaches them.
 *
 * **Reaching the horizon is not by itself an answer.** Treating it as one was
 * the previous bug: a rule whose first occurrence was 27 years out produced
 * nothing inside the look-ahead, and "nothing seen" was read as "nothing to
 * worry about" — so 86,400 rows in a single day were accepted at import and
 * only failed years later, on screen. Silence is only meaningful once enough
 * of the rule has actually been observed, so accepting needs one of:
 *
 * - the rule stopped producing before the horizon — it has run out, and what
 *   was counted is everything there will ever be; or
 * - what was seen spans at least two whole windows, so a full window has been
 *   watched sliding across real output rather than guessed at.
 */
function walkIsSafe(rule: RRule, from: Date, to: Date): boolean {
  const seen: number[] = [];
  let oldest = 0;
  let exceeded = false;

  rule.between(from, to, true, (date, length) => {
    const at = date.getTime();
    seen.push(at);
    while (seen[oldest]! <= at - WIDEST_WINDOW_MS) oldest += 1;
    if (seen.length - oldest > MAX_OCCURRENCES_PER_WINDOW) {
      exceeded = true;
      return false;
    }
    return length <= MAX_OCCURRENCES_PER_WINDOW;
  });

  if (exceeded) return false;
  // Seeing nothing is the weakest possible evidence, so it cannot be an accept.
  // This is the same mistake as reading the end of the look-ahead as an answer,
  // and it survived one round longer: `FREQ=YEARLY;INTERVAL=9;BYMONTH=2;
  // BYMONTHDAY=29` from 2064 skips 2100 — a century year is not a leap year —
  // so its next hit is 2136, and the walk came back empty.
  if (seen.length === 0) return false;

  const first = seen[0]!;
  const last = seen[seen.length - 1]!;
  const stoppedEarly = to.getTime() - last > WIDEST_WINDOW_MS;
  return stoppedEarly || last - first >= 2 * WIDEST_WINDOW_MS;
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
