import { addDays, fromDateKey, startOfDay, startOfWeek, toDateKey } from './date';
import { eventDate, eventStartTime } from './eventTime';
import type { CalendarEvent, Sticker, TodoItem } from './types';

/**
 * Grouping for the 綜覽 screen, ported from `overviewGroups()` and
 * `buildOverviewDisplay()` in `日曆桌寵 Calendar Pet.dc.html`.
 *
 * Year view groups by month; month and week views group by day. Days with
 * nothing on them are dropped, so the list is never padded with empty cards.
 */

export type OverviewType = 'events' | 'todos' | 'stickers';
export type OverviewPeriod = 'year' | 'month' | 'week';

export interface OverviewItem {
  kind: 'event' | 'todo' | 'sticker';
  id: string;
  /** Left column: 全天／HH:MM for events, 待辦／完成 for todos, empty for stickers. */
  time: string;
  title: string;
  /** Secondary line, currently only the overdue marker on todos. */
  sub: string;
  done: boolean;
  /** Stickers show their glyph where events and todos show a colour bar. */
  glyph?: string;
  /** Owning calendar, so an event bar takes that calendar's colour. */
  calendarId?: string;
}

export interface OverviewDay {
  dateKey: string;
  /** Only the year view labels individual days inside a group. */
  dayLabel: string;
  items: OverviewItem[];
}

export interface OverviewGroup {
  key: string;
  title: string;
  sub: string;
  count: number;
  /** True in year view, where one group spans a whole month. */
  labelDays: boolean;
  days: OverviewDay[];
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
/** Safety valve from the原檔: a year is at most 366 iterations. */
const MAX_DAYS = 400;

export function overviewRange(
  cursor: Date,
  period: OverviewPeriod,
  weekStartsOn: 0 | 1,
): { start: Date; end: Date } {
  if (period === 'week') {
    const start = startOfWeek(cursor, weekStartsOn);
    return { start, end: addDays(start, 6) };
  }
  if (period === 'month') {
    return {
      start: new Date(cursor.getFullYear(), cursor.getMonth(), 1),
      end: new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0),
    };
  }
  return {
    start: new Date(cursor.getFullYear(), 0, 1),
    end: new Date(cursor.getFullYear(), 11, 31),
  };
}

export function overviewLabel(
  cursor: Date,
  period: OverviewPeriod,
  weekStartsOn: 0 | 1,
): string {
  if (period === 'week') {
    const start = startOfWeek(cursor, weekStartsOn);
    const end = addDays(start, 6);
    return `${start.getMonth() + 1}/${start.getDate()} – ${end.getMonth() + 1}/${end.getDate()}`;
  }
  if (period === 'month') return `${cursor.getFullYear()}年 ${cursor.getMonth() + 1}月`;
  return `${cursor.getFullYear()}年`;
}

/** ‹ and › move by one whole period. */
export function stepOverviewCursor(
  cursor: Date,
  period: OverviewPeriod,
  direction: 1 | -1,
): Date {
  if (period === 'week') return addDays(cursor, direction * 7);
  if (period === 'month') {
    return new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
  }
  return new Date(cursor.getFullYear() + direction, cursor.getMonth(), 1);
}

export interface BuildOverviewInput {
  events: CalendarEvent[];
  todos: TodoItem[];
  stickers: Sticker[];
  type: OverviewType;
  period: OverviewPeriod;
  cursor: Date;
  weekStartsOn: 0 | 1;
  /** Today, for the overdue marker on todos. */
  todayKey: string;
}

export function buildOverviewGroups(input: BuildOverviewInput): OverviewGroup[] {
  const { start, end } = overviewRange(input.cursor, input.period, input.weekStartsOn);
  const lastKey = toDateKey(end);

  const perDay: { dateKey: string; date: Date; items: OverviewItem[] }[] = [];
  let cursor = startOfDay(start);
  for (let guard = 0; toDateKey(cursor) <= lastKey && guard < MAX_DAYS; guard += 1) {
    const dateKey = toDateKey(cursor);
    const items = collectItems(input, dateKey);
    if (items.length > 0) perDay.push({ dateKey, date: cursor, items });
    cursor = addDays(cursor, 1);
  }

  if (input.period === 'year') {
    const groups: OverviewGroup[] = [];
    for (let month = 0; month < 12; month += 1) {
      const days = perDay.filter((day) => day.date.getMonth() === month);
      if (days.length === 0) continue;
      groups.push({
        key: `${input.cursor.getFullYear()}-${month}`,
        title: `${month + 1}月`,
        sub: '',
        count: days.reduce((total, day) => total + day.items.length, 0),
        labelDays: true,
        days: days.map(toOverviewDay),
      });
    }
    return groups;
  }

  return perDay.map((day) => ({
    key: day.dateKey,
    title: `${day.date.getMonth() + 1}/${day.date.getDate()}`,
    sub: `週${WEEKDAY_LABELS[day.date.getDay()]}`,
    count: day.items.length,
    labelDays: false,
    days: [toOverviewDay(day)],
  }));
}

function toOverviewDay(day: { dateKey: string; date: Date; items: OverviewItem[] }): OverviewDay {
  return {
    dateKey: day.dateKey,
    dayLabel: `${day.date.getDate()}日 週${WEEKDAY_LABELS[day.date.getDay()]}`,
    items: day.items,
  };
}

function collectItems(input: BuildOverviewInput, dateKey: string): OverviewItem[] {
  if (input.type === 'events') {
    return input.events
      .filter((event) => eventDate(event) === dateKey)
      .sort((left, right) => {
        if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
        return eventStartTime(left).localeCompare(eventStartTime(right));
      })
      .map((event) => ({
        kind: 'event' as const,
        id: event.id,
        time: event.allDay ? '全天' : eventStartTime(event),
        title: event.title,
        sub: '',
        done: false,
        calendarId: event.calendarId,
      }));
  }

  if (input.type === 'todos') {
    return input.todos
      .filter((todo) => todo.dueDate === dateKey)
      .map((todo) => {
        const done = todo.completedAt !== null;
        const overdue = !done && todo.dueDate !== null && todo.dueDate < input.todayKey;
        const due = fromDateKey(todo.dueDate!);
        return {
          kind: 'todo' as const,
          id: todo.id,
          time: done ? '完成' : '待辦',
          title: todo.title,
          sub: overdue ? `逾期・原${due.getMonth() + 1}/${due.getDate()}` : '',
          done,
        };
      });
  }

  // The原檔 gives a sticker no time column and the literal title 貼圖; the
  // glyph itself stands in for the colour bar.
  return input.stickers
    .filter((sticker) => sticker.date === dateKey)
    .map((sticker) => ({
      kind: 'sticker' as const,
      id: sticker.id,
      time: '',
      title: '貼圖',
      sub: '',
      done: false,
      glyph: sticker.glyph ?? '',
    }));
}
