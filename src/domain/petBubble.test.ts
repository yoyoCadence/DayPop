import { describe, expect, it } from 'vitest';
import { petBubbleTodos, petGreeting } from './petBubble';
import type { TodoItem, TodoPriority } from './types';

const TODAY = '2026-10-17';
let next = 0;

function todo(
  title: string,
  dueDate: string | null,
  options: { done?: boolean; priority?: TodoPriority; parentId?: string; sortOrder?: number; id?: string } = {},
): TodoItem {
  next += 1;
  return {
    id: options.id ?? `16900000-0000-4000-8000-${String(next).padStart(12, '0')}`,
    calendarId: 'calendar',
    parentId: options.parentId ?? null,
    title,
    dueDate,
    priority: options.priority ?? 'none',
    completedAt: options.done ? '2026-10-17T01:00:00.000Z' : null,
    sortOrder: options.sortOrder ?? next,
    sharingScope: 'inherit',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

const titles = (rows: TodoItem[]) => rows.map((row) => row.title);

describe('petBubbleTodos (DP-169)', () => {
  it('lists today done or not, earlier only while open, and tomorrow done or not', () => {
    const rows = [
      todo('今天未完成', TODAY),
      todo('今天已完成', TODAY, { done: true }),
      todo('昨天未完成', '2026-10-16'),
      todo('昨天已完成', '2026-10-16', { done: true }),
      todo('明天未完成', '2026-10-18'),
      todo('明天已完成', '2026-10-18', { done: true }),
      todo('後天', '2026-10-19'),
      todo('沒有日期', null),
    ];
    const lists = petBubbleTodos(rows, TODAY);
    expect(titles(lists.today)).toEqual(['昨天未完成', '今天未完成', '今天已完成']);
    expect(titles(lists.tomorrow)).toEqual(['明天未完成', '明天已完成']);
    expect(lists.tomorrowKey).toBe('2026-10-18');
  });

  it('counts what the badge counts: open and due today or earlier, and how many are 高', () => {
    const rows = [
      todo('重要', TODAY, { priority: 'high' }),
      todo('逾期重要', '2026-10-01', { priority: 'high' }),
      todo('普通', TODAY, { priority: 'medium' }),
      todo('完成的重要', TODAY, { priority: 'high', done: true }),
      todo('明天的重要', '2026-10-18', { priority: 'high' }),
    ];
    expect(petBubbleTodos(rows, TODAY)).toMatchObject({ open: 3, important: 2 });
    expect(petBubbleTodos([], TODAY)).toMatchObject({ open: 0, important: 0 });
  });

  it('puts overdue rows first, oldest first, then each day in its saved order', () => {
    const rows = [
      todo('今天第二', TODAY, { sortOrder: 9 }),
      todo('上週', '2026-10-10', { sortOrder: 20 }),
      todo('今天第一', TODAY, { sortOrder: 3 }),
      todo('昨天', '2026-10-16', { sortOrder: 1 }),
    ];
    expect(titles(petBubbleTodos(rows, TODAY).today)).toEqual(['上週', '昨天', '今天第一', '今天第二']);
  });

  it('leaves out subtasks drawn under their parent, but keeps one whose parent is on another day', () => {
    const parent = todo('父待辦', TODAY, { id: 'parent' });
    const rows = [
      parent,
      todo('同一天的子項', TODAY, { parentId: 'parent' }),
      todo('改到明天的子項', '2026-10-18', { parentId: 'parent' }),
    ];
    const lists = petBubbleTodos(rows, TODAY);
    expect(titles(lists.today)).toEqual(['父待辦']);
    expect(titles(lists.tomorrow)).toEqual(['改到明天的子項']);
    expect(lists.open).toBe(1);
  });

  it('crosses a month and a year to find tomorrow', () => {
    const lists = petBubbleTodos([todo('元旦', '2027-01-01')], '2026-12-31');
    expect(lists.tomorrowKey).toBe('2027-01-01');
    expect(titles(lists.tomorrow)).toEqual(['元旦']);
  });

  it('finds tomorrow across both daylight-saving changes, whatever zone the device is in', () => {
    // Date keys carry no zone; run under TZ=America/New_York these are the
    // nights its clocks move.
    expect(petBubbleTodos([], '2026-03-08').tomorrowKey).toBe('2026-03-09');
    expect(petBubbleTodos([], '2026-11-01').tomorrowKey).toBe('2026-11-02');
  });

  it('does not reorder the todos it was given', () => {
    const rows = [todo('B', TODAY, { sortOrder: 2 }), todo('A', TODAY, { sortOrder: 1 })];
    const before = structuredClone(rows);
    petBubbleTodos(rows, TODAY);
    expect(rows).toEqual(before);
  });
});

describe('petGreeting (DP-169)', () => {
  it('says how many are left and how many are important, as the原檔 does', () => {
    expect(petGreeting('摩卡', 3, 1)).toBe('嗨，我是摩卡！今天還有 3 件待辦，其中 1 件重要，要一起看看嗎？');
    expect(petGreeting('摩卡', 2, 0)).toBe('嗨，我是摩卡！今天還有 2 件待辦，要一起看看嗎？');
  });

  it('asks about tomorrow once today is clear', () => {
    expect(petGreeting('可可', 0, 0)).toBe('嗨，我是可可！今天的待辦都清光啦，要看看明天的安排嗎？');
  });
});
