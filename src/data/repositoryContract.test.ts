import { beforeEach, describe, expect, it } from 'vitest';
import type { DayPopUserData, TimedCalendarEvent } from '../domain/types';
import { MemoryStorage } from '../storage/browserStorage';
import { LocalDayPopRepository } from '../storage/localRepository';
import { FakeSupabase, type FakeRow } from '../test/fakeSupabase';
import type { DayPopRepository } from './repository';
import { SupabaseDayPopRepository } from './supabaseRepository';
import { todoTree } from '../test/todoTree';

/**
 * The guest and authenticated adapters must be interchangeable behind
 * `DayPopRepository`, or DP-026 cannot swap one for the other without the
 * screens noticing. These run the same script against both and compare the
 * documents, with ids and timestamps normalised because those legitimately
 * differ between a client-generated document and a server-generated one.
 */

const OWNER = '11111111-1111-4111-8111-111111111111';
const CALENDAR = '33333333-3333-4333-8333-333333333333';

async function localAdapter(): Promise<DayPopRepository> {
  const repository = new LocalDayPopRepository(new MemoryStorage());
  await repository.load();
  return repository;
}

async function supabaseAdapter(): Promise<DayPopRepository> {
  const db = new FakeSupabase();
  const calendar: FakeRow = {
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
  db.seed('calendars', [calendar]);
  db.seed('user_preferences', [
    {
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
    },
  ]);
  const repository = new SupabaseDayPopRepository(db.asClient(), OWNER);
  await repository.load();
  return repository;
}

const adapters = [
  ['guest local', localAdapter],
  ['authenticated Supabase', supabaseAdapter],
] as const;

describe.each(adapters)('%s adapter all-day date ranges (DP-127)', (_name, create) => {
  it('creates, extends, moves and shortens a range through durable reload', async () => {
    const repository = await create();
    const event = (await repository.addEvent({ title: '春假', date: '2026-03-07', endDate: '2026-03-10', allDay: true, start: '', end: '', location: '家' })).events[0]!;
    expect((await repository.load()).events).toEqual([event]);
    await repository.updateEvent(event.id, { endDate: '2026-03-12' });
    expect((await repository.load()).events[0]).toMatchObject({ startDate: '2026-03-07', endDate: '2026-03-12', location: '家' });
    await repository.updateEvent(event.id, { date: '2026-03-09' });
    expect((await repository.load()).events[0]).toMatchObject({ startDate: '2026-03-09', endDate: '2026-03-14' });
    await repository.updateEvent(event.id, { endDate: '2026-03-09' });
    expect((await repository.load()).events[0]).toMatchObject({ startDate: '2026-03-09', endDate: '2026-03-09' });
    const before = await repository.load();
    await expect(repository.updateEvent(event.id, { endDate: '2026-03-08' })).rejects.toThrow('不能早於');
    await expect(repository.addEvent({ title: '拒絕', date: '2026-03-09', endDate: '', allDay: true, start: '', end: '' })).rejects.toThrow();
    expect(await repository.load()).toEqual(before);
  });
  it('extends one occurrence while keeping the series and every other occurrence unchanged', async () => {
    const repository = await create();
    const event = (await repository.addEvent({ title: '週末', date: '2026-08-01', endDate: '2026-08-03', allDay: true, start: '', end: '', recurrenceRule: 'FREQ=WEEKLY;COUNT=3' })).events[0]!;
    const next = await repository.replaceEventOccurrence(event.id, { kind: 'all-day', date: '2026-08-08' }, { endDate: '2026-08-12' });
    expect(next.events.find((item) => item.id === event.id)).toEqual(event);
    expect(next.events.find((item) => item.id !== event.id)).toMatchObject({ startDate: '2026-08-08', endDate: '2026-08-12', recurrence: null });
    expect(await repository.load()).toEqual(next);
  });
});

describe.each(adapters)('%s adapter title limits (DP-125)', (_name, create) => {
  it('accepts 300 emoji and rejects 301 before changing durable data', async () => {
    const repository = await create();
    const title = '😀'.repeat(300);
    const todo = (await repository.addTodo({ title, date: '2026-10-04' })).todos[0]!;
    const event = (await repository.addEvent({ title, date: '2026-10-04', allDay: true, start: '09:00', end: '10:00' })).events[0]!;
    const before = await repository.load();
    await expect(repository.addTodo({ title: title + '😀', date: '2026-10-04' })).rejects.toThrow('最多 300');
    await expect(repository.renameTodo(todo.id, title + '😀')).rejects.toThrow('最多 300');
    await expect(repository.addEvent({ title: title + '😀', date: '2026-10-04', allDay: true, start: '09:00', end: '10:00' })).rejects.toThrow('最多 300');
    await expect(repository.updateEvent(event.id, { title: title + '😀' })).rejects.toThrow('最多 300');
    expect(await repository.load()).toEqual(before);
  });
});

describe.each(adapters)('%s adapter renames todos (DP-120)', (_name, create) => {
  it('renames parent and completed child without changing relationships through reload', async () => {
    const repository = await create();
    const parent = (await repository.addTodo({ title: '旅行', date: '2026-08-06' })).todos[0]!;
    const child = (await repository.addTodo({ title: '訂房', date: '2026-08-06', parentId: parent.id })).todos[1]!;
    const before = await repository.toggleTodo(child.id);
    await repository.renameTodo(parent.id, '  準備旅行  ');
    const saved = await repository.renameTodo(child.id, '  預訂飯店  ');
    expect(saved.todos).toEqual(
      before.todos.map((todo, index) => ({ ...todo, title: index === 0 ? '準備旅行' : '預訂飯店', updatedAt: saved.todos[index]!.updatedAt })),
    );
    expect(await repository.load()).toEqual(saved);
  });
  it('rejects blank titles and a queued-after-delete edit without durable changes', async () => {
    const repository = await create();
    const todo = (await repository.addTodo({ title: '保留', date: '2026-08-06' })).todos[0]!;
    const before = await repository.load();
    await expect(repository.renameTodo(todo.id, '  ')).rejects.toThrow('不能空白');
    expect(await repository.load()).toEqual(before);
    const afterDelete = await repository.deleteTodo(todo.id);
    await expect(repository.renameTodo(todo.id, '不能復活')).rejects.toThrow('找不到待辦');
    expect(await repository.load()).toEqual(afterDelete);
  });
});

describe.each(adapters)('%s adapter creates subtasks (DP-116)', (_name, create) => {
  let repository: DayPopRepository;
  let parentId: string;
  beforeEach(async () => {
    repository = await create();
    const data = await repository.addTodo({ title: '準備旅行', date: '2026-08-06' });
    parentId = data.todos[0]!.id;
  });
  it('persists a child with inherited date/calendar through reload', async () => {
    const data = await repository.addTodo({ title: '  訂房  ', date: '2026-08-20', parentId });
    expect(data.todos[1]).toMatchObject({ title: '訂房', parentId, dueDate: '2026-08-06', calendarId: data.todos[0]!.calendarId, completedAt: null });
    expect(await repository.load()).toEqual(data);
  });
  it('keeps parent and child completion independent', async () => {
    const child = (await repository.addTodo({ title: '訂房', date: '2026-08-06', parentId })).todos[1]!;
    let data = await repository.toggleTodo(child.id);
    expect(data.todos[0]!.completedAt).toBeNull();
    expect(data.todos[1]!.completedAt).not.toBeNull();
    data = await repository.toggleTodo(parentId);
    expect(data.todos[0]!.completedAt).not.toBeNull();
    expect(data.todos[1]!.completedAt).not.toBeNull();
    data = await repository.toggleTodo(child.id);
    expect(data.todos[0]!.completedAt).not.toBeNull();
    expect(data.todos[1]!.completedAt).toBeNull();
    expect(await repository.load()).toEqual(data);
  });
  it('refuses missing, nested and cross-calendar parents without durable writes', async () => {
    const child = (await repository.addTodo({ title: '訂房', date: '2026-08-06', parentId })).todos[1]!;
    const before = await repository.load();
    await expect(repository.addTodo({ title: '拒絕', date: '2026-08-06', parentId: '11600000-0000-4000-8000-000000000099' })).rejects.toThrow('父待辦');
    await expect(repository.addTodo({ title: '拒絕', date: '2026-08-06', parentId: child.id })).rejects.toThrow('子項不能');
    await expect(repository.addTodo({ title: '拒絕', date: '2026-08-06', parentId, calendarId: '11600000-0000-4000-8000-000000000098' })).rejects.toThrow('同一日曆');
    expect(await repository.load()).toEqual(before);
  });
});

describe.each(adapters)('%s adapter deletes todo descendants (DP-115)', (_name, create) => {
  let repository: DayPopRepository;
  let before: DayPopUserData;
  beforeEach(async () => {
    repository = await create();
    const data = await repository.load();
    before = await repository.importData({ kind: 'replace', data: {
      calendars: data.calendars, events: [], eventExceptions: [], stickers: [],
      preferences: data.preferences, todos: todoTree(data.calendars[0]!.id),
    } });
  });

  it('deleting the root removes children from the returned document and durable reload', async () => {
    const next = await repository.deleteTodo('11500000-0000-4000-8000-000000000001');
    expect(next.todos).toEqual([before.todos.find((todo) => todo.title === '保留待辦')]);
    expect(await repository.load()).toEqual(next);
  });

  it('deleting an intermediate node preserves its parent, sibling, and unrelated row', async () => {
    const next = await repository.deleteTodo('11500000-0000-4000-8000-000000000002');
    expect(next.todos.map((todo) => todo.title).sort()).toEqual(['保留待辦', '已完成子項', '父待辦'].sort());
    expect(await repository.load()).toEqual(next);
  });
});

describe.each(adapters)('%s adapter preserves multi-day timed data (DP-112)', (_name, create) => {
  let repository: DayPopRepository;
  let imported: TimedCalendarEvent;
  beforeEach(async () => {
    repository = await create();
    const data = await repository.load();
    const event: TimedCalendarEvent = {
      id: '11200000-0000-4000-8000-000000000001', calendarId: data.calendars[0]!.id,
      title: '多日會議', allDay: false, startsAt: '2026-08-06T01:00:13.000Z', endsAt: '2026-08-08T02:00:37.000Z',
      timezone: 'Asia/Taipei', location: null, notes: null, reminderMinutes: [], recurrence: null,
      sharingScope: 'inherit', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    };
    const saved = await repository.importData({ kind: 'appendIcs', events: [event], eventExceptions: [] });
    const loaded = saved.events[0]!;
    if (loaded.allDay) throw new Error('expected imported timed fixture');
    imported = loaded;
  });

  it('persists a complete dragged interval through reload (DP-072)', async () => {
    const timedInterval = { startsAt: '2026-08-07T14:00:00.000Z', endsAt: '2026-08-10T15:00:00.000Z' };
    await repository.updateEvent(imported.id, { timedInterval });
    expect((await repository.load()).events[0]).toMatchObject({ ...timedInterval, timezone: imported.timezone });
  });
  it('rejects a reversed interval without altering durable rows (DP-072)', async () => {
    const before = await repository.load();
    await expect(repository.updateEvent(imported.id, { timedInterval: {
      startsAt: imported.endsAt, endsAt: imported.startsAt,
    } })).rejects.toThrow();
    expect(await repository.load()).toEqual(before);
  });
  it('replaces one occurrence with a full interval without changing the base (DP-072)', async () => {
    await repository.updateEvent(imported.id, { recurrenceRule: 'FREQ=DAILY;COUNT=3' });
    const timedInterval = { startsAt: '2026-08-07T14:00:00.000Z', endsAt: '2026-08-10T15:00:00.000Z' };
    await repository.replaceEventOccurrence(imported.id, { kind: 'timed', startsAt: '2026-08-07T01:00:00.000Z' }, { timedInterval });
    const data = await repository.load();
    expect(data.events.find((event) => event.id === imported.id)).toMatchObject({ startsAt: imported.startsAt, endsAt: imported.endsAt });
    expect(data.events.find((event) => event.id !== imported.id)).toMatchObject({ ...timedInterval, recurrence: null, timezone: imported.timezone });
    expect(data.eventExceptions).toHaveLength(1);
  });
  it('persists a rename with its original multi-day endpoints and seconds', async () => {
    await repository.updateEvent(imported.id, { title: '改名', date: '2026-08-06', start: '09:00', end: '10:00' });
    expect((await repository.load()).events[0]).toMatchObject({ title: '改名', startsAt: imported.startsAt, endsAt: imported.endsAt });
  });

  it('persists shifted dates and a reanchored timezone without dropping extra days', async () => {
    await repository.updateEvent(imported.id, { date: '2026-08-07', timezone: 'UTC', start: '09:00', end: '10:00' });
    expect((await repository.load()).events[0]).toMatchObject({
      startsAt: '2026-08-07T09:00:00.000Z', endsAt: '2026-08-09T10:00:00.000Z', timezone: 'UTC',
    });
  });

  it('replaces one multi-day occurrence without shortening it or rewriting the series', async () => {
    await repository.updateEvent(imported.id, { recurrenceRule: 'FREQ=DAILY;COUNT=3' });
    await repository.replaceEventOccurrence(imported.id, { kind: 'timed', startsAt: '2026-08-07T01:00:00.000Z' }, { title: '這次改名' });
    const data = await repository.load();
    expect(data.events.find((event) => event.id === imported.id)).toMatchObject({ startsAt: imported.startsAt, endsAt: imported.endsAt });
    const replacement = data.events.find((event) => event.title === '這次改名');
    // Recurrence expansion already resolves minute wall clocks (DP-027).
    // Preserve that concrete occurrence's 49-hour span and the exact base row.
    expect(replacement).toMatchObject({ startsAt: '2026-08-07T01:00:00.000Z', endsAt: '2026-08-09T02:00:00.000Z', recurrence: null });
    expect(data.eventExceptions).toHaveLength(1);
    expect(data.eventExceptions[0]!.replacementEventId).toBe(replacement!.id);
  });

  it('keeps a later DST fold instant after an untouched-clock save and reload', async () => {
    const event = { ...imported, id: '11200000-0000-4000-8000-000000000002', timezone: 'America/New_York',
      startsAt: '2026-11-01T06:15:00.000Z', endsAt: '2026-11-01T06:45:00.000Z' };
    await repository.importData({ kind: 'appendIcs', events: [event], eventExceptions: [] });
    const saved = (await repository.load()).events[1]!;
    await repository.updateEvent(saved.id, { title: '改名', date: '2026-11-01', start: '01:15', end: '01:45' });
    expect((await repository.load()).events[1]).toMatchObject({ startsAt: event.startsAt, endsAt: event.endsAt, timezone: event.timezone });
  });
});

/** Keeps what the contract promises and drops what is allowed to differ. */
function shape(data: DayPopUserData) {
  return {
    calendarCount: data.calendars.length,
    events: data.events.map((event) => ({
      title: event.title,
      allDay: event.allDay,
      ...(event.allDay
        ? { startDate: event.startDate, endDate: event.endDate }
        : { startsAt: event.startsAt, endsAt: event.endsAt, timezone: event.timezone }),
      reminderMinutes: event.reminderMinutes,
      recurrence: event.recurrence,
      sharingScope: event.sharingScope,
    })),
    todos: data.todos.map((todo) => ({
      title: todo.title,
      dueDate: todo.dueDate,
      priority: todo.priority,
      completed: todo.completedAt !== null,
      sortOrder: todo.sortOrder,
      parentId: todo.parentId,
    })),
    stickers: data.stickers.map((sticker) => ({
      date: sticker.date,
      glyph: sticker.glyph,
      assetKey: sticker.assetKey,
      sortOrder: sticker.sortOrder,
    })),
  };
}

/** Calendars are compared separately so the existing shape assertions stay short. */
function calendarShape(data: DayPopUserData) {
  return data.calendars.map((calendar) => ({
    name: calendar.name,
    color: calendar.color,
    isVisible: calendar.isVisible,
    isDefault: calendar.isDefault,
  }));
}

describe.each(adapters)('%s adapter honours the shared contract', (_name, create) => {
  let repository: DayPopRepository;

  beforeEach(async () => {
    repository = await create();
  });

  it('creates a timed event on the default calendar', async () => {
    const data = await repository.addEvent({
      title: '  會議  ',
      date: '2026-08-06',
      allDay: false,
      start: '09:00',
      end: '10:00',
    });

    expect(shape(data)).toEqual({
      calendarCount: 1,
      events: [
        {
          title: '會議',
          allDay: false,
          startsAt: '2026-08-06T01:00:00.000Z',
          endsAt: '2026-08-06T02:00:00.000Z',
          timezone: 'Asia/Taipei',
          reminderMinutes: [],
          recurrence: null,
          sharingScope: 'inherit',
        },
      ],
      todos: [],
      stickers: [],
    });
  });

  it('creates an all-day event with an inclusive end date', async () => {
    const data = await repository.addEvent({
      title: '出遊',
      date: '2026-08-06',
      allDay: true,
      start: '',
      end: '',
    });

    expect(shape(data).events).toEqual([
      {
        title: '出遊',
        allDay: true,
        startDate: '2026-08-06',
        endDate: '2026-08-06',
        reminderMinutes: [],
        recurrence: null,
        sharingScope: 'inherit',
      },
    ]);
  });

  it('edits an event through the same patch shape', async () => {
    const created = await repository.addEvent({
      title: '會議',
      date: '2026-08-06',
      allDay: false,
      start: '09:00',
      end: '10:00',
    });
    const id = created.events[0]!.id;

    const data = await repository.updateEvent(id, {
      title: '延後的會議',
      start: '11:00',
      end: '12:00',
    });

    expect(shape(data).events[0]).toMatchObject({
      title: '延後的會議',
      startsAt: '2026-08-06T03:00:00.000Z',
      endsAt: '2026-08-06T04:00:00.000Z',
    });
  });

  it('rolls an end time past midnight the same way in both adapters', async () => {
    const created = await repository.addEvent({
      title: '會議',
      date: '2026-08-06',
      allDay: false,
      start: '09:00',
      end: '10:00',
    });
    const id = created.events[0]!.id;

    // Moving the start past the end must not produce an event that ends before
    // it begins: the domain rolls the end into the next day (DP-012).
    const data = await repository.updateEvent(id, { start: '11:00' });

    expect(shape(data).events[0]).toMatchObject({
      startsAt: '2026-08-06T03:00:00.000Z',
      endsAt: '2026-08-07T02:00:00.000Z',
    });
  });

  it('adds, toggles and deletes a todo', async () => {
    const created = await repository.addTodo({ title: ' 買菜 ', date: '2026-08-06' });
    expect(shape(created).todos).toEqual([
      {
        title: '買菜',
        dueDate: '2026-08-06',
        priority: 'none',
        completed: false,
        sortOrder: 0,
        parentId: null,
      },
    ]);

    const id = created.todos[0]!.id;
    expect(shape(await repository.toggleTodo(id)).todos[0]?.completed).toBe(true);
    expect(shape(await repository.toggleTodo(id)).todos[0]?.completed).toBe(false);
    expect(shape(await repository.deleteTodo(id)).todos).toEqual([]);
  });

  it('adds stickers to a day, numbering them per day', async () => {
    await repository.addSticker({ date: '2026-08-06', glyph: '🎂' });
    const data = await repository.addSticker({ date: '2026-08-06', glyph: '✈️' });
    const other = await repository.addSticker({ date: '2026-08-07', glyph: '❤️' });

    expect(shape(data).stickers).toEqual([
      { date: '2026-08-06', glyph: '🎂', assetKey: null, sortOrder: 0 },
      { date: '2026-08-06', glyph: '✈️', assetKey: null, sortOrder: 1 },
    ]);
    // A second day starts its own numbering rather than continuing the first.
    expect(shape(other).stickers.at(-1)).toEqual({
      date: '2026-08-07',
      glyph: '❤️',
      assetKey: null,
      sortOrder: 0,
    });
  });

  it('deletes a sticker without touching the others', async () => {
    const created = await repository.addSticker({ date: '2026-08-06', glyph: '🎂' });
    await repository.addSticker({ date: '2026-08-06', glyph: '✈️' });

    const data = await repository.deleteSticker(created.stickers[0]!.id);

    expect(shape(data).stickers).toEqual([
      { date: '2026-08-06', glyph: '✈️', assetKey: null, sortOrder: 1 },
    ]);
  });

  it('adds, renames and recolours a calendar', async () => {
    const added = await repository.addCalendar({ name: '  工作  ', color: '#2563eb' });

    expect(calendarShape(added)).toEqual([
      { name: '我的日曆', color: '#F06C5C', isVisible: true, isDefault: true },
      // Trimmed, visible, and never stealing the default flag.
      { name: '工作', color: '#2563eb', isVisible: true, isDefault: false },
    ]);

    const id = added.calendars[1]!.id;
    const renamed = await repository.updateCalendar(id, { name: '專案', color: '#16a34a' });
    expect(calendarShape(renamed)[1]).toMatchObject({ name: '專案', color: '#16a34a' });

    const hidden = await repository.updateCalendar(id, { isVisible: false });
    expect(calendarShape(hidden)[1]?.isVisible).toBe(false);
  });

  it('falls back to 未命名日曆 for a blank name', async () => {
    const data = await repository.addCalendar({ name: '   ', color: '#2563eb' });
    expect(calendarShape(data)[1]?.name).toBe('未命名日曆');
  });

  it('moves the rows of a deleted calendar to the surviving default', async () => {
    const added = await repository.addCalendar({ name: '工作', color: '#2563eb' });
    const target = added.calendars[1]!.id;
    await repository.addEvent({
      title: '工作會議',
      date: '2026-08-06',
      allDay: true,
      start: '',
      end: '',
      calendarId: target,
    });
    await repository.addTodo({ title: '工作待辦', date: '2026-08-06', calendarId: target });

    const data = await repository.deleteCalendar(target);

    expect(calendarShape(data)).toEqual([
      { name: '我的日曆', color: '#F06C5C', isVisible: true, isDefault: true },
    ]);
    // Nothing is lost — the rows follow the surviving default calendar.
    expect(data.events).toHaveLength(1);
    expect(data.todos).toHaveLength(1);
    const survivor = data.calendars[0]!.id;
    expect(data.events[0]?.calendarId).toBe(survivor);
    expect(data.todos[0]?.calendarId).toBe(survivor);
  });

  it('promotes another calendar when the default one is deleted', async () => {
    const added = await repository.addCalendar({ name: '工作', color: '#2563eb' });
    const original = added.calendars[0]!.id;

    const data = await repository.deleteCalendar(original);

    expect(data.calendars).toHaveLength(1);
    expect(data.calendars[0]?.name).toBe('工作');
    // The contract requires exactly one default at all times.
    expect(data.calendars[0]?.isDefault).toBe(true);
  });

  it('refuses to delete the last calendar', async () => {
    const before = await repository.load();

    const data = await repository.deleteCalendar(before.calendars[0]!.id);

    expect(calendarShape(data)).toEqual(calendarShape(before));
  });

  it('persists visual, display-mode and month-grid preferences together', async () => {
    const data = await repository.updatePreferences({
      themeId: 'pixel',
      theme: 'dark',
      calendarGridMode: 'fixed-six',
    });

    expect(data.preferences).toMatchObject({
      themeId: 'pixel',
      theme: 'dark',
      calendarGridMode: 'fixed-six',
    });
  });

  it('treats editing a missing id as a no-op rather than an error', async () => {
    const before = shape(await repository.load());

    const afterEvent = await repository.updateEvent(CALENDAR, { title: '不存在' });
    const afterTodo = await repository.toggleTodo(CALENDAR);
    const afterDelete = await repository.deleteEvent(CALENDAR);
    const afterSticker = await repository.deleteSticker(CALENDAR);

    expect(shape(afterEvent)).toEqual(before);
    expect(shape(afterTodo)).toEqual(before);
    expect(shape(afterDelete)).toEqual(before);
    expect(shape(afterSticker)).toEqual(before);
  });

  it('returns the whole document from every write', async () => {
    await repository.addEvent({
      title: '會議',
      date: '2026-08-06',
      allDay: false,
      start: '09:00',
      end: '10:00',
    });
    const data = await repository.addTodo({ title: '買菜', date: '2026-08-06' });

    expect(data.events).toHaveLength(1);
    expect(data.todos).toHaveLength(1);
    expect(data.calendars).toHaveLength(1);
  });
});

/**
 * DP-082. The occurrence half of the contract, run against both adapters for
 * the same reason as everything above: the guest adapter rewrites one document
 * while the Supabase adapter writes two rows in a required order, and the
 * screens must not be able to tell which one they are talking to.
 */
describe.each(adapters)('%s adapter honours the occurrence contract', (_name, create) => {
  let repository: DayPopRepository;

  beforeEach(async () => {
    repository = await create();
  });

  /** A daily all-day series, so occurrences are plain date keys. */
  async function series(): Promise<string> {
    const created = await repository.addEvent({
      title: '站會',
      date: '2026-08-03',
      allDay: true,
      start: '',
      end: '',
      recurrenceRule: 'FREQ=DAILY;COUNT=5',
    });
    return created.events[0]!.id;
  }

  const dayOf = (data: DayPopUserData, title: string) =>
    data.events.filter((event) => event.title === title).map((event) =>
      event.allDay ? event.startDate : event.startsAt,
    );

  it('cancels one occurrence without touching the series', async () => {
    const id = await series();

    const data = await repository.cancelEventOccurrence(id, {
      kind: 'all-day',
      date: '2026-08-05',
    });

    expect(data.events).toHaveLength(1);
    expect(data.events[0]!.recurrence).toEqual({ rule: 'FREQ=DAILY;COUNT=5' });
    expect(data.eventExceptions).toEqual([
      expect.objectContaining({
        eventId: id,
        occurrence: { kind: 'all-day', date: '2026-08-05' },
        isCancelled: true,
        replacementEventId: null,
      }),
    ]);
  });

  it('cancelling the same occurrence twice reuses the one row', async () => {
    const id = await series();
    const occurrence = { kind: 'all-day' as const, date: '2026-08-05' };

    const first = await repository.cancelEventOccurrence(id, occurrence);
    const second = await repository.cancelEventOccurrence(id, occurrence);

    expect(second.eventExceptions).toHaveLength(1);
    expect(second.eventExceptions[0]!.id).toBe(first.eventExceptions[0]!.id);
  });

  it('replaces one occurrence with a standalone non-recurring event', async () => {
    const id = await series();

    const data = await repository.replaceEventOccurrence(
      id,
      { kind: 'all-day', date: '2026-08-05' },
      { title: '改期的站會', date: '2026-08-06' },
    );

    const replacementId = data.eventExceptions[0]!.replacementEventId;
    const replacement = data.events.find((event) => event.id === replacementId);
    expect(replacement).toMatchObject({ title: '改期的站會', recurrence: null });
    expect(dayOf(data, '改期的站會')).toEqual(['2026-08-06']);
    // The series itself keeps its rule and its own date.
    expect(data.events.find((event) => event.id === id)).toMatchObject({
      recurrence: { rule: 'FREQ=DAILY;COUNT=5' },
      startDate: '2026-08-03',
    });
    expect(data.eventExceptions[0]).toMatchObject({
      isCancelled: false,
      occurrence: { kind: 'all-day', date: '2026-08-05' },
    });
  });

  it('re-editing the same occurrence updates its replacement instead of adding one', async () => {
    const id = await series();
    const occurrence = { kind: 'all-day' as const, date: '2026-08-05' };

    const first = await repository.replaceEventOccurrence(id, occurrence, { title: '第一次' });
    const second = await repository.replaceEventOccurrence(id, occurrence, { title: '第二次' });

    expect(second.eventExceptions).toHaveLength(1);
    expect(second.eventExceptions[0]!.replacementEventId).toBe(
      first.eventExceptions[0]!.replacementEventId,
    );
    // One series + one replacement, not one series + two replacements.
    expect(second.events).toHaveLength(2);
    expect(dayOf(second, '第一次')).toEqual([]);
    expect(dayOf(second, '第二次')).toEqual(['2026-08-05']);
  });

  /**
   * Cancelling an occurrence that currently has a replacement has to drop that
   * replacement event, or the standalone copy outlives the cancellation.
   *
   * Asserted **after a reload**, not on the returned document, and that is not
   * belt-and-braces: both adapters build their reply from the pure domain
   * result, so every one of these cases would pass on a snapshot that the
   * durable store never actually received. Only a reload proves the rows
   * landed. (It does not, however, pin the Supabase adapter's write *order*
   * for this case — reversing those two still ends in the right state; see the
   * adapter's own comment for the partial-failure reason it keeps the order.)
   */
  it('cancelling an occurrence that was replaced drops the replacement event', async () => {
    const id = await series();
    const occurrence = { kind: 'all-day' as const, date: '2026-08-05' };
    await repository.replaceEventOccurrence(id, occurrence, { title: '改期的站會' });
    await repository.cancelEventOccurrence(id, occurrence);

    const data = await repository.load();

    expect(dayOf(data, '改期的站會')).toEqual([]);
    expect(data.events).toHaveLength(1);
    expect(data.eventExceptions).toEqual([
      expect.objectContaining({ isCancelled: true, replacementEventId: null }),
    ]);
  });

  it('treats an unknown or non-recurring event as a no-op, not an error', async () => {
    const plain = await repository.addEvent({
      title: '單次會議',
      date: '2026-08-06',
      allDay: true,
      start: '',
      end: '',
    });
    const plainId = plain.events[0]!.id;
    const occurrence = { kind: 'all-day' as const, date: '2026-08-06' };

    const afterUnknown = await repository.cancelEventOccurrence(CALENDAR, occurrence);
    const afterPlain = await repository.cancelEventOccurrence(plainId, occurrence);
    const afterReplace = await repository.replaceEventOccurrence(plainId, occurrence, {
      title: '不該套用',
    });

    for (const data of [afterUnknown, afterPlain, afterReplace]) {
      expect(data.eventExceptions).toEqual([]);
      expect(shape(data).events).toEqual(shape(plain).events);
    }
  });

  it('refuses an occurrence whose shape disagrees with the event', async () => {
    const id = await series();

    // The series is all-day, so a timed occurrence can only be a caller bug.
    await expect(
      repository.cancelEventOccurrence(id, {
        kind: 'timed',
        startsAt: '2026-08-05T01:00:00.000Z',
      }),
    ).rejects.toThrow();
  });
});
