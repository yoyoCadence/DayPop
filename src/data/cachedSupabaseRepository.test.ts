import { describe, expect, it } from 'vitest';
import { readAccountCache } from '../storage/accountCache';
import { MemoryStorage } from '../storage/browserStorage';
import { FakeSupabase, type FakeRow } from '../test/fakeSupabase';
import {
  CachedRemoteLoadError,
  CachedSupabaseDayPopRepository,
} from './cachedSupabaseRepository';
import { RemoteDataError } from './supabaseRepository';

const OWNER = '11111111-1111-4111-8111-111111111111';
const CALENDAR = '33333333-3333-4333-8333-333333333333';
const EVENT = '44444444-4444-4444-8444-444444444444';

function calendarRow(): FakeRow {
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
  };
}

function preferencesRow(): FakeRow {
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
  };
}

function bootstrapped() {
  const db = new FakeSupabase();
  db.seed('calendars', [calendarRow()]);
  db.seed('user_preferences', [preferencesRow()]);
  return db;
}

function appendCommand() {
  return {
    kind: 'appendIcs' as const,
    events: [
      {
        id: EVENT,
        calendarId: CALENDAR,
        title: '匯入的行程',
        allDay: true as const,
        startDate: '2026-08-22',
        endDate: '2026-08-22',
        location: null,
        notes: null,
        reminderMinutes: [],
        recurrence: null,
        sharingScope: 'inherit' as const,
        createdAt: '2026-08-22T00:00:00.000Z',
        updatedAt: '2026-08-22T00:00:00.000Z',
      },
    ],
    eventExceptions: [],
  };
}

describe('CachedSupabaseDayPopRepository', () => {
  it('updates the account cache only after confirmed remote data', async () => {
    const storage = new MemoryStorage();
    const db = bootstrapped();
    const repository = new CachedSupabaseDayPopRepository(db.asClient(), OWNER, storage);

    await repository.load();
    const data = await repository.addTodo({ title: '雲端待辦', date: '2026-08-08' });
    const cached = readAccountCache(OWNER, storage);

    expect(db.rows('todos')[0]?.title).toBe('雲端待辦');
    expect(data.todos[0]?.title).toBe('雲端待辦');
    expect(cached.status === 'ready' ? cached.envelope.data.todos[0]?.title : null).toBe(
      '雲端待辦',
    );
  });

  it('returns only the same account cache when remote load is unavailable', async () => {
    const storage = new MemoryStorage();
    const db = bootstrapped();
    await new CachedSupabaseDayPopRepository(db.asClient(), OWNER, storage).load();
    db.failures.set('events', 'network unavailable');

    const repository = new CachedSupabaseDayPopRepository(db.asClient(), OWNER, storage);
    const failure = await repository.load().catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(CachedRemoteLoadError);
    expect(
      failure instanceof CachedRemoteLoadError
        ? failure.cachedData.calendars[0]?.id
        : null,
    ).toBe(CALENDAR);
  });

  it('surfaces the remote error when this account has no valid cache', async () => {
    const storage = new MemoryStorage();
    const db = bootstrapped();
    db.failures.set('events', 'network unavailable');
    const repository = new CachedSupabaseDayPopRepository(db.asClient(), OWNER, storage);

    await expect(repository.load()).rejects.toThrow(RemoteDataError);
  });

  it('writes the account cache from the post-RPC reload only', async () => {
    const storage = new MemoryStorage();
    const db = bootstrapped();
    const repository = new CachedSupabaseDayPopRepository(db.asClient(), OWNER, storage);
    await repository.load();

    const data = await repository.importData(appendCommand());
    const cached = readAccountCache(OWNER, storage);

    expect(data.events[0]).toMatchObject({ id: EVENT, title: '匯入的行程' });
    expect(cached.status === 'ready' ? cached.envelope.data.events[0] : null).toMatchObject({
      id: EVENT,
      title: '匯入的行程',
    });
  });

  it('does not update or retry the cache when the import RPC fails', async () => {
    const storage = new MemoryStorage();
    const db = bootstrapped();
    const repository = new CachedSupabaseDayPopRepository(db.asClient(), OWNER, storage);
    await repository.load();
    const before = storage.getItem(`daypop.account-cache.${encodeURIComponent(OWNER)}`);
    db.failures.set('rpc:append_daypop_ics', 'permission denied');

    await expect(repository.importData(appendCommand())).rejects.toThrow(RemoteDataError);

    expect(storage.getItem(`daypop.account-cache.${encodeURIComponent(OWNER)}`)).toBe(before);
    expect(db.rpcCalls.filter((call) => call.name === 'append_daypop_ics')).toHaveLength(1);
  });

  it('keeps the confirmed cache when the RPC commits but its reload fails', async () => {
    const storage = new MemoryStorage();
    const db = bootstrapped();
    const repository = new CachedSupabaseDayPopRepository(db.asClient(), OWNER, storage);
    await repository.load();
    const before = storage.getItem(`daypop.account-cache.${encodeURIComponent(OWNER)}`);
    db.failures.set('events', 'reload unavailable');

    await expect(repository.importData(appendCommand())).rejects.toThrow(RemoteDataError);

    expect(db.rows('events')).toHaveLength(1);
    expect(storage.getItem(`daypop.account-cache.${encodeURIComponent(OWNER)}`)).toBe(before);
    expect(db.rpcCalls.filter((call) => call.name === 'append_daypop_ics')).toHaveLength(1);
  });
});
