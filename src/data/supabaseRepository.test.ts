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

function bootstrapped() {
  const db = new FakeSupabase();
  db.seed('calendars', [calendarRow()]);
  db.seed('events', [eventRow()]);
  db.seed('todos', [todoRow()]);
  return { db, repository: new SupabaseDayPopRepository(db.asClient(), OWNER) };
}

describe('SupabaseDayPopRepository load', () => {
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

  it('falls back to the domain default preferences until DP-024 writes a row', async () => {
    const { repository } = bootstrapped();

    const data = await repository.load();

    expect(data.preferences.timezone).toBe('Asia/Taipei');
    expect(data.preferences.petEnabled).toBe(true);
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

  it('toggles a todo in both directions', async () => {
    const { db, repository } = bootstrapped();
    await repository.load();

    const done = await repository.toggleTodo(TODO);
    expect(done.todos[0]?.completedAt).not.toBeNull();
    expect(db.rows('todos')[0]?.completed_at).not.toBeNull();

    const undone = await repository.toggleTodo(TODO);
    expect(undone.todos[0]?.completedAt).toBeNull();
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
});
