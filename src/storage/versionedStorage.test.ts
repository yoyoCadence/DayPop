import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyUserData } from '../domain/types';
import v1Fixture from './fixtures/user-data-v1.json';
import { LocalDataBlockedError, LocalDayPopRepository } from './localRepository';
import {
  backupRawUserData,
  LEGACY_USER_DATA_STORAGE_KEY,
  listUserDataBackups,
  readUserData,
  resetUserData,
  USER_DATA_STORAGE_KEY,
  writeUserData,
} from './versionedStorage';

function readyEnvelope() {
  const result = readUserData();
  if (result.status !== 'ready') throw new Error(`expected ready, got ${result.status}`);
  return result.envelope;
}

beforeEach(() => {
  localStorage.clear();
});

describe('versioned user storage', () => {
  it('stores user data in a schema-versioned envelope', () => {
    const data = createEmptyUserData();
    data.preferences.petName = '小蹦';

    const stored = writeUserData(data, 0);

    expect(stored.schemaVersion).toBe(2);
    expect(stored.revision).toBe(1);
    expect(readyEnvelope().data.preferences.petName).toBe('小蹦');
  });

  it('treats a missing key as a fresh start, not damage', () => {
    const result = readUserData();
    expect(result.status).toBe('ready');
    expect(localStorage.getItem(USER_DATA_STORAGE_KEY)).not.toBeNull();
    if (result.status === 'ready') {
      expect(result.envelope.data.calendars).toMatchObject([
        { name: '我的日曆', isDefault: true },
      ]);
    }
  });

  it('migrates the retained v1 fixture to v2 and persists one stable default calendar', () => {
    localStorage.setItem(USER_DATA_STORAGE_KEY, JSON.stringify(v1Fixture));

    const first = readyEnvelope();
    const second = readyEnvelope();
    const calendarId = first.data.calendars[0]!.id;

    expect(first.schemaVersion).toBe(2);
    expect(second.data.calendars[0]!.id).toBe(calendarId);
    expect(first.revision).toBe(7);
    expect(first.data.events.every((event) => event.calendarId === calendarId)).toBe(true);
    expect(first.data.todos.every((todo) => todo.calendarId === calendarId)).toBe(true);
    expect(first.data.preferences).toMatchObject({
      timezone: 'Asia/Taipei',
      weekStartsOn: 1,
      theme: 'dark',
      petName: '小蹦',
    });

    const timed = first.data.events.find((event) => !event.allDay);
    expect(timed).toMatchObject({
      allDay: false,
      startsAt: '2026-08-03T15:30:00.000Z',
      endsAt: '2026-08-03T16:30:00.000Z',
      timezone: 'Asia/Taipei',
    });
    expect(first.data.events.find((event) => event.allDay)).toMatchObject({
      startDate: '2026-08-05',
      endDate: '2026-08-05',
    });
    expect(first.data.todos[0]?.completedAt).toBe('2026-08-04T03:00:00.000Z');
  });

  it('never removes unrelated or legacy localStorage data', () => {
    localStorage.setItem(LEGACY_USER_DATA_STORAGE_KEY, '{"events":[{"id":"legacy"}]}');
    localStorage.setItem('another.app.setting', 'keep-me');

    writeUserData(createEmptyUserData(), 0);

    expect(localStorage.getItem(USER_DATA_STORAGE_KEY)).not.toBeNull();
    expect(localStorage.getItem(LEGACY_USER_DATA_STORAGE_KEY)).toContain('legacy');
    expect(localStorage.getItem('another.app.setting')).toBe('keep-me');
  });
});

describe('unreadable data', () => {
  it('reports unparseable JSON as corrupt instead of returning empty data', () => {
    localStorage.setItem(USER_DATA_STORAGE_KEY, 'not-json');

    const result = readUserData();

    expect(result.status).toBe('corrupt');
    expect(result).toMatchObject({ raw: 'not-json' });
  });

  it('reports a valid JSON object with the wrong shape as corrupt', () => {
    localStorage.setItem(USER_DATA_STORAGE_KEY, '{"hello":"world"}');
    expect(readUserData().status).toBe('corrupt');
  });

  it('reports a newer schema as future rather than swallowing the error', () => {
    localStorage.setItem(
      USER_DATA_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 99,
        revision: 3,
        updatedAt: new Date().toISOString(),
        data: createEmptyUserData(),
      }),
    );

    const result = readUserData();

    expect(result.status).toBe('future');
    expect(result).toMatchObject({ schemaVersion: 99 });
  });
});

describe('backup and reset', () => {
  it('refuses to reset before a backup exists', () => {
    localStorage.setItem(USER_DATA_STORAGE_KEY, 'not-json');
    expect(() => resetUserData()).toThrow(/尚未備份/);
    expect(localStorage.getItem(USER_DATA_STORAGE_KEY)).toBe('not-json');
  });

  it('resets once the original bytes have been copied aside', () => {
    localStorage.setItem(USER_DATA_STORAGE_KEY, 'not-json');

    const key = backupRawUserData('not-json');
    resetUserData();

    expect(localStorage.getItem(key)).toBe('not-json');
    expect(readUserData().status).toBe('ready');
  });

  it('keeps every backup instead of clobbering an earlier one', () => {
    const first = backupRawUserData('first', localStorage, new Date(2026, 0, 1));
    const second = backupRawUserData('second', localStorage, new Date(2026, 0, 2));

    expect(first).not.toBe(second);
    expect(localStorage.getItem(first)).toBe('first');
    expect(localStorage.getItem(second)).toBe('second');
    expect(listUserDataBackups()).toEqual([first, second]);
  });
});

// The repository contract is async (DP-013) so one interface can cover both
// the local and the Supabase adapter. The guarantees asserted here are the
// DP-016 ones and are unchanged: refuse the write, leave the bytes alone.
describe('repository write barrier', () => {
  it('refuses to overwrite malformed data on the next mutation', async () => {
    localStorage.setItem(USER_DATA_STORAGE_KEY, 'not-json');
    const repository = new LocalDayPopRepository();

    await expect(
      repository.addEvent({
        title: '會議',
        date: '2026-08-06',
        allDay: false,
        start: '09:00',
        end: '10:00',
      }),
    ).rejects.toThrow(LocalDataBlockedError);

    expect(localStorage.getItem(USER_DATA_STORAGE_KEY)).toBe('not-json');
  });

  it('refuses to overwrite data written by a newer schema', async () => {
    const raw = JSON.stringify({
      schemaVersion: 99,
      revision: 3,
      updatedAt: new Date().toISOString(),
      data: createEmptyUserData(),
    });
    localStorage.setItem(USER_DATA_STORAGE_KEY, raw);
    const repository = new LocalDayPopRepository();

    await expect(repository.addTodo({ title: '買菜', date: '2026-08-06' })).rejects.toThrow(
      LocalDataBlockedError,
    );
    await expect(repository.load()).rejects.toThrow(LocalDataBlockedError);
    // The synchronous first-paint read must fail closed in exactly the same way.
    expect(() => repository.loadSync()).toThrow(LocalDataBlockedError);
    expect(localStorage.getItem(USER_DATA_STORAGE_KEY)).toBe(raw);
  });

  it('blocks even when the session started with readable data', async () => {
    const repository = new LocalDayPopRepository();
    await repository.addTodo({ title: '第一筆', date: '2026-08-06' });

    // Something outside this tab damaged the key mid-session.
    localStorage.setItem(USER_DATA_STORAGE_KEY, '{{{');

    await expect(repository.addTodo({ title: '第二筆', date: '2026-08-06' })).rejects.toThrow(
      LocalDataBlockedError,
    );
    expect(localStorage.getItem(USER_DATA_STORAGE_KEY)).toBe('{{{');
  });

  it('still writes normally when the data is readable', async () => {
    const repository = new LocalDayPopRepository();
    const next = await repository.addTodo({ title: '買菜', date: '2026-08-06' });

    expect(next.todos).toHaveLength(1);
    expect(readyEnvelope().data.todos[0]?.title).toBe('買菜');
    expect(readyEnvelope().data.todos[0]?.calendarId).toBe(
      readyEnvelope().data.calendars[0]?.id,
    );
  });
});
