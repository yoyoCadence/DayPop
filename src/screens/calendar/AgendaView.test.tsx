import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, fromDateKey, toDateKey } from '../../domain/date';
import { timedEventFromWallTime } from '../../domain/eventTime';
import {
  resolveEventOccurrences,
  type OccurrenceWindow,
} from '../../domain/recurrence';
import type { CalendarEvent, TodoItem } from '../../domain/types';
import { AgendaView } from './AgendaView';
/**
 * Stands in for the screen's `resolveOccurrences` — DP-081. Visibility
 * filtering happens upstream in production, so this expands the given events
 * exactly as the real pipeline does.
 */
function occurrenceResolver(events: CalendarEvent[]) {
  return (window: OccurrenceWindow) =>
    resolveEventOccurrences({ events, eventExceptions: [] }, window);
}

/**
 * 列表檢視 showed nothing on the second day of a cross-midnight event while the
 * month cell for that day said 「續」 — DP-064.
 *
 * The look-ahead always starts from today, so the fixtures are built relative to
 * it rather than pinned to a date the window would have scrolled past.
 */

const ZONE = 'Asia/Taipei';
const CALENDAR = '33333333-3333-4333-8333-333333333333';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function overnightOn(dateKey: string): CalendarEvent {
  return timedEventFromWallTime(
    {
      id: 'overnight',
      calendarId: CALENDAR,
      title: '夜班',
      location: null,
      notes: null,
      reminderMinutes: [],
      recurrence: null,
      sharingScope: 'inherit' as const,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    { date: dateKey, start: '23:00', end: '00:30' },
    ZONE,
  );
}

function render(events: CalendarEvent[], todayKey: string) {
  act(() =>
    root.render(
      <AgendaView
        resolveOccurrences={occurrenceResolver(events)}
        displayTimezone={ZONE}
        todayKey={todayKey}
        todos={[]}
        calendars={[]}
        onOpenEvent={vi.fn()}
        onToggleTodo={vi.fn()}
      />,
    ),
  );
}

/** Every day card, as `label → row texts`. */
function dayRows(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const day of container.querySelectorAll('.cal-agenda-day')) {
    const label = day.querySelector('.cal-agenda-date')?.textContent?.trim() ?? '?';
    result[label] = (day.textContent ?? '').replace(/\s+/g, ' ').trim();
  }
  return result;
}

describe('AgendaView all-day spans (DP-126)', () => {
  it('lists a trip already in progress through its inclusive last day', () => {
    const travel: CalendarEvent = {
      id: 'travel', calendarId: CALENDAR, title: '三天旅行', location: null, notes: null,
      reminderMinutes: [], recurrence: null, sharingScope: 'inherit',
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
      allDay: true, startDate: '2026-08-05', endDate: '2026-08-07',
    };
    render([travel], '2026-08-06');
    const cards = [...container.querySelectorAll('.cal-agenda-day')];
    expect(cards[0]?.textContent).toContain('續 全天三天旅行');
    expect(cards[1]?.textContent).toContain('續 全天三天旅行');
    expect(cards).toHaveLength(2);
  });
});

describe('AgendaView cross-midnight events', () => {
  it('lists the second day as a continuation, not as empty', () => {
    const todayKey = toDateKey(new Date());
    const tomorrow = toDateKey(addDays(fromDateKey(todayKey), 1));

    render([overnightOn(todayKey)], todayKey);

    const rows = dayRows();
    const labels = Object.keys(rows);
    const first = rows[labels[0]!] ?? '';
    const second = rows[labels[1]!] ?? '';

    expect(first).toContain('23:00');
    expect(first).toContain('夜班');
    // Before DP-064 this row read 「沒有安排」.
    expect(second).toContain('夜班');
    expect(second).toContain('續');
    expect(second).not.toContain('沒有安排');
    expect(tomorrow > todayKey).toBe(true);
  });

  it('leaves a day the event does not touch empty', () => {
    const todayKey = toDateKey(new Date());

    render([overnightOn(todayKey)], todayKey);

    const rows = dayRows();
    const labels = Object.keys(rows);
    // Today and tomorrow always render; the third card only appears when it has
    // something on it, so an untouched day means no further cards.
    expect(labels.length).toBe(2);
  });
});

describe('AgendaView todos (DP-121)', () => {
  function todo(id: string, title: string, dueDate: string, parentId: string | null = null): TodoItem {
    return {
      id, calendarId: CALENDAR, parentId, title, dueDate, priority: 'none', completedAt: null, sortOrder: 0,
      sharingScope: 'inherit', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    };
  }

  it('lists a parent once and leaves its subtasks to the day sheet', () => {
    const todayKey = toDateKey(new Date());
    const tomorrow = toDateKey(addDays(fromDateKey(todayKey), 1));
    const todos = [
      todo('p', '準備旅行', todayKey),
      todo('s1', '訂車票', todayKey, 'p'),
      todo('s2', '換外幣', todayKey, 'p'),
      todo('other', '買牛奶', todayKey),
      // An imported subtask due on another day is its own card there.
      todo('moved', '取回護照', tomorrow, 'p'),
    ];
    act(() =>
      root.render(
        <AgendaView
          resolveOccurrences={occurrenceResolver([])}
          displayTimezone={ZONE}
          todayKey={todayKey}
          todos={todos}
          calendars={[]}
          onOpenEvent={vi.fn()}
          onToggleTodo={vi.fn()}
        />,
      ),
    );

    const titles = [...container.querySelectorAll('.cal-agenda-item')].map((row) => row.textContent ?? '');
    expect(titles.filter((text) => text.includes('準備旅行'))).toHaveLength(1);
    expect(titles.some((text) => text.includes('訂車票') || text.includes('換外幣'))).toBe(false);
    expect(titles.some((text) => text.includes('買牛奶'))).toBe(true);
    expect(titles.some((text) => text.includes('取回護照'))).toBe(true);
  });
});
