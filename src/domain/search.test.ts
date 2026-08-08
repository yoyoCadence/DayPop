import { describe, expect, it } from 'vitest';
import { timedEventFromWallTime } from './eventTime';
import { searchEntries } from './search';
import type { CalendarEvent, TodoItem } from './types';

const EVENTS: CalendarEvent[] = [
  timedEventFromWallTime(
    {
    id: 'e1',
    calendarId: 'calendar-1',
    title: '客戶簡報',
    location: null,
    notes: null,
    reminderMinutes: [],
    recurrence: null,
    sharingScope: 'inherit',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    },
    { date: '2026-08-06', start: '14:00', end: '15:00' },
    'Asia/Taipei',
  ),
  {
    id: 'e2',
    calendarId: 'calendar-1',
    title: '生日',
    allDay: true,
    startDate: '2026-08-09',
    endDate: '2026-08-09',
    location: null,
    notes: null,
    reminderMinutes: [],
    recurrence: null,
    sharingScope: 'inherit',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
];

const TODOS: TodoItem[] = [
  todo('t1', '客戶報銷', '2026-08-07', false),
  todo('t2', '整理照片', '2026-08-08', true),
];

function todo(id: string, title: string, dueDate: string, done: boolean): TodoItem {
  return {
    id,
    calendarId: 'calendar-1',
    parentId: null,
    title,
    dueDate,
    priority: 'none',
    completedAt: done ? '2026-08-01T00:00:00.000Z' : null,
    sortOrder: 0,
    sharingScope: 'inherit',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

describe('searchEntries', () => {
  it('returns nothing for an empty query', () => {
    expect(searchEntries('', EVENTS, TODOS)).toEqual([]);
    expect(searchEntries('   ', EVENTS, TODOS)).toEqual([]);
  });

  it('matches events and todos on title', () => {
    const results = searchEntries('客戶', EVENTS, TODOS);
    expect(results.map((result) => result.id)).toEqual(['e1', 't1']);
  });

  it('describes an event by its time and date', () => {
    expect(searchEntries('客戶簡報', EVENTS, TODOS)[0]?.sub).toBe('14:00 · 8月6日');
    expect(searchEntries('生日', EVENTS, TODOS)[0]?.sub).toBe('全天 · 8月9日');
  });

  it('matches an event by its location and by its notes, as the原檔 does', () => {
    const events: CalendarEvent[] = [
      { ...EVENTS[0]!, location: '會議室A', notes: '記得帶合約' },
    ];

    expect(searchEntries('會議室', events, []).map((result) => result.id)).toEqual(['e1']);
    expect(searchEntries('合約', events, []).map((result) => result.id)).toEqual(['e1']);
  });

  it('says where a location match came from', () => {
    const events: CalendarEvent[] = [{ ...EVENTS[0]!, location: '會議室A' }];

    expect(searchEntries('會議室', events, [])[0]?.sub).toBe('14:00 · 會議室A · 8月6日');
  });

  it('does not match a todo on anything but its title', () => {
    // A todo has neither field, so nothing else may be invented for it.
    expect(searchEntries('會議室', [], TODOS)).toEqual([]);
  });

  it('carries the day a todo result opens, and omits it when there is none', () => {
    const undated = { ...todo('t3', '有空再做', '2026-08-08', false), dueDate: null };

    expect(searchEntries('報銷', [], TODOS)[0]?.dueDate).toBe('2026-08-07');
    expect(searchEntries('有空', [], [undated])[0]?.dueDate).toBeUndefined();
    expect(searchEntries('有空', [], [undated])[0]?.sub).toBe('待辦 · 無到期日');
  });

  it('marks completed todos', () => {
    expect(searchEntries('照片', EVENTS, TODOS)[0]?.sub).toBe('待辦 · 8月8日 · 已完成');
    expect(searchEntries('報銷', EVENTS, TODOS)[0]?.sub).toBe('待辦 · 8月7日');
  });

  it('is case-insensitive', () => {
    const events: CalendarEvent[] = [{ ...EVENTS[0]!, title: 'Sprint Review' }];
    expect(searchEntries('sprint', events, [])).toHaveLength(1);
    expect(searchEntries('REVIEW', events, [])).toHaveLength(1);
  });

  it('finds nothing when the query matches neither', () => {
    expect(searchEntries('不存在', EVENTS, TODOS)).toEqual([]);
  });
});
