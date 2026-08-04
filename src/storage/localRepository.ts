import {
  applyEventPatch,
  createEventFromInput,
  createTodoFromInput,
  findEvent,
  findTodo,
  toggleTodoCompletion,
  withEvent,
  withoutEvent,
  withoutTodo,
  withTodo,
  type EventPatch,
  type NewEventInput,
  type NewTodoInput,
} from '../domain/mutations';
import { createDomainId, type DayPopUserData } from '../domain/types';
import { parseDayPopUserData } from '../domain/validation';
import type { DayPopRepository, SyncLoadCapable } from '../data/repository';
import { getAppStorage, type StorageLike } from './browserStorage';
import { readUserData, writeUserData, type StorageReadResult } from './versionedStorage';

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

/**
 * Guest adapter: the whole document lives in one versioned `localStorage`
 * envelope, so every edit is a read-modify-write of that envelope.
 *
 * The fail-closed guarantees from DP-016/017 live here rather than in the
 * shared contract because they are properties of browser storage: a remote
 * store has entirely different failure modes, handled by its own adapter.
 */
export class LocalDayPopRepository implements DayPopRepository, SyncLoadCapable {
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

  /**
   * Synchronous read for the first paint — see `SyncLoadCapable`. Throws
   * `LocalDataBlockedError` so the caller shows recovery instead of editing;
   * this replaces the old `read()`, whose raw result `App` used to inspect
   * before `DataProvider` owned that decision.
   */
  loadSync(): DayPopUserData {
    const result = readUserData(this.#storage);
    if (result.status !== 'ready') throw new LocalDataBlockedError(result);
    return structuredClone(result.envelope.data);
  }

  // `async` throughout: local work is synchronous, but the shared contract is
  // async for the remote adapter's sake, and `async` turns the fail-closed
  // throws below into rejections without any extra plumbing.
  async load(): Promise<DayPopUserData> {
    return this.loadSync();
  }

  addEvent(input: NewEventInput): Promise<DayPopUserData> {
    const now = new Date().toISOString();
    return this.#mutate((data) =>
      withEvent(data, createEventFromInput(data, input, { id: createDomainId(), now })),
    );
  }

  updateEvent(id: string, patch: EventPatch): Promise<DayPopUserData> {
    const now = new Date().toISOString();
    return this.#mutate((data) => {
      const event = findEvent(data, id);
      if (!event) return data;
      return withEvent(data, applyEventPatch(event, patch, data.preferences.timezone, now));
    });
  }

  deleteEvent(id: string): Promise<DayPopUserData> {
    return this.#mutate((data) => withoutEvent(data, id));
  }

  addTodo(input: NewTodoInput): Promise<DayPopUserData> {
    const now = new Date().toISOString();
    return this.#mutate((data) =>
      withTodo(data, createTodoFromInput(data, input, { id: createDomainId(), now })),
    );
  }

  deleteTodo(id: string): Promise<DayPopUserData> {
    return this.#mutate((data) => withoutTodo(data, id));
  }

  toggleTodo(id: string): Promise<DayPopUserData> {
    const now = new Date().toISOString();
    return this.#mutate((data) => {
      const todo = findTodo(data, id);
      if (!todo) return data;
      return withTodo(data, toggleTodoCompletion(todo, now));
    });
  }

  async #mutate(
    update: (data: DayPopUserData) => DayPopUserData,
  ): Promise<DayPopUserData> {
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
