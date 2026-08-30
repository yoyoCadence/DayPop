import { addDays, fromDateKey, toDateKey } from './date';

/**
 * Days a local date can differ between two zones for the same instant.
 *
 * IANA offsets span UTC−12 … UTC+14, which is 26 hours, so two zones can read
 * the same instant as dates two apart. Anything less silently drops the far
 * edge of a window — see `visibleOccurrences()`.
 */
const ZONE_SPREAD_DAYS = 2;
import { instantDateInZone } from './eventTime';
import {
  resolveEventOccurrences,
  type OccurrenceWindow,
  type ResolvedEventOccurrence,
} from './recurrence';
import type { Calendar, CalendarEvent, DayPopUserData } from './types';

/**
 * Calendar lookups shared by every view, ported from `calById()`,
 * `dayEvents()` and `_calPalette()` in `日曆桌寵 Calendar Pet.dc.html`.
 *
 * Hiding a calendar is a display filter, never a delete: the events stay in
 * storage and come back the moment the calendar is shown again.
 */

/** `_calPalette()`, verbatim and in order — the swatches in the edit dialog. */
export const CALENDAR_PALETTE = [
  '#e4002b',
  '#f97316',
  '#ca8a04',
  '#16a34a',
  '#0891b2',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#0f766e',
  '#64748b',
] as const;

/**
 * Foreground for text drawn on a calendar colour. The原檔 stores a per-calendar
 * `text` and sets every one of them to white, so white is the canonical value
 * rather than a simplification.
 */
export const CALENDAR_TEXT_COLOR = '#ffffff';

/** The原檔 offers the next palette entry when creating a calendar. */
export function nextCalendarColor(existingCount: number): string {
  return CALENDAR_PALETTE[existingCount % CALENDAR_PALETTE.length]!;
}

/** Swatches for the edit dialog, keeping a custom colour visible at the front. */
export function calendarSwatches(current: string | null): string[] {
  const palette = [...CALENDAR_PALETTE];
  if (current && !palette.includes(current as (typeof CALENDAR_PALETTE)[number])) {
    return [current, ...palette];
  }
  return palette;
}

export function findCalendar(
  calendars: Calendar[],
  id: string | null | undefined,
): Calendar | undefined {
  return calendars.find((calendar) => calendar.id === id);
}

/** Falls back to the原檔's grey for an event whose calendar has vanished. */
export function calendarColor(calendars: Calendar[], id: string): string {
  return findCalendar(calendars, id)?.color ?? '#888888';
}

export function visibleCalendarIds(calendars: Calendar[]): Set<string> {
  return new Set(calendars.filter((calendar) => calendar.isVisible).map((calendar) => calendar.id));
}

/**
 * The visibility half of the原檔's `dayEvents()`, without the date filter.
 *
 * Returns **base** events, one row per series. Use it where a recurring event
 * should count once — 搜尋 is the case DayPop keeps that way on purpose. Every
 * view that draws events on days wants `visibleOccurrences()` instead, or a
 * weekly event is drawn only on its first date (DP-081).
 */
export function visibleEvents(data: DayPopUserData): CalendarEvent[] {
  const visible = visibleCalendarIds(data.calendars);
  return data.events.filter((event) => visible.has(event.calendarId));
}

/**
 * Every occurrence a view drawing `window` in `displayTimezone` can show — DP-081.
 *
 * `resolveEventOccurrences()` hands back a **materialised** `CalendarEvent` per
 * occurrence: the base event with that occurrence's own instants, so everything
 * downstream (segments, conflicts, time labels) keeps working unchanged. What
 * callers must carry alongside it is `key`, which is the only thing that tells
 * two occurrences of one series apart.
 *
 * **`window` is in display date keys, the resolver's is not.** The resolver
 * reads its window in each event's *own* timezone (`eventOverlapsWindow()`),
 * so handing it a display-zone window drops occurrences at the edges: a daily
 * 00:30 Asia/Tokyo event asked for the LA day 2026-08-01 expanded only Tokyo
 * 08-01, which is 07-31 in LA, and the LA day came back empty. Expansion is
 * therefore padded, and the result clipped back in the display zone.
 *
 * The pad is **two** days, not one. IANA offsets run from UTC−12 to UTC+14, a
 * spread of 26 hours, so one instant can carry two different local dates that
 * differ by two: Pacific/Pago_Pago 2026-08-01 23:30 is 2026-08-03 00:30 in
 * Pacific/Kiritimati. A one-day pad covered Tokyo↔LA and missed that pair.
 *
 * The window is required rather than optional: an unbounded expansion of a
 * `FREQ=DAILY` rule with no UNTIL has no natural end. Each view passes the
 * range it actually draws.
 *
 * Visibility is applied **after** expansion so that an exception whose
 * replacement lives on another calendar still resolves correctly.
 *
 * **Never throws.** Views call this during render, so an unexpandable rule
 * must not take the screen down — see `expandSafely()`.
 */
export function visibleOccurrences(
  data: DayPopUserData,
  window: OccurrenceWindow,
  displayTimezone: string,
): ResolvedEventOccurrence[] {
  const visible = visibleCalendarIds(data.calendars);
  const padded = {
    startDate: toDateKey(addDays(fromDateKey(window.startDate), -ZONE_SPREAD_DAYS)),
    endDate: toDateKey(addDays(fromDateKey(window.endDate), ZONE_SPREAD_DAYS)),
  };
  return expandSafely(data, padded).filter(
    (resolved) =>
      visible.has(resolved.event.calendarId) &&
      overlapsDisplayWindow(resolved.event, window, displayTimezone),
  );
}

/** The occupied day range read in the zone the grid is actually drawn in. */
function overlapsDisplayWindow(
  event: CalendarEvent,
  window: OccurrenceWindow,
  displayTimezone: string,
): boolean {
  const start = event.allDay
    ? event.startDate
    : instantDateInZone(event.startsAt, displayTimezone);
  const end = event.allDay ? event.endDate : instantDateInZone(event.endsAt, displayTimezone);
  return start <= window.endDate && end >= window.startDate;
}

/**
 * `resolveEventOccurrences()`, retried series by series so one bad rule cannot
 * blank the App.
 *
 * A rule that generates more than the resolver's cap throws. That is the right
 * answer for a domain call, but these views resolve **during render**: an
 * uncaught throw there unmounts the whole tree and leaves a white screen with
 * one console error. The .ics boundary refuses rules it cannot expand, so new
 * data cannot get into that state; this guard is for a document that already
 * holds one.
 *
 * **The retry keeps each series whole.** Re-expanding bare events would drop
 * every exception: a cancelled occurrence would come back, and a replacement
 * row would be drawn both as itself and as the occurrence it replaces. So each
 * base event is retried together with its own exceptions and the replacement
 * events those exceptions point at — the same unit `resolveEventOccurrences()`
 * reasons about — and replacement rows are not expanded again on their own.
 *
 * Only the series that actually fails degrades, and it degrades to its start
 * occurrence rather than disappearing, so the user can still open and delete
 * the row that is misbehaving.
 */
function expandSafely(
  data: DayPopUserData,
  window: OccurrenceWindow,
): ResolvedEventOccurrence[] {
  try {
    return resolveEventOccurrences(data, window);
  } catch {
    const byId = new Map(data.events.map((event) => [event.id, event]));
    const replacementIds = new Set(
      data.eventExceptions
        .map((exception) => exception.replacementEventId)
        .filter((id): id is string => id !== null),
    );

    const resolved: ResolvedEventOccurrence[] = [];
    for (const event of data.events) {
      // Pulled in below by the series that replaces one of its occurrences.
      if (replacementIds.has(event.id)) continue;

      const exceptions = data.eventExceptions.filter(
        (exception) => exception.eventId === event.id,
      );
      const replacements = exceptions
        .map((exception) => exception.replacementEventId)
        .filter((id): id is string => id !== null)
        .map((id) => byId.get(id))
        .filter((row): row is CalendarEvent => row !== undefined);
      const series = { events: [event, ...replacements], eventExceptions: exceptions };

      try {
        resolved.push(...resolveEventOccurrences(series, window));
      } catch {
        // Draw the series start alone. Losing the repeats is visible and
        // recoverable; losing the calendar is not.
        resolved.push(
          ...resolveEventOccurrences(
            { events: [{ ...event, recurrence: null }], eventExceptions: [] },
            window,
          ),
        );
      }
    }
    return resolved;
  }
}

/** Calendars in the order the settings list and the filter chips show them. */
export function sortedCalendars(calendars: Calendar[]): Calendar[] {
  return [...calendars].sort((left, right) => left.sortOrder - right.sortOrder);
}
