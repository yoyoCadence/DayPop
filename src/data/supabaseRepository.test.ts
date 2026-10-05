import { describe, expect, it } from 'vitest';
import { FakeSupabase, type FakeRow } from '../test/fakeSupabase';
import {
  AccountNotBootstrappedError,
  RemoteDataError,
  SupabaseDayPopRepository,
} from './supabaseRepository';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER_OWNER = '22222222-2222-4222-8222-222222222222';
const CALENDAR = '33333333-3333-4333-8333-333333333333';
const EVENT = '44444444-4444-4444-8444-444444444444';
const TODO = '55555555-5555-4555-8555-555555555555';
const ATTACHMENT = '66666666-6666-4666-8666-666666666666';
const IMPORT_CALENDAR = '77777777-7777-4777-8777-777777777777';

function calendarRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: CALENDAR,
    owner_id: OWNER,
    name: '我的日曆',
    color: '#F06C5C',
    is_visible: true,
    is_default: true,
    sort_order: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function eventRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: EVENT,
    owner_id: OWNER,
    calendar_id: CALENDAR,
    title: '既有會議',
    location: null,
    notes: null,
    reminder_minutes: [],
    recurrence_rule: null,
    sharing_scope: 'inherit',
    is_all_day: false,
    start_date: null,
    end_date: null,
    starts_at: '2026-08-06T01:00:00.000Z',
    ends_at: '2026-08-06T02:00:00.000Z',
    timezone: 'Asia/Taipei',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function todoRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: TODO,
    owner_id: OWNER,
    calendar_id: CALENDAR,
    parent_id: null,
    title: '既有待辦',
    due_date: '2026-08-06',
    priority: 'none',
    completed_at: null,
    sort_order: 0,
    sharing_scope: 'inherit',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function attachmentRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: ATTACHMENT,
    owner_id: OWNER,
    event_id: EVENT,
    object_path: `${OWNER}/${EVENT}/${ATTACHMENT}`,
    file_name: 'agenda.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1024,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function preferencesRow(overrides: FakeRow = {}): FakeRow {
  return {
    user_id: OWNER,
    timezone: 'Asia/Taipei',
    week_starts_on: 0,
    theme: 'light',
    theme_id: 'manga',
    fixed_six_week_grid: false,
    default_reminder_minutes: [],
    pet_name: '摩卡',
    pet_enabled: true,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function bootstrapped() {
  const db = new FakeSupabase();
  db.seed('calendars', [calendarRow()]);
  db.seed('events', [eventRow()]);
  db.seed('todos', [todoRow()]);
  db.seed('user_preferences', [preferencesRow()]);
  return { db, repository: new SupabaseDayPopRepository(db.asClient(), OWNER) };
}

describe('SupabaseDayPopRepository load', () => {
  it('priority update sends one field, preserves confirmed data on failure and refuses missing/foreign rows', async () => {
    const { db, repository } = bootstrapped();
    const before = await repository.load();
    db.failures.set('todos', 'offline');
    await expect(repository.setTodoPriority(TODO, 'high')).rejects.toThrow(RemoteDataError);
    db.failures.delete('todos');
    expect(await repository.load()).toEqual(before);
    const saved = await repository.setTodoPriority(TODO, 'high');
    expect(db.writes.at(-1)).toEqual({ table: 'todos', row: { priority: 'high' } });
    expect(saved.todos[0]).toEqual({ ...before.todos[0], priority: 'high', updatedAt: saved.todos[0]!.updatedAt });
    db.tables.set('todos', []);
    await expect(repository.setTodoPriority(TODO, 'low')).rejects.toThrow(RemoteDataError);
    expect(db.rows('todos')).toEqual([]);
    db.seed('todos', [todoRow({ owner_id: OTHER_OWNER })]);
    db.writes.length = 0;
    await expect(repository.setTodoPriority(TODO, 'low')).rejects.toThrow(RemoteDataError);
    expect(db.rows('todos')[0]).toEqual(todoRow({ owner_id: OTHER_OWNER }));
    expect(db.writes).toEqual([]);
  });
  it('title edit sends only the title, keeps the snapshot on failure and never recreates missing rows', async () => {
    const { db, repository } = bootstrapped();
    const before = await repository.load();
    db.failures.set('todos', 'network failed');
    await expect(repository.renameTodo(TODO, '新標題')).rejects.toThrow(RemoteDataError);
    db.failures.delete('todos');
    expect(await repository.load()).toEqual(before);
    const saved = await repository.renameTodo(TODO, '  新標題  ');
    expect(db.writes.at(-1)).toEqual({ table: 'todos', row: { title: '新標題' } });
    expect(saved.todos[0]!.title).toBe('新標題');
    db.tables.set('todos', []);
    await expect(repository.renameTodo(TODO, '不能重建')).rejects.toThrow(RemoteDataError);
    expect(db.rows('todos')).toEqual([]);
    expect(saved.todos[0]!.title).toBe('新標題');
  });

  it('owner-filtered title update refuses a row whose ownership changed after load', async () => {
    const { db, repository } = bootstrapped();
    await repository.load();
    db.seed('todos', [todoRow({ owner_id: OTHER_OWNER })]);
    await expect(repository.renameTodo(TODO, '不能改別人')).rejects.toThrow(RemoteDataError);
    expect(db.rows('todos')[0]!.title).toBe('既有待辦');
    expect(db.writes).toEqual([]);
  });
  it('builds a validated document out of the account rows', async () => {
    const { repository } = bootstrapped();

    const data = await repository.load();

    expect(data.calendars).toHaveLength(1);
    expect(data.calendars[0]?.isDefault).toBe(true);
    expect(data.events[0]).toMatchObject({
      id: EVENT,
      allDay: false,
      startsAt: '2026-08-06T01:00:00.000Z',
      timezone: 'Asia/Taipei',
    });
    expect(data.todos[0]?.title).toBe('既有待辦');
  });

  it('loads the canonical preferences created by DP-024', async () => {
    const { repository } = bootstrapped();

    const data = await repository.load();

    expect(data.preferences.timezone).toBe('Asia/Taipei');
    expect(data.preferences.theme).toBe('light');
    expect(data.preferences.themeId).toBe('manga');
    expect(data.preferences.petEnabled).toBe(true);
  });

  it('loads canonical attachment metadata without exposing a public URL', async () => {
    const { db, repository } = bootstrapped();
    db.seed('event_attachments', [attachmentRow()]);

    const data = await repository.load();

    expect(data.eventAttachments).toEqual([
      expect.objectContaining({
        id: ATTACHMENT,
        eventId: EVENT,
        fileName: 'agenda.pdf',
        mimeType: 'application/pdf',
      }),
    ]);
    expect(JSON.stringify(data.eventAttachments)).not.toContain('signedUrl');
  });

  it('reads only the signed-in owner rows', async () => {
    const { db, repository } = bootstrapped();
    db.seed('calendars', [calendarRow(), calendarRow({ id: OTHER_OWNER, owner_id: OTHER_OWNER })]);
    db.seed('events', [
      eventRow(),
      eventRow({ id: OTHER_OWNER, owner_id: OTHER_OWNER, title: '別人的會議' }),
    ]);

    const data = await repository.load();

    expect(data.calendars).toHaveLength(1);
    expect(data.events.map((event) => event.title)).toEqual(['既有會議']);
  });

  it('fails loudly for an account with no default calendar', async () => {
    const db = new FakeSupabase();
    db.seed('user_preferences', [preferencesRow()]);
    const repository = new SupabaseDayPopRepository(db.asClient(), OWNER);

    await expect(repository.load()).rejects.toThrow(AccountNotBootstrappedError);
  });

  it('fails loudly instead of inventing missing bootstrap preferences', async () => {
    const db = new FakeSupabase();
    db.seed('calendars', [calendarRow()]);
    const repository = new SupabaseDayPopRepository(db.asClient(), OWNER);

    await expect(repository.load()).rejects.toThrow(AccountNotBootstrappedError);
  });

  it('surfaces a rejected request as a remote error, not as empty data', async () => {
    const { db, repository } = bootstrapped();
    db.failures.set('events', 'permission denied for table events');

    await expect(repository.load()).rejects.toThrow(RemoteDataError);
  });
});

describe('SupabaseDayPopRepository writes', () => {
  it('refuses invalid all-day ranges before requests and retains the last confirmed snapshot after a failed extension (DP-127)', async () => {
    const { db, repository } = bootstrapped();
    db.seed('events', [eventRow({ is_all_day: true, start_date: '2026-08-06', end_date: '2026-08-09', starts_at: null, ends_at: null, timezone: null })]);
    const before = await repository.load();
    await expect(repository.updateEvent(EVENT, { endDate: '2026-08-05' })).rejects.toThrow('不能早於');
    await expect(repository.addEvent({ title: '拒絕', date: '2026-08-06', endDate: '', allDay: true, start: '', end: '' })).rejects.toThrow();
    expect(db.writes).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
    db.failures.set('events', '拒絕保存');
    await expect(repository.updateEvent(EVENT, { endDate: '2026-08-12' })).rejects.toBeInstanceOf(RemoteDataError);
    db.failures.delete('events');
    expect(await repository.load()).toEqual(before);
  });
  it.each(['failures', 'rejections'] as const)('keeps the complete todo tree after a %s deletion error (DP-115)', async (failureKind) => {
    const { db, repository } = bootstrapped();
    db.seed('todos', [
      todoRow(),
      todoRow({ id: OTHER_OWNER, parent_id: TODO, title: '子項' }),
      todoRow({ id: IMPORT_CALENDAR, parent_id: OTHER_OWNER, title: '孫項' }),
    ]);
    await repository.load();
    const rows = structuredClone(db.rows('todos'));
    db[failureKind].set('todos', 'deletion unavailable');
    await expect(repository.deleteTodo(TODO)).rejects.toThrow(RemoteDataError);
    expect(db.rows('todos')).toEqual(rows);
    db[failureKind].clear();
    // Uses the retained snapshot without a reload, so optimistic loss cannot hide.
    const next = await repository.toggleTodo(TODO);
    expect(next.todos.map((todo) => todo.title)).toEqual(['既有待辦', '子項', '孫項']);
    expect(await repository.load()).toEqual(next);
  });

  it('refuses to edit before the document has been loaded', async () => {
    const { repository } = bootstrapped();

    await expect(repository.deleteEvent(EVENT)).rejects.toThrow('請先呼叫 load()');
  });

  it('writes an owner-scoped row and keeps the server timestamps', async () => {
    const { db, repository } = bootstrapped();
    await repository.load();

    const data = await repository.addEvent({
      title: '新會議',
      date: '2026-08-07',
      allDay: false,
      start: '09:00',
      end: '10:00',
    });

    const written = db.writes.at(-1);
    expect(written?.table).toBe('events');
    expect(written?.row.owner_id).toBe(OWNER);
    // DB-controlled columns are never sent by the client — DP-012/036.
    expect(written?.row).not.toHaveProperty('created_at');
    expect(written?.row).not.toHaveProperty('updated_at');

    const created = data.events.find((event) => event.title === '新會議');
    expect(created?.updatedAt).toBe(db.serverTime);
  });

  it('persists an edit and a delete through to the table', async () => {
    const { db, repository } = bootstrapped();
    await repository.load();

    const edited = await repository.updateEvent(EVENT, { title: '改過的會議' });
    expect(edited.events.find((event) => event.id === EVENT)?.title).toBe('改過的會議');
    expect(db.rows('events').find((row) => row.id === EVENT)?.title).toBe('改過的會議');

    const deleted = await repository.deleteEvent(EVENT);
    expect(deleted.events).toHaveLength(0);
    expect(db.rows('events')).toHaveLength(0);
  });

  it('uploads to the private bucket, stores metadata, then creates a short signed URL', async () => {
    const { db, repository } = bootstrapped();
    await repository.load();
    const file = new File(['agenda'], 'agenda.pdf', { type: 'application/pdf' });

    const data = await repository.uploadEventAttachment(EVENT, file);
    const attachment = data.eventAttachments[0]!;

    expect(attachment).toMatchObject({
      eventId: EVENT,
      fileName: 'agenda.pdf',
      mimeType: 'application/pdf',
      sizeBytes: file.size,
    });
    expect(db.objects.has(`event-attachments/${attachment.objectPath}`)).toBe(true);
    expect(db.rows('event_attachments')).toHaveLength(1);
    expect(db.rows('attachment_cleanup_jobs')).toHaveLength(0);
    await expect(repository.createEventAttachmentUrl(attachment.id)).resolves.toContain(
      '?signed=1',
    );
  });

  it('rejects unsupported files before creating a cleanup job or object', async () => {
    const { db, repository } = bootstrapped();
    await repository.load();

    await expect(
      repository.uploadEventAttachment(
        EVENT,
        new File(['<svg/>'], 'active.svg', { type: 'image/svg+xml' }),
      ),
    ).rejects.toThrow('只支援');
    expect(db.rows('attachment_cleanup_jobs')).toHaveLength(0);
    expect(db.objects.size).toBe(0);
  });

  it('removes an uploaded object when metadata insertion fails', async () => {
    const { db, repository } = bootstrapped();
    await repository.load();
    db.failures.set('event_attachments', 'metadata rejected');

    await expect(
      repository.uploadEventAttachment(
        EVENT,
        new File(['agenda'], 'agenda.pdf', { type: 'application/pdf' }),
      ),
    ).rejects.toThrow(RemoteDataError);

    expect(db.objects.size).toBe(0);
    expect(db.rows('attachment_cleanup_jobs')).toHaveLength(0);
  });

  it('keeps a durable cleanup job and retries after Storage deletion fails', async () => {
    const { db, repository } = bootstrapped();
    const row = attachmentRow();
    db.seed('event_attachments', [row]);
    db.objects.set(`event-attachments/${row.object_path}`, new Blob(['agenda']));
    await repository.load();
    db.failures.set('storage:remove', 'temporarily unavailable');

    const deleted = await repository.deleteEventAttachment(ATTACHMENT);

    expect(deleted.eventAttachments).toHaveLength(0);
    expect(db.rows('event_attachments')).toHaveLength(0);
    expect(db.rows('attachment_cleanup_jobs')).toHaveLength(1);
    expect(db.objects.size).toBe(1);

    db.failures.delete('storage:remove');
    await repository.load();
    expect(db.rows('attachment_cleanup_jobs')).toHaveLength(0);
    expect(db.objects.size).toBe(0);
  });

  it('queues and removes every attachment when deleting its event', async () => {
    const { db, repository } = bootstrapped();
    const row = attachmentRow();
    db.seed('event_attachments', [row]);
    db.objects.set(`event-attachments/${row.object_path}`, new Blob(['agenda']));
    await repository.load();

    const deleted = await repository.deleteEvent(EVENT);

    expect(deleted.events).toHaveLength(0);
    expect(deleted.eventAttachments).toHaveLength(0);
    expect(db.rows('events')).toHaveLength(0);
    expect(db.rows('event_attachments')).toHaveLength(0);
    expect(db.rows('attachment_cleanup_jobs')).toHaveLength(0);
    expect(db.objects.size).toBe(0);
  });

  it('toggles a todo in both directions', async () => {
    const { db, repository } = bootstrapped();
    await repository.load();

    const done = await repository.toggleTodo(TODO);
    expect(done.todos[0]?.completedAt).not.toBeNull();
    expect(db.rows('todos')[0]?.completed_at).not.toBeNull();

    const undone = await repository.toggleTodo(TODO);
    expect(undone.todos[0]?.completedAt).toBeNull();
  });

  it('writes a sticker row with its date and glyph', async () => {
    const { db, repository } = bootstrapped();
    await repository.load();

    const data = await repository.addSticker({ date: '2026-08-07', glyph: '🎂' });

    const written = db.writes.at(-1);
    expect(written?.table).toBe('stickers');
    expect(written?.row).toMatchObject({
      owner_id: OWNER,
      calendar_id: CALENDAR,
      sticker_date: '2026-08-07',
      glyph: '🎂',
      asset_key: null,
    });
    expect(data.stickers[0]).toMatchObject({ date: '2026-08-07', glyph: '🎂', assetKey: null });

    const id = data.stickers[0]!.id;
    expect((await repository.deleteSticker(id)).stickers).toHaveLength(0);
    expect(db.rows('stickers')).toHaveLength(0);
  });

  it('leaves an unknown id alone instead of writing', async () => {
    const { db, repository } = bootstrapped();
    await repository.load();
    const before = db.writes.length;

    const data = await repository.updateEvent(OTHER_OWNER, { title: '不存在' });

    expect(data.events).toHaveLength(1);
    expect(db.writes).toHaveLength(before);
  });

  it('does not apply the change locally when the write is rejected', async () => {
    const { db, repository } = bootstrapped();
    await repository.load();
    db.failures.set('events', 'new row violates row-level security policy');

    await expect(
      repository.addEvent({
        title: '被拒絕的會議',
        date: '2026-08-07',
        allDay: true,
        start: '',
        end: '',
      }),
    ).rejects.toThrow(RemoteDataError);

    // The snapshot must still match the server, or the UI would show a row
    // that does not exist anywhere.
    db.failures.clear();
    const reloaded = await repository.load();
    expect(reloaded.events.map((event) => event.title)).toEqual(['既有會議']);
  });

  it('normalizes a rejected transport promise without applying the draft', async () => {
    const { db, repository } = bootstrapped();
    await repository.load();
    db.rejections.set('events', 'fetch failed');

    await expect(
      repository.addEvent({
        title: '傳輸失敗的會議',
        date: '2026-08-07',
        allDay: true,
        start: '',
        end: '',
      }),
    ).rejects.toThrow(RemoteDataError);

    db.rejections.clear();
    const reloaded = await repository.load();
    expect(reloaded.events.map((event) => event.title)).toEqual(['既有會議']);
  });

  it('replaces account data through one RPC and reloads the server snapshot', async () => {
    const { db, repository } = bootstrapped();
    const current = await repository.load();
    const calendar = {
      ...current.calendars[0]!,
      id: IMPORT_CALENDAR,
      name: '還原的日曆',
    };

    const data = await repository.importData({
      kind: 'replace',
      data: {
        calendars: [calendar],
        events: [],
        eventExceptions: [],
        todos: [],
        stickers: [],
        preferences: { ...current.preferences, petName: '備份夥伴' },
      },
    });

    expect(db.rpcCalls.at(-1)?.name).toBe('replace_daypop_data');
    const payload = db.rpcCalls.at(-1)?.args.p_payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty('owner_id');
    expect((payload.calendars as FakeRow[])[0]).toEqual(
      expect.objectContaining({ id: IMPORT_CALENDAR, name: '還原的日曆' }),
    );
    expect((payload.calendars as FakeRow[])[0]).not.toHaveProperty('owner_id');
    expect((payload.calendars as FakeRow[])[0]).not.toHaveProperty('created_at');
    expect(payload.preferences).not.toHaveProperty('user_id');
    expect(data.calendars[0]).toMatchObject({
      id: IMPORT_CALENDAR,
      name: '還原的日曆',
      updatedAt: db.serverTime,
    });
    expect(data.preferences.petName).toBe('備份夥伴');
  });

  it('renames an incoming ICS collision before the append RPC', async () => {
    const { db, repository } = bootstrapped();
    const current = await repository.load();
    const incoming = {
      ...current.events[0]!,
      title: '匯入的同 ID 行程',
    };

    const data = await repository.importData({
      kind: 'appendIcs',
      events: [incoming],
      eventExceptions: [],
    });

    const call = db.rpcCalls.at(-1);
    expect(call?.name).toBe('append_daypop_ics');
    const payload = call?.args.p_payload as { events: FakeRow[]; event_exceptions: FakeRow[] };
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]?.id).not.toBe(EVENT);
    expect(payload.events[0]).not.toHaveProperty('owner_id');
    expect(payload.event_exceptions).toEqual([]);
    expect(data.events.map((event) => event.title)).toEqual([
      '既有會議',
      '匯入的同 ID 行程',
    ]);
    expect(new Set(data.events.map((event) => event.id)).size).toBe(2);
  });

  it('keeps the previous snapshot when the import RPC is rejected', async () => {
    const { db, repository } = bootstrapped();
    const current = await repository.load();
    db.failures.set('rpc:append_daypop_ics', 'new row violates row-level security policy');

    await expect(
      repository.importData({
        kind: 'appendIcs',
        events: [{ ...current.events[0]!, id: OTHER_OWNER, title: '不應落地' }],
        eventExceptions: [],
      }),
    ).rejects.toThrow(RemoteDataError);

    db.failures.clear();
    expect((await repository.updateEvent(EVENT, { title: '仍可編輯既有快照' })).events).toEqual([
      expect.objectContaining({ id: EVENT, title: '仍可編輯既有快照' }),
    ]);
    expect(db.rpcCalls.filter((call) => call.name === 'append_daypop_ics')).toHaveLength(1);
  });

  it('does not trust the submitted payload when the post-RPC reload fails', async () => {
    const { db, repository } = bootstrapped();
    const current = await repository.load();
    db.failures.set('events', 'reload unavailable');

    await expect(
      repository.importData({
        kind: 'appendIcs',
        events: [{ ...current.events[0]!, id: OTHER_OWNER, title: '遠端已匯入' }],
        eventExceptions: [],
      }),
    ).rejects.toThrow(RemoteDataError);

    expect(db.rows('events').map((row) => row.title)).toEqual(['既有會議', '遠端已匯入']);
    expect(db.rpcCalls.filter((call) => call.name === 'append_daypop_ics')).toHaveLength(1);
  });
});

/**
 * The two faults review found in DP-082's first, client-side version. Both are
 * regressions the `FakeSupabase` of that version could not have caught, so the
 * fake grew the partial unique indexes, the FK cascade and the two RPCs first.
 */
describe('SupabaseDayPopRepository 單次 occurrence 寫入（DP-082 覆驗修正）', () => {
  const SERIES = '88888888-8888-4888-8888-888888888888';
  const OCCURRENCE = { kind: 'all-day' as const, date: '2026-08-05' };

  function seriesRow(): FakeRow {
    return eventRow({
      id: SERIES,
      title: '站會',
      recurrence_rule: 'FREQ=DAILY;COUNT=5',
      is_all_day: true,
      start_date: '2026-08-03',
      end_date: '2026-08-03',
      starts_at: null,
      ends_at: null,
      timezone: null,
    });
  }

  function withSeries() {
    const db = new FakeSupabase();
    db.seed('calendars', [calendarRow()]);
    db.seed('events', [seriesRow()]);
    db.seed('user_preferences', [preferencesRow()]);
    return db;
  }

  it('取消已被替換的一次，會把替換事件的附件排進清理佇列並真的刪掉檔案', async () => {
    const db = withSeries();
    const repository = new SupabaseDayPopRepository(db.asClient(), OWNER);
    await repository.load();
    const replaced = await repository.replaceEventOccurrence(SERIES, OCCURRENCE, {
      title: '改期的站會',
    });
    const replacementId = replaced.eventExceptions[0]!.replacementEventId!;

    // 附件是使用者在替換事件存好之後加的，和任何一般事件一樣。
    const attachment = attachmentRow({
      event_id: replacementId,
      object_path: `${OWNER}/${replacementId}/${ATTACHMENT}`,
    });
    db.seed('event_attachments', [attachment]);
    db.objects.set(`event-attachments/${attachment.object_path}`, new Blob(['agenda']));
    await repository.load();

    const data = await repository.cancelEventOccurrence(SERIES, OCCURRENCE);

    // 文件端：替換事件與它的附件一起消失，否則 parseDayPopUserData() 會因為
    // 「附件指向不存在的事件」整個 commit 失敗。
    expect(data.events.map((event) => event.id)).toEqual([SERIES]);
    expect(data.eventAttachments).toEqual([]);
    expect(data.eventExceptions[0]).toMatchObject({
      isCancelled: true,
      replacementEventId: null,
    });
    // Storage 端：檔案有被排進佇列並清掉，不是靜靜留下無法追蹤的孤兒。
    expect(db.rows('event_attachments')).toHaveLength(0);
    expect(db.rows('attachment_cleanup_jobs')).toHaveLength(0);
    expect(db.objects.size).toBe(0);
  });

  /**
   * 「提交成功但 response 遺失」與「兩個分頁同時操作」是同一件事：第二個
   * writer 的 snapshot 看不到已經存進去的例外，於是提出一個全新的 UUID。
   * 舊版以 primary key 做 upsert，這裡會插進第二列並撞上 partial unique
   * index；replace 更糟，替換事件已經先寫進去了，每重試一次就多一個孤兒。
   */
  it('重試時以資料庫既有的列為準，不會多出第二列例外或第二個替換事件', async () => {
    const db = withSeries();
    const first = new SupabaseDayPopRepository(db.asClient(), OWNER);
    await first.load();
    const committed = await first.replaceEventOccurrence(SERIES, OCCURRENCE, {
      title: '改期的站會',
    });
    const replacementId = committed.eventExceptions[0]!.replacementEventId;

    // 第二個 adapter 的 snapshot 停在寫入之前，就像 response 遺失後的重試。
    const stale = new SupabaseDayPopRepository(db.asClient(), OWNER, {
      ...committed,
      events: committed.events.filter((event) => event.id === SERIES),
      eventExceptions: [],
    });
    const data = await stale.replaceEventOccurrence(SERIES, OCCURRENCE, {
      title: '改期的站會（重試）',
    });

    expect(db.rows('event_exceptions')).toHaveLength(1);
    expect(data.eventExceptions).toHaveLength(1);
    // 重試沿用資料庫既有的替換事件，而不是再造一個。
    expect(data.eventExceptions[0]!.replacementEventId).toBe(replacementId);
    expect(db.rows('events').filter((row) => row.id !== SERIES)).toHaveLength(1);
    expect(data.events.filter((event) => event.id !== SERIES)).toHaveLength(1);
    expect(data.events.find((event) => event.id === replacementId)?.title).toBe(
      '改期的站會（重試）',
    );
  });

  it('取消也一樣：重試不會插進第二列例外', async () => {
    const db = withSeries();
    const first = new SupabaseDayPopRepository(db.asClient(), OWNER);
    const committed = await first.load();
    await first.cancelEventOccurrence(SERIES, OCCURRENCE);

    const stale = new SupabaseDayPopRepository(db.asClient(), OWNER, committed);
    const data = await stale.cancelEventOccurrence(SERIES, OCCURRENCE);

    expect(db.rows('event_exceptions')).toHaveLength(1);
    expect(data.eventExceptions).toHaveLength(1);
  });
});
