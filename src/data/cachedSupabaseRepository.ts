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
import type { ImportCommand } from '../domain/dataTransfer';
import type { DayPopUserData, EventOccurrence, TodoPriority, SharingScope } from '../domain/types';
import type { SharingVersions, SharingWriteOptions } from './calendarSharing';
import type { Database } from '../lib/database.types';
import {
  getAppStorage,
  type StorageLike,
} from '../storage/browserStorage';
import { readAccountCache, writeAccountCache } from '../storage/accountCache';
import type { DayPopRepository, EventAttachmentRepository } from './repository';
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
export class CachedSupabaseDayPopRepository
  implements DayPopRepository, EventAttachmentRepository
{
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

  async updateEvent(id: string, patch: EventPatch, options?: SharingWriteOptions): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.updateEvent(id, patch, options));
  }

  async deleteEvent(id: string, options?: SharingWriteOptions): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.deleteEvent(id,options));
  }

  // DP-082. Delegated like every other write, so the cache is only ever
  // written from a document the remote adapter confirmed — a partially applied
  // occurrence write throws before it reaches `#persist()`.
  async cancelEventOccurrence(
    eventId: string,
    occurrence: EventOccurrence,
    options?: SharingWriteOptions,
  ): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.cancelEventOccurrence(eventId, occurrence,options));
  }

  async replaceEventOccurrence(
    eventId: string,
    occurrence: EventOccurrence,
    patch: EventPatch,
    options?: SharingWriteOptions,
  ): Promise<DayPopUserData> {
    return this.#persist(
      await this.#remote.replaceEventOccurrence(eventId, occurrence, patch, options),
    );
  }

  async uploadEventAttachment(eventId: string, file: File): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.uploadEventAttachment(eventId, file));
  }

  async deleteEventAttachment(id: string): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.deleteEventAttachment(id));
  }

  createEventAttachmentUrl(id: string): Promise<string> {
    return this.#remote.createEventAttachmentUrl(id);
  }

  async addTodo(input: NewTodoInput): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.addTodo(input));
  }

  async toggleTodo(id: string): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.toggleTodo(id));
  }

  async renameTodo(id: string, title: string): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.renameTodo(id, title));
  }

  async setTodoPriority(id: string, priority: TodoPriority): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.setTodoPriority(id, priority));
  }

  async rescheduleTodo(id: string, date: string): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.rescheduleTodo(id, date));
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

  async deleteCalendar(id: string, options?: SharingWriteOptions): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.deleteCalendar(id, options));
  }

  async updatePreferences(patch: PreferencesPatch): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.updatePreferences(patch));
  }

  /**
   * DP-056. The cache is only written from what the remote returns, never
   * from the command or a locally applied document: if the RPC fails, the
   * cached snapshot has to stay exactly as it was.
   */
  async importData(command: ImportCommand): Promise<DayPopUserData> {
    return this.#persist(await this.#remote.importData(command));
  }

  #persist(data: DayPopUserData): DayPopUserData {
    const personal = this.#remote.personalData();
    if (JSON.stringify(personal) === JSON.stringify(this.#cachedData)) return structuredClone(data);
    const envelope = writeAccountCache(this.userId, personal, this.storage);
    this.#cachedData = structuredClone(envelope.data);
    return structuredClone(data);
  }

  personalData(): DayPopUserData { return this.#remote.personalData(); }
  sharingSession() { return this.#remote.sharingSession(); }
  clearReceived() { return this.#remote.clearReceived(); }
  captureSharingVersions() { return this.#remote.captureSharingVersions(); }
  withSharingVersions(versions: SharingVersions, operation: () => Promise<DayPopUserData>) {
    return this.#remote.withSharingVersions(versions,operation);
  }
  async setCalendarShare(id: string, permission: 'view'|'edit'|null) {
    return this.#persist(await this.#remote.setCalendarShare(id,permission));
  }
  async setTodoSharingScope(id: string,scope: SharingScope) {
    return this.#persist(await this.#remote.setTodoSharingScope(id,scope));
  }
}
