import { describe, expect, it } from 'vitest';
import { searchEntries } from './search';
import type { CalendarEvent, TodoItem } from './types';

const EVENTS: CalendarEvent[] = [
  {
    id: 'e1',
    title: '客戶簡報',
    date: '2026-08-06',
    allDay: false,
    start: '14:00',
    end: '15:00',
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'e2',
    title: '生日',
    date: '2026-08-09',
    allDay: true,
    start: '09:00',
    end: '10:00',
    createdAt: '',
    updatedAt: '',
  },
];

const TODOS: TodoItem[] = [
  { id: 't1', title: '客戶報銷', date: '2026-08-07', done: false, createdAt: '', updatedAt: '' },
  { id: 't2', title: '整理照片', date: '2026-08-08', done: true, createdAt: '', updatedAt: '' },
];

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
