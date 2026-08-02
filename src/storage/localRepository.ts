import type { CalendarEvent, DayPopUserData, TodoItem } from '../domain/types';
import { readUserData, writeUserData, type StorageLike } from './versionedStorage';

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

  load(): DayPopUserData {
    return structuredClone(readUserData(this.#storage).data);
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
    const current = readUserData(this.#storage);
    const next = update(structuredClone(current.data));
    writeUserData(next, current.revision, this.#storage);
    return structuredClone(next);
  }
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `daypop-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
