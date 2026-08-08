import type { SupabaseClient } from '@supabase/supabase-js';
import {
  calendarFromRow,
  calendarToInsert,
  eventExceptionFromRow,
  eventFromRow,
  eventToInsert,
  preferencesFromRow,
  stickerFromRow,
  stickerToInsert,
  todoFromRow,
  todoToInsert,
} from '../domain/databaseMapping';
import {
  applyCalendarPatch,
  applyEventPatch,
  calendarDeletionPlan,
  createCalendarFromInput,
  createEventFromInput,
  findCalendarById,
  withCalendar,
  withoutCalendar,
  type CalendarPatch,
  type NewCalendarInput,
  createStickerFromInput,
  createTodoFromInput,
  findEvent,
  findTodo,
  toggleTodoCompletion,
  withEvent,
  withoutEvent,
  withoutSticker,
  withoutTodo,
  withSticker,
  withTodo,
  type EventPatch,
  type NewEventInput,
  type NewStickerInput,
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

  async addSticker(input: NewStickerInput): Promise<DayPopUserData> {
    const data = this.#requireSnapshot();
    const draft = createStickerFromInput(data, input, {
      id: createDomainId(),
      now: new Date().toISOString(),
    });
    const { data: row, error } = await this.client
      .from('stickers')
      .upsert(stickerToInsert(draft, this.userId))
      .select('*')
      .single();
    if (error || !row) throw new RemoteDataError('寫入貼圖', error);
    return this.#commit(withSticker(data, stickerFromRow(row)));
  }

  async deleteSticker(id: string): Promise<DayPopUserData> {
    const data = this.#requireSnapshot();
    await this.#delete('stickers', id);
    return this.#commit(withoutSticker(data, id));
  }

  async addCalendar(input: NewCalendarInput): Promise<DayPopUserData> {
    const data = this.#requireSnapshot();
    const draft = createCalendarFromInput(data, input, {
      id: createDomainId(),
      now: new Date().toISOString(),
    });
    return this.#commit(withCalendar(data, await this.#upsertCalendar(draft)));
  }

  async updateCalendar(id: string, patch: CalendarPatch): Promise<DayPopUserData> {
    const data = this.#requireSnapshot();
    const calendar = findCalendarById(data, id);
    if (!calendar) return data;
    const draft = applyCalendarPatch(calendar, patch, new Date().toISOString());
    return this.#commit(withCalendar(data, await this.#upsertCalendar(draft)));
  }

  async deleteCalendar(id: string): Promise<DayPopUserData> {
    const data = this.#requireSnapshot();
    const plan = calendarDeletionPlan(data, id);
    // Refused (last calendar, or unknown id) — nothing reaches the server.
    if (!plan) return data;

    // Child rows move first. The composite foreign key would reject the delete
    // while anything still points at this calendar, so the order is required,
    // not just tidy.
    for (const table of ['events', 'todos', 'stickers'] as const) {
      const { error } = await this.client
        .from(table)
        .update({ calendar_id: plan.target.id })
        .eq('calendar_id', id)
        .eq('owner_id', this.userId);
      if (error) throw new RemoteDataError(`搬移 ${table}`, error);
    }

    if (plan.promote) {
      const { error } = await this.client
        .from('calendars')
        .update({ is_default: true })
        .eq('id', plan.target.id)
        .eq('owner_id', this.userId);
      if (error) throw new RemoteDataError('指定預設日曆', error);
    }

    await this.#delete('calendars', id);
    return this.#commit(withoutCalendar(data, id, new Date().toISOString()));
  }

  async #upsertCalendar(calendar: Parameters<typeof calendarToInsert>[0]) {
    const { data, error } = await this.client
      .from('calendars')
      .upsert(calendarToInsert(calendar, this.userId))
      .select('*')
      .single();
    if (error || !data) throw new RemoteDataError('寫入日曆', error);
    return calendarFromRow(data);
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

  async #delete(table: 'events' | 'todos' | 'stickers' | 'calendars', id: string) {
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
