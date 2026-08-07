import type { SupabaseClient } from '@supabase/supabase-js';
import {
  calendarFromRow,
  eventExceptionFromRow,
  eventFromRow,
  eventToInsert,
  preferencesFromRow,
  stickerFromRow,
  todoFromRow,
  todoToInsert,
} from '../domain/databaseMapping';
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
import {
  createDomainId,
  createEmptyUserData,
  type CalendarEvent,
  type DayPopUserData,
  type TodoItem,
} from '../domain/types';
import { parseDayPopUserData } from '../domain/validation';
import type { Database } from '../lib/database.types';
import type { DayPopRepository } from './repository';

/**
 * Thrown when Supabase itself refused or failed the request.
 *
 * Kept separate from `DomainValidationError` so the caller can tell "the
 * server said no" (RLS, offline, constraint) apart from "the row we received
 * does not match the domain contract".
 */
export class RemoteDataError extends Error {
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    super(`Supabase ${operation} 失敗：${describe(cause)}`);
    this.name = 'RemoteDataError';
    this.cause = cause;
  }
}

/**
 * Thrown when the account has no rows to build a valid document from.
 *
 * A brand-new account has no default calendar, and the domain contract
 * requires exactly one. Creating it here would be a second, competing
 * bootstrap path — DP-024 owns that, so this fails loudly instead.
 */
export class AccountNotBootstrappedError extends Error {
  constructor() {
    super('這個帳號尚未建立預設日曆，請先完成帳號初始化（DP-024）。');
    this.name = 'AccountNotBootstrappedError';
  }
}

/**
 * Authenticated adapter: the same contract as the guest adapter, backed by
 * Supabase rows instead of one local envelope.
 *
 * DP-013 builds and unit-tests this boundary against a stubbed client. It is
 * deliberately **not** wired into `DataProvider` yet — switching the live app
 * over to remote persistence, together with the device cache and transient
 * failure handling, is DP-026. Until then nothing here touches real accounts.
 *
 * Reads and writes rely on owner RLS rather than trusting this filter alone;
 * the explicit `owner_id` filter is there so a mis-scoped query fails as an
 * empty result instead of quietly reading another account's rows.
 */
export class SupabaseDayPopRepository implements DayPopRepository {
  #snapshot: DayPopUserData | null = null;

  constructor(
    private readonly client: SupabaseClient<Database>,
    private readonly userId: string,
  ) {}

  async load(): Promise<DayPopUserData> {
    const owner = this.userId;
    // Table names stay literal so the generated row types survive; a generic
    // helper over table names collapses them into an unusable union.
    const [calendars, events, exceptions, todos, stickers, preferences] = await Promise.all([
      this.client.from('calendars').select('*').eq('owner_id', owner),
      this.client.from('events').select('*').eq('owner_id', owner),
      this.client.from('event_exceptions').select('*').eq('owner_id', owner),
      this.client.from('todos').select('*').eq('owner_id', owner),
      this.client.from('stickers').select('*').eq('owner_id', owner),
      this.client.from('user_preferences').select('*').eq('user_id', owner).maybeSingle(),
    ]);

    const calendarRows = unwrap('讀取日曆', calendars);
    if (calendarRows.length === 0) throw new AccountNotBootstrappedError();
    if (preferences.error) throw new RemoteDataError('讀取偏好', preferences.error);

    return this.#commit({
      calendars: calendarRows.map(calendarFromRow),
      events: unwrap('讀取行程', events).map(eventFromRow),
      eventExceptions: unwrap('讀取例外', exceptions).map(eventExceptionFromRow),
      todos: unwrap('讀取待辦', todos).map(todoFromRow),
      stickers: unwrap('讀取貼圖', stickers).map(stickerFromRow),
      // A missing preferences row is expected until DP-024 creates one, and the
      // domain defaults are the values bootstrap will write, so reading is not
      // blocked by it.
      preferences: preferences.data
        ? preferencesFromRow(preferences.data)
        : createEmptyUserData().preferences,
    });
  }

  async addEvent(input: NewEventInput): Promise<DayPopUserData> {
    const data = this.#requireSnapshot();
    const draft = createEventFromInput(data, input, {
      id: createDomainId(),
      now: new Date().toISOString(),
    });
    return this.#commit(withEvent(data, await this.#upsertEvent(draft)));
  }

  async updateEvent(id: string, patch: EventPatch): Promise<DayPopUserData> {
    const data = this.#requireSnapshot();
    const event = findEvent(data, id);
    if (!event) return data;
    const draft = applyEventPatch(
      event,
      patch,
      data.preferences.timezone,
      new Date().toISOString(),
    );
    return this.#commit(withEvent(data, await this.#upsertEvent(draft)));
  }

  async deleteEvent(id: string): Promise<DayPopUserData> {
    const data = this.#requireSnapshot();
    await this.#delete('events', id);
    return this.#commit(withoutEvent(data, id));
  }

  async addTodo(input: NewTodoInput): Promise<DayPopUserData> {
    const data = this.#requireSnapshot();
    const draft = createTodoFromInput(data, input, {
      id: createDomainId(),
      now: new Date().toISOString(),
    });
    return this.#commit(withTodo(data, await this.#upsertTodo(draft)));
  }

  async toggleTodo(id: string): Promise<DayPopUserData> {
    const data = this.#requireSnapshot();
    const todo = findTodo(data, id);
    if (!todo) return data;
    const draft = toggleTodoCompletion(todo, new Date().toISOString());
    return this.#commit(withTodo(data, await this.#upsertTodo(draft)));
  }

  async deleteTodo(id: string): Promise<DayPopUserData> {
    const data = this.#requireSnapshot();
    await this.#delete('todos', id);
    return this.#commit(withoutTodo(data, id));
  }

  /**
   * Writes go back through `*FromRow`, so the snapshot holds what the database
   * actually stored — including the `created_at`/`updated_at` the client is
   * not allowed to set — rather than what this session hoped it would store.
   */
  async #upsertEvent(event: CalendarEvent) {
    const { data, error } = await this.client
      .from('events')
      .upsert(eventToInsert(event, this.userId))
      .select('*')
      .single();
    if (error || !data) throw new RemoteDataError('寫入行程', error);
    return eventFromRow(data);
  }

  async #upsertTodo(todo: TodoItem) {
    const { data, error } = await this.client
      .from('todos')
      .upsert(todoToInsert(todo, this.userId))
      .select('*')
      .single();
    if (error || !data) throw new RemoteDataError('寫入待辦', error);
    return todoFromRow(data);
  }

  async #delete(table: 'events' | 'todos', id: string) {
    const { error } = await this.client
      .from(table)
      .delete()
      .eq('id', id)
      .eq('owner_id', this.userId);
    if (error) throw new RemoteDataError(`刪除 ${table}`, error);
  }

  /** Validates the whole document before it becomes the snapshot the UI sees. */
  #commit(data: DayPopUserData): DayPopUserData {
    const valid = parseDayPopUserData(data);
    this.#snapshot = valid;
    return structuredClone(valid);
  }

  #requireSnapshot(): DayPopUserData {
    if (!this.#snapshot) throw new Error('請先呼叫 load() 再進行編輯。');
    return this.#snapshot;
  }
}

/** Turns a PostgREST `{ data, error }` pair into rows or a `RemoteDataError`. */
function unwrap<Row>(
  operation: string,
  result: { data: Row[] | null; error: unknown },
): Row[] {
  if (result.error) throw new RemoteDataError(operation, result.error);
  return result.data ?? [];
}

function describe(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'message' in cause) {
    return String((cause as { message: unknown }).message);
  }
  return cause === null || cause === undefined ? '沒有回傳資料' : String(cause);
}
