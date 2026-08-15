import { describe, expect, it } from 'vitest';
import { timedEventFromWallTime } from './eventTime';
import {
  buildOverviewGroups,
  countOverviewOccurrences,
  overviewLabel,
  overviewRange,
  stepOverviewCursor,
  type BuildOverviewInput,
} from './overview';
import type { CalendarEvent, Sticker, TodoItem } from './types';

const CURSOR = new Date(2026, 7, 6); // Thursday 2026-08-06

function event(id: string, date: string, start: string, allDay = false): CalendarEvent {
  const common = {
    id,
    calendarId: 'calendar-1',
    title: `事件${id}`,
    location: null,
    notes: null,
    reminderMinutes: [],
    recurrence: null,
    sharingScope: 'inherit' as const,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
  // `end: start` would not be a zero-length event: `timedEventFromWallTime()`
  // reads an end at or before the start as running into the next day, so these
  // fixtures were silently 24 hours long. Harmless while placement used only
  // `startsAt`; once DP-064 cut events into display segments they showed up on
  // two days. One hour is what they were always meant to be.
  const [hour = 0, minute = 0] = start.split(':').map(Number);
  const end = `${String((hour + 1) % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return allDay
    ? { ...common, allDay: true, startDate: date, endDate: date }
    : timedEventFromWallTime(common, { date, start, end }, 'Asia/Taipei');
}

function todo(id: string, date: string, done = false): TodoItem {
  return {
    id,
    calendarId: 'calendar-1',
    parentId: null,
    title: `待辦${id}`,
    dueDate: date,
    priority: 'none',
    completedAt: done ? '2026-08-01T00:00:00.000Z' : null,
    sortOrder: 0,
    sharingScope: 'inherit',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function sticker(id: string, date: string, glyph: string): Sticker {
  return {
    id,
    calendarId: 'calendar-1',
    date,
    glyph,
    assetKey: null,
    sortOrder: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

/**
 * DP-064. Overview groups by the display timezone, exactly as the calendar
 * places cells. When these disagreed, one event showed a different date in 綜覽
 * than it did in 日曆.
 */
describe('display timezone', () => {
  // 20:00 on the 6th in New York is 08:00 on the 7th in Taipei.
  const crossZone: CalendarEvent = {
    id: 'e-zone',
    calendarId: 'calendar-1',
    title: '跨時區',
    location: null,
    notes: null,
    reminderMinutes: [],
    recurrence: null,
    sharingScope: 'inherit',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    allDay: false,
    startsAt: '2026-08-07T00:00:00.000Z',
    endsAt: '2026-08-07T01:00:00.000Z',
    timezone: 'America/New_York',
  };

  function dayOf(displayTimezone: string) {
    const groups = buildOverviewGroups(
      input({ events: [crossZone], displayTimezone, cursor: new Date(2026, 7, 1) }),
    );
    return groups
      .flatMap((group) => group.days)
      .filter((day) => day.items.some((item) => item.id === 'e-zone'))
      .map((day) => ({ dateKey: day.dateKey, time: day.items[0]?.time }));
  }

  it('groups by the display zone, not the event’s own', () => {
    expect(dayOf('Asia/Taipei')).toEqual([{ dateKey: '2026-08-07', time: '08:00' }]);
    expect(dayOf('America/New_York')).toEqual([{ dateKey: '2026-08-06', time: '20:00' }]);
  });
});

/**
 * DP-064. A cross-midnight event occupies both days, so it is listed on both —
 * but 「共 N 筆」 counts occurrences, so it is still one.
 */
describe('cross-midnight events', () => {
  const overnight = timedEventFromWallTime(
    {
      id: 'overnight',
      calendarId: 'calendar-1',
      title: '夜班',
      location: null,
      notes: null,
      reminderMinutes: [],
      recurrence: null,
      sharingScope: 'inherit' as const,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    { date: '2026-08-06', start: '23:00', end: '00:30' },
    'Asia/Taipei',
  );

  it('appears on both days, the second marked as a continuation', () => {
    const groups = buildOverviewGroups(input({ events: [overnight] }));
    const rows = groups.flatMap((group) =>
      group.days.map((day) => ({ dateKey: day.dateKey, time: day.items[0]?.time })),
    );

    expect(rows).toEqual([
      { dateKey: '2026-08-06', time: '23:00' },
      { dateKey: '2026-08-07', time: '續' },
    ]);
  });

  it('counts as one occurrence, not two rows', () => {
    const groups = buildOverviewGroups(input({ period: 'year', events: [overnight] }));
    const august = groups.find((group) => group.title === '8月');

    // Two day rows, one event.
    expect(august?.days).toHaveLength(2);
    expect(august?.count).toBe(1);
  });

  it('counts as one across the whole period, not once per day group', () => {
    // Outside the year view each day is its own group, so summing group counts
    // reported the same event twice — what 綜覽 actually showed before this.
    const groups = buildOverviewGroups(input({ events: [overnight] }));

    expect(groups).toHaveLength(2);
    expect(groups.reduce((sum, group) => sum + group.count, 0)).toBe(2);
    expect(countOverviewOccurrences(groups)).toBe(1);
  });

  it('still counts two different events on the same day as two', () => {
    const groups = buildOverviewGroups(
      input({ events: [overnight, event('b', '2026-08-06', '09:00')] }),
    );
    const sixth = groups.find((group) => group.key === '2026-08-06');

    expect(sixth?.count).toBe(2);
  });
});

function input(overrides: Partial<BuildOverviewInput> = {}): BuildOverviewInput {
  return {
    events: [],
    todos: [],
    stickers: [],
    // The fixtures are built in Taipei; grouping reads the same zone (DP-064).
    displayTimezone: 'Asia/Taipei',
    type: 'events',
    period: 'month',
    cursor: CURSOR,
    weekStartsOn: 0,
    todayKey: '2026-08-06',
    ...overrides,
  };
}

describe('overviewRange', () => {
  it('covers the whole week, month or year', () => {
    const week = overviewRange(CURSOR, 'week', 0);
    expect(week.start.getDate()).toBe(2); // Sunday
    expect(week.end.getDate()).toBe(8);

    const month = overviewRange(CURSOR, 'month', 0);
    expect(month.start.getDate()).toBe(1);
    expect(month.end.getDate()).toBe(31);

    const year = overviewRange(CURSOR, 'year', 0);
    expect(year.start.getMonth()).toBe(0);
    expect(year.end.getMonth()).toBe(11);
    expect(year.end.getDate()).toBe(31);
  });

  it('follows the week start preference', () => {
    expect(overviewRange(CURSOR, 'week', 1).start.getDate()).toBe(3); // Monday
  });
});

describe('overviewLabel', () => {
  it('formats each period as the原檔 does', () => {
    expect(overviewLabel(CURSOR, 'week', 0)).toBe('8/2 – 8/8');
    expect(overviewLabel(CURSOR, 'month', 0)).toBe('2026年 8月');
    expect(overviewLabel(CURSOR, 'year', 0)).toBe('2026年');
  });
});

describe('stepOverviewCursor', () => {
  it('moves by one whole period', () => {
    expect(stepOverviewCursor(CURSOR, 'week', 1).getDate()).toBe(13);
    expect(stepOverviewCursor(CURSOR, 'week', -1).getDate()).toBe(30);
    expect(stepOverviewCursor(CURSOR, 'month', 1).getMonth()).toBe(8);
    expect(stepOverviewCursor(CURSOR, 'month', -1).getMonth()).toBe(6);
    expect(stepOverviewCursor(CURSOR, 'year', 1).getFullYear()).toBe(2027);
  });

  it('does not roll a month step into the next month on day 31', () => {
    // 2026-08-31 + 1 month must be September, not October.
    expect(stepOverviewCursor(new Date(2026, 7, 31), 'month', 1).getMonth()).toBe(8);
  });
});

describe('buildOverviewGroups', () => {
  it('drops days with nothing on them', () => {
    const groups = buildOverviewGroups(
      input({ events: [event('a', '2026-08-06', '09:00')] }),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: '2026-08-06', title: '8/6', sub: '週四', count: 1 });
  });

  it('groups a year by month and labels the days inside', () => {
    const groups = buildOverviewGroups(
      input({
        period: 'year',
        events: [event('a', '2026-03-02', '09:00'), event('b', '2026-08-06', '10:00')],
      }),
    );
    expect(groups.map((group) => group.title)).toEqual(['3月', '8月']);
    expect(groups[0]?.labelDays).toBe(true);
    expect(groups[0]?.days[0]?.dayLabel).toBe('2日 週一');
  });

  it('puts all-day events first and sorts the rest by start', () => {
    const groups = buildOverviewGroups(
      input({
        events: [
          event('late', '2026-08-06', '15:00'),
          event('early', '2026-08-06', '09:00'),
          event('allday', '2026-08-06', '09:00', true),
        ],
      }),
    );
    expect(groups[0]?.days[0]?.items.map((item) => item.time)).toEqual(['全天', '09:00', '15:00']);
  });

  it('marks overdue todos and shows completion', () => {
    const groups = buildOverviewGroups(
      input({ type: 'todos', todos: [todo('a', '2026-08-03'), todo('b', '2026-08-04', true)] }),
    );
    const items = groups.flatMap((group) => group.days.flatMap((day) => day.items));
    expect(items[0]).toMatchObject({ time: '待辦', sub: '逾期・原8/3', done: false });
    expect(items[1]).toMatchObject({ time: '完成', sub: '', done: true });
  });

  it('lists stickers with their glyph and no time column', () => {
    const groups = buildOverviewGroups(
      input({
        type: 'stickers',
        stickers: [sticker('a', '2026-08-03', '🎂'), sticker('b', '2026-08-03', '✈️')],
      }),
    );

    const items = groups.flatMap((group) => group.days.flatMap((day) => day.items));
    expect(items).toEqual([
      { kind: 'sticker', id: 'a', time: '', title: '貼圖', sub: '', done: false, glyph: '🎂' },
      { kind: 'sticker', id: 'b', time: '', title: '貼圖', sub: '', done: false, glyph: '✈️' },
    ]);
    expect(groups[0]?.count).toBe(2);
  });

  it('counts stickers alongside the other types across a year', () => {
    const groups = buildOverviewGroups(
      input({
        type: 'stickers',
        period: 'year',
        stickers: [sticker('a', '2026-02-14', '❤️'), sticker('b', '2026-08-03', '🎂')],
      }),
    );

    expect(groups.map((group) => group.title)).toEqual(['2月', '8月']);
  });

  it('ignores data outside the selected period', () => {
    const groups = buildOverviewGroups(
      input({ period: 'week', events: [event('a', '2026-08-20', '09:00')] }),
    );
    expect(groups).toEqual([]);
  });
});
