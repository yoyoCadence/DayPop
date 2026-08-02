import { describe, expect, it } from 'vitest';
import {
  buildOverviewGroups,
  overviewLabel,
  overviewRange,
  stepOverviewCursor,
  type BuildOverviewInput,
} from './overview';
import type { CalendarEvent, TodoItem } from './types';

const CURSOR = new Date(2026, 7, 6); // Thursday 2026-08-06

function event(id: string, date: string, start: string, allDay = false): CalendarEvent {
  return {
    id,
    title: `事件${id}`,
    date,
    allDay,
    start,
    end: start,
    createdAt: '',
    updatedAt: '',
  };
}

function todo(id: string, date: string, done = false): TodoItem {
  return { id, title: `待辦${id}`, date, done, createdAt: '', updatedAt: '' };
}

function input(overrides: Partial<BuildOverviewInput> = {}): BuildOverviewInput {
  return {
    events: [],
    todos: [],
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

  it('returns nothing for stickers until the model exists', () => {
    expect(buildOverviewGroups(input({ type: 'stickers' }))).toEqual([]);
  });

  it('ignores data outside the selected period', () => {
    const groups = buildOverviewGroups(
      input({ period: 'week', events: [event('a', '2026-08-20', '09:00')] }),
    );
    expect(groups).toEqual([]);
  });
});
