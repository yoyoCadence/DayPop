import type { SupabaseClient } from '@supabase/supabase-js';
import {
  calendarFromRow,
  calendarToInsert,
  eventAttachmentFromRow,
  eventAttachmentToInsert,
  eventExceptionFromRow,
  eventFromRow,
  eventToInsert,
  preferencesFromRow,
  preferencesToInsert,
  stickerFromRow,
  stickerToInsert,
  todoFromRow,
  todoToInsert,
} from '../domain/databaseMapping';
import {
  EVENT_ATTACHMENT_BUCKET,
  eventAttachmentFileIssue,
  eventAttachmentObjectPath,
  isEventAttachmentMimeType,
} from '../domain/attachments';
import {
  applyCalendarPatch,
  applyEventPatch,
  applyPreferencesPatch,
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
  type PreferencesPatch,
} from '../domain/mutations';
import {
  createDomainId,
  type CalendarEvent,
  type DayPopUserData,
  type EventAttachment,
  type TodoItem,
} from '../domain/types';
import type { ImportCommand } from '../domain/dataTransfer';
import { parseDayPopUserData } from '../domain/validation';
import type { Database } from '../lib/database.types';
import type { DayPopRepository, EventAttachmentRepository } from './repository';

/**
 * Thrown when Supabase itself refused or failed the request.
 *
 * Kept separate from `DomainValidationError` so the caller can tell "the
 * server said no" (RLS, offline, constraint) apart from "the row we received
 * does not match the domain contract".
 */
/**
 * Thrown when an import is attempted against an account before the atomic
 * RPCs exist — DP-056. Refusing keeps the account untouched.
 */
export class ImportUnavailableError extends Error {
  constructor(readonly kind: ImportCommand['kind']) {
    super('登入帳號的匯入功能尚未開放：需要資料庫端的原子匯入，尚未部署。請先在未登入狀態使用，或稍後再試。');
    this.name = 'ImportUnavailableError';
  }
}

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
 * DP-024 guarantees a default calendar and preferences row for every new
 * account. Creating either one here would be a second, competing bootstrap
 * path, so missing bootstrap rows fail loudly instead.
 */
export class AccountNotBootstrappedError extends Error {
  constructor() {
    super('這個帳號的初始化資料不完整，請稍後重試或聯絡支援。');
    this.name = 'AccountNotBootstrappedError';
  }
}

/**
 * Authenticated adapter: the same contract as the guest adapter, backed by
 * Supabase rows instead of one local envelope.
 *
 * DP-013 built and unit-tested this boundary against a stubbed client. DP-026
 * wires it through `SessionDataProvider` and adds the account-scoped cache;
 * this adapter remains responsible only for canonical rows and mutations.
 *
 * Reads and writes rely on owner RLS rather than trusting this filter alone;
 * the explicit `owner_id` filter is there so a mis-scoped query fails as an
 * empty result instead of quietly reading another account's rows.
 */
export class SupabaseDayPopRepository implements DayPopRepository, EventAttachmentRepository {
  #snapshot: DayPopUserData | null = null;

  constructor(
    private readonly client: SupabaseClient<Database>,
    private readonly userId: string,
    initialSnapshot?: DayPopUserData,
  ) {
    if (initialSnapshot) this.#snapshot = parseDayPopUserData(initialSnapshot);
  }

  async load(): Promise<DayPopUserData> {
    const owner = this.userId;
    await this.#flushAttachmentCleanup();
    // Table names stay literal so the generated row types survive; a generic
    // helper over table names collapses them into an unusable union.
    const [calendars, events, attachments, exceptions, todos, stickers, preferences] = await Promise.all([
        this.client.from('calendars').select('*').eq('owner_id', owner),
        this.client.from('events').select('*').eq('owner_id', owner),
        this.client.from('event_attachments').select('*').eq('owner_id', owner),
        this.client.from('event_exceptions').select('*').eq('owner_id', owner),
        this.client.from('todos').select('*').eq('owner_id', owner),
        this.client.from('stickers').select('*').eq('owner_id', owner),
        this.client.from('user_preferences').select('*').eq('user_id', owner).maybeSingle(),
      ]).catch((cause: unknown) => {
        throw new RemoteDataError('讀取帳號資料', cause);
      });

    const calendarRows = unwrap('讀取日曆', calendars);
    if (preferences.error) throw new RemoteDataError('讀取偏好', preferences.error);
    // DP-024 creates both rows in the auth.users transaction. Missing either
    // one is drift or a failed bootstrap, not permission to invent a second
    // initialization path in the browser.
    if (calendarRows.length === 0 || !preferences.data) {
      throw new AccountNotBootstrappedError();
    }

    return this.#commit({
      calendars: calendarRows.map(calendarFromRow),
      events: unwrap('讀取行程', events).map(eventFromRow),
      eventAttachments: unwrap('讀取附件', attachments).map(eventAttachmentFromRow),
      eventExceptions: unwrap('讀取例外', exceptions).map(eventExceptionFromRow),
      todos: unwrap('讀取待辦', todos).map(todoFromRow),
      stickers: unwrap('讀取貼圖', stickers).map(stickerFromRow),
      preferences: preferencesFromRow(preferences.data),
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
    const { data: deleted, error } = await requestRemote(
      '刪除行程與登記附件清理',
      this.client.rpc('delete_event_with_attachment_cleanup', { p_event_id: id }),
    );
    if (error) throw new RemoteDataError('刪除行程與登記附件清理', error);
    if (!deleted) return data;
    const next = this.#commit(withoutEvent(data, id));
    await this.#flushAttachmentCleanup();
    return next;
  }

  async uploadEventAttachment(eventId: string, file: File): Promise<DayPopUserData> {
    const data = this.#requireSnapshot();
    if (!findEvent(data, eventId)) return data;
    const issue = eventAttachmentFileIssue(file);
    if (issue || !isEventAttachmentMimeType(file.type)) {
      throw new RemoteDataError('驗證附件', issue ?? '不支援這個附件格式。');
    }

    const id = createDomainId();
    const objectPath = eventAttachmentObjectPath(this.userId, eventId, id);
    const cleanup = {
      owner_id: this.userId,
      bucket_id: EVENT_ATTACHMENT_BUCKET,
      object_path: objectPath,
    };
    const { error: queueError } = await requestRemote(
      '登記附件失敗清理',
      this.client.from('attachment_cleanup_jobs').insert(cleanup),
    );
    if (queueError) throw new RemoteDataError('登記附件失敗清理', queueError);

    const upload = await requestRemote(
      '上傳附件',
      this.client.storage.from(EVENT_ATTACHMENT_BUCKET).upload(objectPath, file, {
        contentType: file.type,
        upsert: false,
      }),
    );
    if (upload.error) {
      await this.#flushAttachmentCleanup();
      throw new RemoteDataError('上傳附件', upload.error);
    }

    const now = new Date().toISOString();
    const draft: EventAttachment = {
      id,
      eventId,
      objectPath,
      fileName: file.name,
      mimeType: file.type as EventAttachment['mimeType'],
      sizeBytes: file.size,
      createdAt: now,
      updatedAt: now,
    };
    const insert = eventAttachmentToInsert(draft, this.userId);
    const { data: row, error } = await requestRemote(
      '寫入附件 metadata',
      this.client.rpc('finalize_event_attachment_upload', {
        p_id: draft.id,
        p_event_id: insert.event_id,
        p_object_path: insert.object_path,
        p_file_name: insert.file_name,
        p_mime_type: insert.mime_type,
        p_size_bytes: insert.size_bytes,
      }),
    );
    if (error || !row) {
      await this.#flushAttachmentCleanup();
      throw new RemoteDataError('寫入附件 metadata', error);
    }

    const attachment = eventAttachmentFromRow(row);
    return this.#commit({
      ...data,
      eventAttachments: [...data.eventAttachments, attachment],
    });
  }

  async deleteEventAttachment(id: string): Promise<DayPopUserData> {
    const data = this.#requireSnapshot();
    if (!data.eventAttachments.some((attachment) => attachment.id === id)) return data;
    const { data: deleted, error } = await requestRemote(
      '刪除附件與登記清理',
      this.client.rpc('delete_event_attachment_with_cleanup', { p_attachment_id: id }),
    );
    if (error) throw new RemoteDataError('刪除附件與登記清理', error);
    if (!deleted) return data;
    const next = this.#commit({
      ...data,
      eventAttachments: data.eventAttachments.filter((attachment) => attachment.id !== id),
    });
    await this.#flushAttachmentCleanup();
    return next;
  }

  async createEventAttachmentUrl(id: string): Promise<string> {
    const attachment = this.#requireSnapshot().eventAttachments.find((item) => item.id === id);
    if (!attachment) throw new RemoteDataError('建立附件連結', '找不到附件 metadata');
    const { data, error } = await requestRemote(
      '建立附件連結',
      this.client.storage
        .from(EVENT_ATTACHMENT_BUCKET)
        .createSignedUrl(attachment.objectPath, 60, { download: attachment.fileName }),
    );
    if (error || !data?.signedUrl) throw new RemoteDataError('建立附件連結', error);
    return data.signedUrl;
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
    const { data: row, error } = await requestRemote(
      '寫入貼圖',
      this.client
        .from('stickers')
        .upsert(stickerToInsert(draft, this.userId))
        .select('*')
        .single(),
    );
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
      const { error } = await requestRemote(
        `搬移 ${table}`,
        this.client
          .from(table)
          .update({ calendar_id: plan.target.id })
          .eq('calendar_id', id)
          .eq('owner_id', this.userId),
      );
      if (error) throw new RemoteDataError(`搬移 ${table}`, error);
    }

    if (plan.promote) {
      const { error } = await requestRemote(
        '指定預設日曆',
        this.client
          .from('calendars')
          .update({ is_default: true })
          .eq('id', plan.target.id)
          .eq('owner_id', this.userId),
      );
      if (error) throw new RemoteDataError('指定預設日曆', error);
    }

    await this.#delete('calendars', id);
    return this.#commit(withoutCalendar(data, id, new Date().toISOString()));
  }

  async updatePreferences(patch: PreferencesPatch): Promise<DayPopUserData> {
    const data = this.#requireSnapshot();
    const draft = applyPreferencesPatch(data.preferences, patch);
    const { data: row, error } = await requestRemote(
      '寫入偏好',
      this.client
        .from('user_preferences')
        .upsert(preferencesToInsert(draft, this.userId))
        .select('*')
        .single(),
    );
    if (error || !row) throw new RemoteDataError('寫入偏好', error);
    return this.#commit({ ...data, preferences: preferencesFromRow(row) });
  }

  /**
   * DP-056 — not wired to a database yet.
   *
   * Applying an import to an account means replacing or appending across nine
   * tables **atomically**; anything less can leave the account half-imported.
   * This client cannot do that with row-level writes, so the owner-approved
   * design puts it in two RPCs (`replace_daypop_data` / `append_daypop_ics`)
   * added by a migration that has not shipped yet.
   *
   * Until it does this refuses, loudly and before touching anything. The
   * alternative — looping the existing row writes — is exactly the
   * half-applied import the decision forbids.
   */
  importData(command: ImportCommand): Promise<DayPopUserData> {
    return Promise.reject(new ImportUnavailableError(command.kind));
  }

  async #upsertCalendar(calendar: Parameters<typeof calendarToInsert>[0]) {
    const { data, error } = await requestRemote(
      '寫入日曆',
      this.client
        .from('calendars')
        .upsert(calendarToInsert(calendar, this.userId))
        .select('*')
        .single(),
    );
    if (error || !data) throw new RemoteDataError('寫入日曆', error);
    return calendarFromRow(data);
  }

  /**
   * Writes go back through `*FromRow`, so the snapshot holds what the database
   * actually stored — including the `created_at`/`updated_at` the client is
   * not allowed to set — rather than what this session hoped it would store.
   */
  async #upsertEvent(event: CalendarEvent) {
    const { data, error } = await requestRemote(
      '寫入行程',
      this.client
        .from('events')
        .upsert(eventToInsert(event, this.userId))
        .select('*')
        .single(),
    );
    if (error || !data) throw new RemoteDataError('寫入行程', error);
    return eventFromRow(data);
  }

  async #upsertTodo(todo: TodoItem) {
    const { data, error } = await requestRemote(
      '寫入待辦',
      this.client
        .from('todos')
        .upsert(todoToInsert(todo, this.userId))
        .select('*')
        .single(),
    );
    if (error || !data) throw new RemoteDataError('寫入待辦', error);
    return todoFromRow(data);
  }

  async #delete(table: 'events' | 'todos' | 'stickers' | 'calendars', id: string) {
    const { error } = await requestRemote(
      `刪除 ${table}`,
      this.client
        .from(table)
        .delete()
        .eq('id', id)
        .eq('owner_id', this.userId),
    );
    if (error) throw new RemoteDataError(`刪除 ${table}`, error);
  }

  /** Best-effort durable cleanup; failed paths remain queued for the next load. */
  async #flushAttachmentCleanup(): Promise<boolean> {
    const jobs = await this.client
      .from('attachment_cleanup_jobs')
      .select('id, object_path')
      .eq('owner_id', this.userId);
    if (jobs.error || !jobs.data || jobs.data.length === 0) return !jobs.error;

    const removed = await this.client.storage
      .from(EVENT_ATTACHMENT_BUCKET)
      .remove(jobs.data.map((job) => job.object_path));
    if (removed.error) return false;

    const deleted = await this.client
      .from('attachment_cleanup_jobs')
      .delete()
      .eq('owner_id', this.userId)
      .in('id', jobs.data.map((job) => job.id));
    return !deleted.error;
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

/** Normalizes both PostgREST error results and rejected transport promises. */
async function requestRemote<Result>(
  operation: string,
  request: PromiseLike<Result>,
): Promise<Result> {
  try {
    return await request;
  } catch (cause) {
    if (cause instanceof RemoteDataError) throw cause;
    throw new RemoteDataError(operation, cause);
  }
}

function describe(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'message' in cause) {
    return String((cause as { message: unknown }).message);
  }
  return cause === null || cause === undefined ? '沒有回傳資料' : String(cause);
}
