import { sortedCalendars } from './calendars';
import { eventWallTime, timedEventFromWallTime } from './eventTime';
import type { Calendar, CalendarEvent, DayPopUserData, Sticker, TodoItem } from './types';

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
  location?: string;
  notes?: string;
}

export interface NewTodoInput {
  title: string;
  date: string;
  calendarId?: string;
}

export interface NewStickerInput {
  date: string;
  /** Emoji today; `assetKey` stays open for a future art set. */
  glyph: string;
  calendarId?: string;
}

/** Fields the week grid and the event sheet are allowed to change. */
export interface EventPatch {
  title?: string;
  date?: string;
  allDay?: boolean;
  start?: string;
  end?: string;
  calendarId?: string;
  /** Empty string clears the field, since the domain stores `null`. */
  location?: string;
  notes?: string;
}

export interface NewCalendarInput {
  name: string;
  color: string;
}

/** Fields the 我的日曆 list and the edit dialog can change. */
export interface CalendarPatch {
  name?: string;
  color?: string;
  isVisible?: boolean;
}

export interface CreateContext {
  /** Client-generated UUID for the new row. */
  id: string;
  /** ISO instant used for both `createdAt` and `updatedAt`. */
  now: string;
}

/** The原檔's fallback when the name field is left empty. */
export const UNNAMED_CALENDAR_NAME = '未命名日曆';

/** The domain stores an absent optional string as `null`, never as `''`. */
function optionalText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function createCalendarFromInput(
  data: DayPopUserData,
  input: NewCalendarInput,
  context: CreateContext,
): Calendar {
  return {
    id: context.id,
    name: input.name.trim() || UNNAMED_CALENDAR_NAME,
    color: input.color,
    isVisible: true,
    // Only the bootstrap calendar is the default; a new one never steals it.
    isDefault: false,
    sortOrder: data.calendars.length,
    createdAt: context.now,
    updatedAt: context.now,
  };
}

export function applyCalendarPatch(
  calendar: Calendar,
  patch: CalendarPatch,
  updatedAt: string,
): Calendar {
  return {
    ...calendar,
    name: patch.name === undefined ? calendar.name : patch.name.trim() || UNNAMED_CALENDAR_NAME,
    color: patch.color ?? calendar.color,
    isVisible: patch.isVisible ?? calendar.isVisible,
    updatedAt,
  };
}

export function findCalendarById(data: DayPopUserData, id: string): Calendar | undefined {
  return data.calendars.find((calendar) => calendar.id === id);
}

export function withCalendar(data: DayPopUserData, calendar: Calendar): DayPopUserData {
  const exists = data.calendars.some((candidate) => candidate.id === calendar.id);
  return {
    ...data,
    calendars: exists
      ? data.calendars.map((candidate) => (candidate.id === calendar.id ? calendar : candidate))
      : [...data.calendars, calendar],
  };
}

/**
 * Which calendar inherits the rows of one being deleted.
 *
 * The原檔 simply drops the calendar and leaves its events pointing at nothing.
 * DayPop cannot: the domain contract requires every event, todo and sticker to
 * reference a live calendar, and losing them would be data loss rather than a
 * display change. So the rows move to the surviving default, and if the
 * default itself is deleted the next calendar in order is promoted.
 */
export function calendarDeletionPlan(
  data: DayPopUserData,
  id: string,
): { target: Calendar; promote: boolean } | null {
  const doomed = findCalendarById(data, id);
  // The原檔 refuses to delete the last calendar; so does the domain contract,
  // which requires exactly one default to exist.
  if (!doomed || data.calendars.length <= 1) return null;

  const survivors = sortedCalendars(data.calendars.filter((calendar) => calendar.id !== id));
  const existingDefault = survivors.find((calendar) => calendar.isDefault);
  const target = existingDefault ?? survivors[0]!;
  return { target, promote: !existingDefault };
}

export function withoutCalendar(data: DayPopUserData, id: string, now: string): DayPopUserData {
  const plan = calendarDeletionPlan(data, id);
  if (!plan) return data;
  const { target, promote } = plan;

  const reassign = <T extends { calendarId: string; updatedAt: string }>(rows: T[]): T[] =>
    rows.map((row) =>
      row.calendarId === id ? { ...row, calendarId: target.id, updatedAt: now } : row,
    );

  return {
    ...data,
    calendars: data.calendars
      .filter((calendar) => calendar.id !== id)
      .map((calendar) =>
        promote && calendar.id === target.id
          ? { ...calendar, isDefault: true, updatedAt: now }
          : calendar,
      ),
    events: reassign(data.events),
    todos: reassign(data.todos),
    stickers: reassign(data.stickers),
  };
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
    location: optionalText(input.location),
    notes: optionalText(input.notes),
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
    calendarId: patch.calendarId ?? event.calendarId,
    title: patch.title?.trim() ?? event.title,
    location: patch.location === undefined ? event.location : optionalText(patch.location),
    notes: patch.notes === undefined ? event.notes : optionalText(patch.notes),
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

export function createStickerFromInput(
  data: DayPopUserData,
  input: NewStickerInput,
  context: CreateContext,
): Sticker {
  return {
    id: context.id,
    calendarId: input.calendarId ?? resolveDefaultCalendarId(data),
    date: input.date,
    glyph: input.glyph,
    // Reserved for the future art set; a glyph sticker never sets both.
    assetKey: null,
    // Per day rather than per document: the原檔 renders each day's stickers in
    // the order they were added, and a global counter would not survive a
    // sticker being deleted from another day.
    sortOrder: stickersOn(data, input.date).length,
    createdAt: context.now,
    updatedAt: context.now,
  };
}

/** The原檔's `stickersOn(ds)`, in stored order. */
export function stickersOn(data: DayPopUserData, dateKey: string): Sticker[] {
  return data.stickers.filter((sticker) => sticker.date === dateKey);
}

export function findEvent(data: DayPopUserData, id: string): CalendarEvent | undefined {
  return data.events.find((event) => event.id === id);
}

export function findTodo(data: DayPopUserData, id: string): TodoItem | undefined {
  return data.todos.find((todo) => todo.id === id);
}

export function findSticker(data: DayPopUserData, id: string): Sticker | undefined {
  return data.stickers.find((sticker) => sticker.id === id);
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

export function withSticker(data: DayPopUserData, sticker: Sticker): DayPopUserData {
  const exists = data.stickers.some((candidate) => candidate.id === sticker.id);
  return {
    ...data,
    stickers: exists
      ? data.stickers.map((candidate) => (candidate.id === sticker.id ? sticker : candidate))
      : [...data.stickers, sticker],
  };
}

export function withoutSticker(data: DayPopUserData, id: string): DayPopUserData {
  return { ...data, stickers: data.stickers.filter((sticker) => sticker.id !== id) };
}
