import { fromDateKey } from './date';
import type { CalendarEvent, TodoItem } from './types';

/**
 * Search over events and todos, ported from the `searchResults` block of
 * `日曆桌寵 Calendar Pet.dc.html`.
 *
 * The原檔 matches an event's title, location and notes; DayPop's domain has
 * only a title so far (location and notes arrive with DP-012). Todos are matched
 * on title in both.
 */

export interface SearchResult {
  kind: 'event' | 'todo';
  id: string;
  title: string;
  /** Secondary line: time for events, 待辦 · date (· 已完成) for todos. */
  sub: string;
}

export function searchEntries(
  query: string,
  events: CalendarEvent[],
  todos: TodoItem[],
): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const results: SearchResult[] = [];

  for (const event of events) {
    if (!event.title.toLowerCase().includes(needle)) continue;
    results.push({
      kind: 'event',
      id: event.id,
      title: event.title,
      sub: `${event.allDay ? '全天' : event.start} · ${formatDate(event.date)}`,
    });
  }

  for (const todo of todos) {
    if (!todo.title.toLowerCase().includes(needle)) continue;
    results.push({
      kind: 'todo',
      id: todo.id,
      title: todo.title,
      sub: `待辦 · ${formatDate(todo.date)}${todo.done ? ' · 已完成' : ''}`,
    });
  }

  return results;
}

function formatDate(dateKey: string): string {
  const date = fromDateKey(dateKey);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
