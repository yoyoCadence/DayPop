import { describe, expect, it } from 'vitest';
import { applyImportCommand, buildJsonBackup, planJsonImport } from '../domain/dataTransfer';
import { createEventFromInput, createTodoFromInput } from '../domain/mutations';
import { createEmptyUserData } from '../domain/types';
import { parseCalendarEvent, parseDayPopUserData, parseTodo } from '../domain/validation';
import { MemoryStorage } from './browserStorage';
import { LocalDataBlockedError, LocalDayPopRepository } from './localRepository';
import { USER_DATA_STORAGE_KEY, readUserData, writeUserData } from './versionedStorage';
import { accountCacheKey, readAccountCache } from './accountCache';
import v1 from './fixtures/user-data-v1.json';
import v2 from './fixtures/user-data-v2.json';

const NOW = '2026-10-04T00:00:00.000Z';
const long = '字'.repeat(301);
function fixture() {
  const data = createEmptyUserData({ now: NOW });
  data.events = [createEventFromInput(data, { title: '行程', date: '2026-10-04', allDay: true, start: '09:00', end: '10:00' }, { id: crypto.randomUUID(), now: NOW })];
  data.todos = [createTodoFromInput(data, { title: '待辦', date: '2026-10-04' }, { id: crypto.randomUUID(), now: NOW })];
  return data;
}
function stored(data = fixture()) {
  const storage = new MemoryStorage();
  storage.setItem(USER_DATA_STORAGE_KEY, JSON.stringify({ schemaVersion: 4, revision: 7, updatedAt: NOW, data }));
  return storage;
}

describe('title limits and pre-existing guest titles (DP-125)', () => {
  it.each(['{broken', JSON.stringify({ schemaVersion: 5 })])('keeps the write barrier ahead of title refusal', async (raw) => {
    const storage = new MemoryStorage();
    storage.setItem(USER_DATA_STORAGE_KEY, raw);
    await expect(new LocalDayPopRepository(storage).addTodo({ title: long, date: '2026-10-04' })).rejects.toBeInstanceOf(LocalDataBlockedError);
    expect(storage.getItem(USER_DATA_STORAGE_KEY)).toBe(raw);
  });
  it.each(['字', '😀'])('accepts 300 %s code points and rejects 301 in entities and documents', (character) => {
    const data = fixture();
    for (const item of [...data.events, ...data.todos]) item.title = character.repeat(300);
    expect(parseDayPopUserData(data)).toEqual(data);
    for (const item of [...data.events, ...data.todos]) item.title += character;
    expect(() => parseCalendarEvent(data.events[0])).toThrow('at most 300');
    expect(() => parseTodo(data.todos[0])).toThrow('at most 300');
    expect(() => parseDayPopUserData(data)).toThrow('at most 300');
  });
  it('reads old long titles without changing bytes; unrelated writes and shortening one retain the others', async () => {
    const data = fixture();
    data.events[0]!.title = long;
    data.todos[0]!.title = long;
    const storage = stored(data);
    const raw = storage.getItem(USER_DATA_STORAGE_KEY);
    const repository = new LocalDayPopRepository(storage);
    expect(await repository.load()).toEqual(data);
    expect(storage.getItem(USER_DATA_STORAGE_KEY)).toBe(raw);
    await repository.toggleTodo(data.todos[0]!.id);
    await repository.updateEvent(data.events[0]!.id, { location: '會議室' });
    await repository.addTodo({ title: '新待辦', date: '2026-10-04' });
    const saved = await repository.renameTodo(data.todos[0]!.id, '縮短');
    expect(saved.events[0]!.title).toBe(long);
    expect(saved.todos[0]!.title).toBe('縮短');
    expect(await repository.load()).toEqual(saved);
    expect(buildJsonBackup(saved).data.events[0]!.title).toBe(long);
    expect(() => planJsonImport(JSON.stringify(buildJsonBackup(saved)), saved)).toThrow('300');
    await repository.updateEvent(data.events[0]!.id, { title: '行程縮短' });
    expect(parseDayPopUserData(await repository.load()).events[0]!.title).toBe('行程縮短');
  });
  it('cannot use an existing long title to admit a new row or changed title', () => {
    const data = fixture();
    data.todos[0]!.title = long;
    const storage = stored(data);
    const raw = storage.getItem(USER_DATA_STORAGE_KEY);
    expect(() => writeUserData({ ...data, todos: [{ ...data.todos[0]!, id: crypto.randomUUID() }] }, 7, storage)).toThrow('300');
    expect(() => writeUserData({ ...data, todos: [{ ...data.todos[0]!, title: long + '改' }] }, 7, storage)).toThrow('300');
    expect(storage.getItem(USER_DATA_STORAGE_KEY)).toBe(raw);
  });
  it('allows ICS append beside an unchanged long title but refuses incoming long titles', () => {
    const current = fixture();
    current.todos[0]!.title = long;
    const incoming = fixture().events;
    incoming[0]!.calendarId = current.calendars[0]!.id;
    expect(applyImportCommand(current, { kind: 'appendIcs', events: incoming, eventExceptions: [] }).todos).toEqual(current.todos);
    incoming[0]!.title = long;
    expect(() => applyImportCommand(current, { kind: 'appendIcs', events: incoming, eventExceptions: [] })).toThrow('300');
    expect(() => applyImportCommand(current, { kind: 'replace', data: current })).toThrow('300');
  });
  it.each([v1, v2])('preserves long titles through schema $schemaVersion migration', (source) => {
    const envelope = structuredClone(source);
    if (source.schemaVersion === 2) {
      const rows = fixture();
      const calendarId = v2.data.calendars[0]!.id;
      Object.assign(envelope.data, {
        events: rows.events.map(item => ({ ...item, calendarId })),
        todos: rows.todos.map(item => ({ ...item, calendarId })),
      });
    }
    envelope.data.events[0]!.title = long;
    envelope.data.todos[0]!.title = long;
    const storage = new MemoryStorage();
    storage.setItem(USER_DATA_STORAGE_KEY, JSON.stringify(envelope));
    const result = readUserData(storage);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('migration failed');
    expect(result.envelope.data.events[0]!.title).toBe(long);
    expect(result.envelope.data.todos[0]!.title).toBe(long);
  });
  it('preserves v3 guest titles but rejects overlong account cache titles including v3', () => {
    const data = fixture();
    data.todos[0]!.title = long;
    const storage = stored(data);
    const v3 = { schemaVersion: 3, revision: 7, updatedAt: NOW, data: { ...data, eventAttachments: undefined } };
    storage.setItem(USER_DATA_STORAGE_KEY, JSON.stringify(v3));
    expect(readUserData(storage).status).toBe('ready');
    for (const schemaVersion of [3, 4]) {
      storage.setItem(accountCacheKey('owner'), JSON.stringify({ ...v3, schemaVersion, accountId: 'owner', data: schemaVersion === 4 ? data : v3.data }));
      expect(readAccountCache('owner', storage)).toMatchObject({ status: 'corrupt', reason: expect.stringContaining('300') });
    }
  });
});
