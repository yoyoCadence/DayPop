import { eventWallTime, timedEventFromWallTime } from '../domain/eventTime';
import {
  createDomainId,
  type CalendarEvent,
  type DayPopUserData,
  type TodoItem,
} from '../domain/types';
import { parseDayPopUserData } from '../domain/validation';
import { getAppStorage, type StorageLike } from './browserStorage';
import { readUserData, writeUserData, type StorageReadResult } from './versionedStorage';

/**
 * Fired on `window` when a write was refused mid-session, so the app can swap
 * in the recovery screen without every screen having to plumb the error up.
 */
export const LOCAL_DATA_BLOCKED_EVENT = 'daypop:local-data-blocked';

/**
 * Thrown when the stored data could not be read and a write was attempted
 * anyway. The UI must resolve the problem (export, then reset) before editing.
 */
export class LocalDataBlockedError extends Error {
  constructor(readonly result: Exclude<StorageReadResult, { status: 'ready' }>) {
    super(
      result.status === 'future'
        ? '這份 DayPop 資料來自較新的版本，請先更新 App。'
        : '這台裝置上的 DayPop 資料無法讀取，請先備份再決定如何處理。',
    );
    this.name = 'LocalDataBlockedError';
  }
}

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

export class LocalDayPopRepository {
  readonly #injected: StorageLike | undefined;

  /** Defaults to the shared app store; pass one only in tests. */
  constructor(storage?: StorageLike) {
    this.#injected = storage;
  }

  /**
   * Resolved per operation rather than captured in the constructor: the shared
   * store can degrade to memory mid-session (DP-017), and a repository holding
   * the old delegate would keep writing into a store that refuses writes.
   */
  get #storage(): StorageLike {
    return this.#injected ?? getAppStorage();
  }

  /** Raw read result, so callers can show recovery instead of editing. */
  read(): StorageReadResult {
    return readUserData(this.#storage);
  }

  load(): DayPopUserData {
    const result = readUserData(this.#storage);
    if (result.status !== 'ready') throw new LocalDataBlockedError(result);
    return structuredClone(result.envelope.data);
  }

  addEvent(input: NewEventInput): DayPopUserData {
    const now = new Date().toISOString();
    return this.#mutate((data) => {
      const event = createEvent(data, input, createDomainId(), now);
      return { ...data, events: [...data.events, event] };
    });
  }

  updateEvent(id: string, patch: EventPatch): DayPopUserData {
    const now = new Date().toISOString();
    return this.#mutate((data) => ({
      ...data,
      events: data.events.map((event) =>
        event.id === id ? patchEvent(event, patch, data.preferences.timezone, now) : event,
      ),
    }));
  }

  deleteEvent(id: string): DayPopUserData {
    return this.#mutate((data) => ({
      ...data,
      events: data.events.filter((event) => event.id !== id),
    }));
  }

  addTodo(input: NewTodoInput): DayPopUserData {
    const now = new Date().toISOString();
    return this.#mutate((data) => {
      const todo: TodoItem = {
        id: createDomainId(),
        calendarId: input.calendarId ?? defaultCalendarId(data),
        parentId: null,
        title: input.title.trim(),
        dueDate: input.date,
        priority: 'none',
        completedAt: null,
        sortOrder: data.todos.length,
        sharingScope: 'inherit',
        createdAt: now,
        updatedAt: now,
      };
      return { ...data, todos: [...data.todos, todo] };
    });
  }

  deleteTodo(id: string): DayPopUserData {
    return this.#mutate((data) => ({
      ...data,
      todos: data.todos.filter((todo) => todo.id !== id),
    }));
  }

  toggleTodo(id: string): DayPopUserData {
    const now = new Date().toISOString();
    return this.#mutate((data) => ({
      ...data,
      todos: data.todos.map((todo) =>
        todo.id === id
          ? { ...todo, completedAt: todo.completedAt === null ? now : null, updatedAt: now }
          : todo,
      ),
    }));
  }

  #mutate(update: (data: DayPopUserData) => DayPopUserData): DayPopUserData {
    // Re-read before every write. If the stored bytes became unreadable — or
    // were written by a newer schema — refuse rather than overwrite them with
    // whatever this session happens to hold.
    const current = readUserData(this.#storage);
    if (current.status !== 'ready') throw new LocalDataBlockedError(current);

    const next = parseDayPopUserData(update(structuredClone(current.envelope.data)));
    writeUserData(next, current.envelope.revision, this.#storage);
    return structuredClone(next);
  }
}

function createEvent(
  data: DayPopUserData,
  input: NewEventInput,
  id: string,
  now: string,
): CalendarEvent {
  const common = {
    id,
    calendarId: input.calendarId ?? defaultCalendarId(data),
    title: input.title.trim(),
    location: null,
    notes: null,
    reminderMinutes: [],
    recurrence: null,
    sharingScope: 'inherit' as const,
    createdAt: now,
    updatedAt: now,
  };
  return input.allDay
    ? { ...common, allDay: true, startDate: input.date, endDate: input.date }
    : timedEventFromWallTime(
        common,
        { date: input.date, start: input.start, end: input.end },
        data.preferences.timezone,
      );
}

function patchEvent(
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
    event.allDay ? defaultTimezone : event.timezone,
  );
}

function defaultCalendarId(data: DayPopUserData): string {
  const calendar = data.calendars.find((candidate) => candidate.isDefault) ?? data.calendars[0];
  if (!calendar) throw new Error('DayPop 資料缺少預設日曆。');
  return calendar.id;
}
