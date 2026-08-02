import type { CalendarEvent, DayPopUserData, TodoItem } from '../domain/types';
import {
  readUserData,
  writeUserData,
  type StorageLike,
  type StorageReadResult,
} from './versionedStorage';

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
}

export interface NewTodoInput {
  title: string;
  date: string;
}

/** Fields the week grid and the event sheet are allowed to change. */
export type EventPatch = Partial<Pick<CalendarEvent, 'title' | 'date' | 'allDay' | 'start' | 'end'>>;

export class LocalDayPopRepository {
  readonly #storage: StorageLike;

  constructor(storage: StorageLike = window.localStorage) {
    this.#storage = storage;
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
    const event: CalendarEvent = {
      id: createId(),
      title: input.title.trim(),
      date: input.date,
      allDay: input.allDay,
      start: input.start,
      end: input.end,
      createdAt: now,
      updatedAt: now,
    };
    return this.#mutate((data) => ({ ...data, events: [...data.events, event] }));
  }

  updateEvent(id: string, patch: EventPatch): DayPopUserData {
    const now = new Date().toISOString();
    return this.#mutate((data) => ({
      ...data,
      events: data.events.map((event) =>
        event.id === id ? { ...event, ...patch, updatedAt: now } : event,
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
    const todo: TodoItem = {
      id: createId(),
      title: input.title.trim(),
      date: input.date,
      done: false,
      createdAt: now,
      updatedAt: now,
    };
    return this.#mutate((data) => ({ ...data, todos: [...data.todos, todo] }));
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
        todo.id === id ? { ...todo, done: !todo.done, updatedAt: now } : todo,
      ),
    }));
  }

  #mutate(update: (data: DayPopUserData) => DayPopUserData): DayPopUserData {
    // Re-read before every write. If the stored bytes became unreadable — or
    // were written by a newer schema — refuse rather than overwrite them with
    // whatever this session happens to hold.
    const current = readUserData(this.#storage);
    if (current.status !== 'ready') throw new LocalDataBlockedError(current);

    const next = update(structuredClone(current.envelope.data));
    writeUserData(next, current.envelope.revision, this.#storage);
    return structuredClone(next);
  }
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `daypop-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
