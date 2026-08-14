import { addDays, fromDateKey, toDateKey } from './date';
import { instantDateInZone, instantTimeInZone } from './eventTime';
import type { CalendarEvent, TimedCalendarEvent } from './types';

/**
 * Cross-midnight display — DP-064.
 *
 * DayPop stores a timed event as a pair of instants, so an event can start on
 * one local day and end on another. The原檔 only ever held `HH:MM` strings and
 * never met the case, which is why every view still compares same-day clock
 * strings. See `docs/architecture-decisions.md` §6「決策（DP-064）」 for the
 * decision this module implements; the rules that matter here:
 *
 * - One occurrence is cut into **display segments** at local midnight, in the
 *   **display timezone** (`preferences.timezone`) — never in the event's own
 *   zone, and never by adding 86400000 ms, because a local day is 23 or 25
 *   hours long on the night the clocks change.
 * - A segment is *not* a second event. Every segment carries the occurrence's
 *   `key` (`ResolvedEventOccurrence.key`), so counts can deduplicate on it.
 * - A segment that runs to local midnight ends at `1440` (24:00) on that day
 *   rather than `0` on the next, so the first day draws a full block.
 * - Conflicts compare **instants** on the half-open interval `[start, end)`:
 *   an event ending at 00:30 does not conflict with one starting at 00:30.
 */

/** Minutes in a wall-clock day. A segment may end exactly here (24:00). */
const MINUTES_PER_DAY = 1440;

/**
 * Corrupt or absurd data should not produce a million segments. A year of
 * continuous event is already far past anything the views can draw, so this
 * fails closed rather than hanging the render.
 */
const MAX_SEGMENT_DAYS = 400;

export interface DisplaySegment {
  /** Identity of the occurrence this segment belongs to, not of the segment. */
  key: string;
  event: TimedCalendarEvent;
  /** Date key in the display timezone. */
  dateKey: string;
  /** Minutes from local midnight; `0` at midnight, up to `1440` for 24:00. */
  startMinutes: number;
  endMinutes: number;
  /** This segment continues an occurrence that began on an earlier day. */
  isContinuation: boolean;
  /** The occurrence carries on past local midnight into the following day. */
  continuesNextDay: boolean;
}

export class DisplaySegmentRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DisplaySegmentRangeError';
  }
}

/**
 * Cuts one timed occurrence into the days it visibly occupies.
 *
 * All-day events are deliberately not handled here: their placement already
 * comes from `startDate`/`endDate` and DP-064 does not change it.
 */
export function eventDisplaySegments(
  event: TimedCalendarEvent,
  key: string,
  displayTimezone: string,
): DisplaySegment[] {
  const startDateKey = instantDateInZone(event.startsAt, displayTimezone);
  const startMinutes = minutesOfDay(instantTimeInZone(event.startsAt, displayTimezone));
  const rawEndDateKey = instantDateInZone(event.endsAt, displayTimezone);
  const rawEndMinutes = minutesOfDay(instantTimeInZone(event.endsAt, displayTimezone));

  // Ending exactly at midnight belongs to the day that just finished: 24:00 on
  // the first day, not 00:00 on a day the event never really occupies.
  const endsAtMidnight = rawEndMinutes === 0;
  const endDateKey = endsAtMidnight
    ? toDateKey(addDays(fromDateKey(rawEndDateKey), -1))
    : rawEndDateKey;
  const endMinutes = endsAtMidnight ? MINUTES_PER_DAY : rawEndMinutes;

  if (endDateKey < startDateKey) {
    // Only reachable from data that violates `ends_at > starts_at`.
    return [];
  }

  const segments: DisplaySegment[] = [];
  let dateKey = startDateKey;

  for (let day = 0; ; day += 1) {
    if (day >= MAX_SEGMENT_DAYS) {
      throw new DisplaySegmentRangeError(
        `event ${event.id} spans more than ${MAX_SEGMENT_DAYS} display days`,
      );
    }

    const isFirst = dateKey === startDateKey;
    const isLast = dateKey === endDateKey;
    segments.push({
      key,
      event,
      dateKey,
      startMinutes: isFirst ? startMinutes : 0,
      endMinutes: isLast ? endMinutes : MINUTES_PER_DAY,
      isContinuation: !isFirst,
      continuesNextDay: !isLast,
    });

    if (isLast) break;
    // Calendar-day arithmetic, not a fixed millisecond offset (§6, DP-063).
    dateKey = toDateKey(addDays(fromDateKey(dateKey), 1));
  }

  return segments;
}

/** The occurrences to test for conflict, paired with their identity. */
export interface ConflictCandidate {
  key: string;
  event: CalendarEvent;
}

/**
 * Half-open instant overlap. Touching endpoints do not conflict, and the
 * comparison is timezone-free because instants already are.
 */
export function occurrencesConflict(left: CalendarEvent, right: CalendarEvent): boolean {
  if (left.allDay || right.allDay) return false;
  const leftStart = Date.parse(left.startsAt);
  const leftEnd = Date.parse(left.endsAt);
  const rightStart = Date.parse(right.startsAt);
  const rightEnd = Date.parse(right.endsAt);
  return leftStart < rightEnd && rightStart < leftEnd;
}

/**
 * Keys of every occurrence that overlaps at least one other in the list.
 *
 * This replaces the two same-day clock-string implementations the views grew
 * independently (`MonthView.hasOverlap()` and `DayDetailSheet.overlappingIds()`),
 * both of which could never flag a cross-midnight event: they compared
 * `minutes(end) = 30` against `minutes(start) = 1380`.
 */
export function conflictingOccurrenceKeys(candidates: ConflictCandidate[]): Set<string> {
  const conflicting = new Set<string>();
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const left = candidates[i]!;
      const right = candidates[j]!;
      if (left.key === right.key) continue;
      if (occurrencesConflict(left.event, right.event)) {
        conflicting.add(left.key);
        conflicting.add(right.key);
      }
    }
  }
  return conflicting;
}

/** Counts occurrences, not segments: one cross-midnight event is one item. */
export function countOccurrences(items: { key: string }[]): number {
  return new Set(items.map((item) => item.key)).size;
}

export interface HourRange {
  startHour: number;
  endHour: number;
}

/** The原檔's fixed rail, kept as the narrowest range any week may show. */
export const BASELINE_HOUR_RANGE: HourRange = { startHour: 7, endHour: 22 };

/**
 * How many hours the week grid has to draw — DP-064.
 *
 * The rail was a fixed 07:00–22:00, and anything outside was clamped, which
 * drew a 23:00 event at the wrong time. The range now grows to whole hours
 * around the week's own segments, never shrinking below the baseline and never
 * leaving the day.
 */
export function hourRangeForSegments(segments: DisplaySegment[]): HourRange {
  let startHour = BASELINE_HOUR_RANGE.startHour;
  let endHour = BASELINE_HOUR_RANGE.endHour;

  for (const segment of segments) {
    startHour = Math.min(startHour, Math.floor(segment.startMinutes / 60));
    endHour = Math.max(endHour, Math.ceil(segment.endMinutes / 60));
  }

  return {
    startHour: Math.max(0, startHour),
    endHour: Math.min(24, endHour),
  };
}

function minutesOfDay(time: string): number {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return hour * 60 + minute;
}
