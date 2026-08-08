import { fromDateKey } from './date';
import { eventDate, eventStartTime } from './eventTime';
import type { CalendarEvent, TodoItem } from './types';

/**
 * Search over events and todos, ported from the `searchResults` block of
 * `日曆桌寵 Calendar Pet.dc.html`.
 *
 * The原檔 builds one haystack per event out of title, location and notes, so an
 * event is found by where it is or by what was written about it — which is what
 * the field's own 「搜尋事件、地點、待辦…」 placeholder promises. DP-058 could
 * only match titles because DayPop had nowhere to store the other two; DP-060
 * added them, so the full haystack is restored here. Todos still match on title
 * alone, as in the原檔, because a todo has neither field.
 */

export interface SearchResult {
  kind: 'event' | 'todo';
  id: string;
  title: string;
  /** Secondary line: time for events, 待辦 · date (· 已完成) for todos. */
  sub: string;
  /** Owning calendar, for the result dot. Todos are not filtered by calendar. */
  calendarId?: string;
  /**
   * Day a todo result opens. Absent when the todo has no due date, which the
   * domain allows — the screen must then have nothing to navigate to rather
   * than send an empty date key on to the calendar.
   */
  dueDate?: string;
}

/**
 * `calendarFilter` is the原檔's `searchCal`: `null` means 全部. It applies to
 * events only, because a todo has no calendar in the原檔 and filtering DayPop's
 * todos by one would silently hide every todo whenever a non-default calendar
 * is picked.
 */
export function searchEntries(
  query: string,
  events: CalendarEvent[],
  todos: TodoItem[],
  calendarFilter: string | null = null,
): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const results: SearchResult[] = [];

  for (const event of events) {
    if (calendarFilter !== null && event.calendarId !== calendarFilter) continue;
    if (!eventHaystack(event).includes(needle)) continue;
    results.push({
      kind: 'event',
      id: event.id,
      title: event.title,
      // The原檔 puts the location between the time and the rest of the line, so
      // a result matched on its location says why it matched.
      sub: [
        event.allDay ? '全天' : eventStartTime(event),
        ...(event.location ? [event.location] : []),
        formatDate(eventDate(event)),
      ].join(' · '),
      calendarId: event.calendarId,
    });
  }

  for (const todo of todos) {
    if (!todo.title.toLowerCase().includes(needle)) continue;
    results.push({
      kind: 'todo',
      id: todo.id,
      title: todo.title,
      sub: `待辦 · ${todo.dueDate ? formatDate(todo.dueDate) : '無到期日'}${todo.completedAt ? ' · 已完成' : ''}`,
      ...(todo.dueDate ? { dueDate: todo.dueDate } : {}),
    });
  }

  return results;
}

/** `title + location + notes`, lowercased — the原檔's `hay`. */
function eventHaystack(event: CalendarEvent): string {
  return `${event.title} ${event.location ?? ''} ${event.notes ?? ''}`.toLowerCase();
}

function formatDate(dateKey: string): string {
  const date = fromDateKey(dateKey);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
