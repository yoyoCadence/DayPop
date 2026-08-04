import { eventWallTime, timedEventFromWallTime } from './eventTime';
import type { CalendarEvent, DayPopUserData, TodoItem } from './types';

/**
 * Pure domain edits shared by every repository adapter.
 *
 * The guest adapter applies these to a whole local document; the authenticated
 * adapter applies the same functions to build the row it writes to Supabase.
 * Keeping them here is what makes the two adapters agree on defaults, trimming
 * and timestamps instead of each re-deriving them.
 *
 * Nothing in this module touches storage, the network or the clock — ids and
 * timestamps are passed in so both adapters and their tests stay deterministic.
 */

/** What the quick-add row and the event sheet collect for a new event. */
export interface NewEventInput {
  title: string;
  date: string;
  allDay: boolean;
  start: string;
  end: string;
  calendarId?: string;
}

export interface NewTodoInput {
  title: string;
  date: string;
  calendarId?: string;
}

/** Fields the week grid and the event sheet are allowed to change. */
export interface EventPatch {
  title?: string;
  date?: string;
  allDay?: boolean;
  start?: string;
  end?: string;
}

export interface CreateContext {
  /** Client-generated UUID for the new row. */
  id: string;
  /** ISO instant used for both `createdAt` and `updatedAt`. */
  now: string;
}

export function resolveDefaultCalendarId(data: DayPopUserData): string {
  const calendar = data.calendars.find((candidate) => candidate.isDefault) ?? data.calendars[0];
  if (!calendar) throw new Error('DayPop 資料缺少預設日曆。');
  return calendar.id;
}

export function createEventFromInput(
  data: DayPopUserData,
  input: NewEventInput,
  context: CreateContext,
): CalendarEvent {
  const common = {
    id: context.id,
    calendarId: input.calendarId ?? resolveDefaultCalendarId(data),
    title: input.title.trim(),
    location: null,
    notes: null,
    reminderMinutes: [],
    recurrence: null,
    sharingScope: 'inherit' as const,
    createdAt: context.now,
    updatedAt: context.now,
  };
  return input.allDay
    ? { ...common, allDay: true, startDate: input.date, endDate: input.date }
    : timedEventFromWallTime(
        common,
        { date: input.date, start: input.start, end: input.end },
        data.preferences.timezone,
      );
}

export function applyEventPatch(
  event: CalendarEvent,
  patch: EventPatch,
  defaultTimezone: string,
  updatedAt: string,
): CalendarEvent {
  const previous = eventWallTime(event);
  const allDay = patch.allDay ?? event.allDay;
  const common = {
    id: event.id,
    calendarId: event.calendarId,
    title: patch.title?.trim() ?? event.title,
    location: event.location,
    notes: event.notes,
    reminderMinutes: event.reminderMinutes,
    recurrence: event.recurrence,
    sharingScope: event.sharingScope,
    createdAt: event.createdAt,
    updatedAt,
  };
  const date = patch.date ?? previous.date;
  if (allDay) return { ...common, allDay: true, startDate: date, endDate: date };
  return timedEventFromWallTime(
    common,
    {
      date,
      start: (patch.start ?? previous.start) || '09:00',
      end: (patch.end ?? previous.end) || '10:00',
    },
    // An all-day event has no timezone of its own to keep.
    event.allDay ? defaultTimezone : event.timezone,
  );
}

export function createTodoFromInput(
  data: DayPopUserData,
  input: NewTodoInput,
  context: CreateContext,
): TodoItem {
  return {
    id: context.id,
    calendarId: input.calendarId ?? resolveDefaultCalendarId(data),
    parentId: null,
    title: input.title.trim(),
    dueDate: input.date,
    priority: 'none',
    completedAt: null,
    sortOrder: data.todos.length,
    sharingScope: 'inherit',
    createdAt: context.now,
    updatedAt: context.now,
  };
}

export function toggleTodoCompletion(todo: TodoItem, now: string): TodoItem {
  return { ...todo, completedAt: todo.completedAt === null ? now : null, updatedAt: now };
}

export function findEvent(data: DayPopUserData, id: string): CalendarEvent | undefined {
  return data.events.find((event) => event.id === id);
}

export function findTodo(data: DayPopUserData, id: string): TodoItem | undefined {
  return data.todos.find((todo) => todo.id === id);
}

/** Replaces the event with the same id, keeping its position, or appends it. */
export function withEvent(data: DayPopUserData, event: CalendarEvent): DayPopUserData {
  const exists = data.events.some((candidate) => candidate.id === event.id);
  return {
    ...data,
    events: exists
      ? data.events.map((candidate) => (candidate.id === event.id ? event : candidate))
      : [...data.events, event],
  };
}

export function withoutEvent(data: DayPopUserData, id: string): DayPopUserData {
  return { ...data, events: data.events.filter((event) => event.id !== id) };
}

export function withTodo(data: DayPopUserData, todo: TodoItem): DayPopUserData {
  const exists = data.todos.some((candidate) => candidate.id === todo.id);
  return {
    ...data,
    todos: exists
      ? data.todos.map((candidate) => (candidate.id === todo.id ? todo : candidate))
      : [...data.todos, todo],
  };
}

export function withoutTodo(data: DayPopUserData, id: string): DayPopUserData {
  return { ...data, todos: data.todos.filter((todo) => todo.id !== id) };
}
