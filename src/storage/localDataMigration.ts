import { createDomainId, createEmptyUserData, type DayPopUserData } from '../domain/types';
import { isDateKey, isIsoInstant, parseDayPopUserData } from '../domain/validation';

export interface V1UserData {
  events: V1CalendarEvent[];
  todos: V1TodoItem[];
  preferences: V1UserPreferences;
}

interface V1CalendarEvent {
  id: string;
  title: string;
  date: string;
  allDay: boolean;
  start: string;
  end: string;
  createdAt: string;
  updatedAt: string;
}

interface V1TodoItem {
  id: string;
  title: string;
  date: string;
  done: boolean;
  createdAt: string;
  updatedAt: string;
}

interface V1UserPreferences {
  weekStartsOn: 0 | 1;
  theme: 'system' | 'light' | 'dark';
  petName: string;
}

const DEFAULT_TIMEZONE = 'Asia/Taipei';

export function isV1UserData(value: unknown): value is V1UserData {
  if (!isRecord(value) || !Array.isArray(value.events) || !Array.isArray(value.todos)) {
    return false;
  }
  if (!isRecord(value.preferences)) return false;
  return (
    value.events.every(isV1Event) &&
    value.todos.every(isV1Todo) &&
    (value.preferences.weekStartsOn === 0 || value.preferences.weekStartsOn === 1) &&
    ['system', 'light', 'dark'].includes(String(value.preferences.theme)) &&
    isTrimmedText(value.preferences.petName)
  );
}

export function migrateV1UserData(value: V1UserData, migratedAt: string): DayPopUserData {
  const next = createEmptyUserData({ now: migratedAt });
  const calendarId = next.calendars[0]!.id;
  next.preferences = {
    ...next.preferences,
    weekStartsOn: value.preferences.weekStartsOn,
    theme: value.preferences.theme,
    petName: value.preferences.petName,
  };
  next.events = value.events.map((event) => {
    const common = {
      id: createDomainId(),
      calendarId,
      title: event.title,
      location: null,
      notes: null,
      reminderMinutes: [],
      recurrence: null,
      sharingScope: 'inherit' as const,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };
    if (event.allDay) {
      return { ...common, allDay: true as const, startDate: event.date, endDate: event.date };
    }

    const startsAt = taipeiWallTimeToInstant(event.date, event.start);
    let endsAt = taipeiWallTimeToInstant(event.date, event.end);
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      endsAt = new Date(Date.parse(endsAt) + 24 * 60 * 60 * 1000).toISOString();
    }
    return {
      ...common,
      allDay: false as const,
      startsAt,
      endsAt,
      timezone: DEFAULT_TIMEZONE,
    };
  });
  next.todos = value.todos.map((todo, index) => ({
    id: createDomainId(),
    calendarId,
    parentId: null,
    title: todo.title,
    dueDate: todo.date,
    priority: 'none',
    completedAt: todo.done ? todo.updatedAt : null,
    sortOrder: index,
    sharingScope: 'inherit',
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
  }));
  return parseDayPopUserData(next);
}

function isV1Event(value: unknown): value is V1CalendarEvent {
  return (
    isRecord(value) &&
    isTrimmedText(value.id) &&
    isTrimmedText(value.title) &&
    isDateKey(value.date) &&
    typeof value.allDay === 'boolean' &&
    isTime(value.start) &&
    isTime(value.end) &&
    isIsoInstant(value.createdAt) &&
    isIsoInstant(value.updatedAt)
  );
}

function isV1Todo(value: unknown): value is V1TodoItem {
  return (
    isRecord(value) &&
    isTrimmedText(value.id) &&
    isTrimmedText(value.title) &&
    isDateKey(value.date) &&
    typeof value.done === 'boolean' &&
    isIsoInstant(value.createdAt) &&
    isIsoInstant(value.updatedAt)
  );
}

function taipeiWallTimeToInstant(date: string, time: string): string {
  return new Date(`${date}T${time}:00+08:00`).toISOString();
}

function isTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(':').map(Number);
  return hour! >= 0 && hour! <= 23 && minute! >= 0 && minute! <= 59;
}

function isTrimmedText(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.trim() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
