import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CalendarPatch,
  EventPatch,
  NewCalendarInput,
  NewEventInput,
  NewStickerInput,
  NewTodoInput,
  PreferencesPatch,
} from '../domain/mutations';
import type { DayPopUserData } from '../domain/types';
import type { Database } from '../lib/database.types';
import {
  getAppStorage,
  type StorageLike,
} from '../storage/browserStorage';
import { readAccountCache, writeAccountCache } from '../storage/accountCache';
import type { DayPopRepository } from './repository';
import { RemoteDataError, SupabaseDayPopRepository } from './supabaseRepository';

/**
 * Signals that remote load failed but a validated cache exists for this exact
 * account. DataProvider renders the cached document with a persistent warning
 * instead of turning the network failure into an empty calendar.
 */
export class CachedRemoteLoadError extends Error {
  readonly cachedData: DayPopUserData;

  constructor(cachedData: DayPopUserData, cause: RemoteDataError) {
    super('目前無法連上雲端，正在顯示這台裝置最後一次同步的帳號資料。');
    this.name = 'CachedRemoteLoadError';
    this.cachedData = structuredClone(cachedData);
    this.cause = cause;
  }
}

/**
 * Adds an account-scoped, versioned device cache around the remote adapter.
 *
 * The cache is written only after a confirmed remote load or mutation. It is
 * never uploaded as a document and never shared with guest storage, so a
 * cached fallback cannot overwrite Supabase or leak across accounts.
 */
export class CachedSupabaseDayPopRepository implements DayPopRepository {
  readonly #remote: SupabaseDayPopRepository;
  #cachedData: DayPopUserData | null;

  constructor(
    client: SupabaseClient<Database>,
    private readonly userId: string,
    private readonly storage: StorageLike = getAppStorage(),
  ) {
    const cached = readAccountCache(userId, storage);
    this.#cachedData =
      cached.status === 'ready' ? structuredClone(cached.envelope.data) : null;
    this.#remote = new SupabaseDayPopRepository(client, userId, this.#cachedData ?? undefined);
  }

  async load(): Promise<DayPopUserData> {
    try {
      return this.#persist(await this.#remote.load());
    } catch (cause) {
      // Missing bootstrap rows and invalid domain data are not connectivity
      // failures and must never be hidden behind an old cache.
      if (cause instanceof RemoteDataError && this.#cachedData) {
        throw new CachedRemoteLoadError(this.#cachedData, cause);
      }
      throw cause;
    }
  }

  async addEvent(input: NewEventInput): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.addEvent(input));
  }

  async updateEvent(id: string, patch: EventPatch): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.updateEvent(id, patch));
  }

  async deleteEvent(id: string): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.deleteEvent(id));
  }

  async addTodo(input: NewTodoInput): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.addTodo(input));
  }

  async toggleTodo(id: string): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.toggleTodo(id));
  }

  async deleteTodo(id: string): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.deleteTodo(id));
  }

  async addSticker(input: NewStickerInput): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.addSticker(input));
  }

  async deleteSticker(id: string): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.deleteSticker(id));
  }

  async addCalendar(input: NewCalendarInput): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.addCalendar(input));
  }

  async updateCalendar(id: string, patch: CalendarPatch): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.updateCalendar(id, patch));
  }

  async deleteCalendar(id: string): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.deleteCalendar(id));
  }

  async updatePreferences(patch: PreferencesPatch): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.updatePreferences(patch));
  }

  #persist(data: DayPopUserData): DayPopUserData {
    const envelope = writeAccountCache(this.userId, data, this.storage);
    this.#cachedData = structuredClone(envelope.data);
    return structuredClone(envelope.data);
  }
}
