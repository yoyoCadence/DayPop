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

/** The visibility half of the原檔's `dayEvents()`, without the date filter. */
export function visibleEvents(data: DayPopUserData): CalendarEvent[] {
  const visible = visibleCalendarIds(data.calendars);
  return data.events.filter((event) => visible.has(event.calendarId));
}

/** Calendars in the order the settings list and the filter chips show them. */
export function sortedCalendars(calendars: Calendar[]): Calendar[] {
  return [...calendars].sort((left, right) => left.sortOrder - right.sortOrder);
}
