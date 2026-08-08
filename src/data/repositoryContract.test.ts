import { beforeEach, describe, expect, it } from 'vitest';
import type { DayPopUserData } from '../domain/types';
import { MemoryStorage } from '../storage/browserStorage';
import { LocalDayPopRepository } from '../storage/localRepository';
import { FakeSupabase, type FakeRow } from '../test/fakeSupabase';
import type { DayPopRepository } from './repository';
import { SupabaseDayPopRepository } from './supabaseRepository';

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
  const repository = new SupabaseDayPopRepository(db.asClient(), OWNER);
  await repository.load();
  return repository;
}

const adapters = [
  ['guest local', localAdapter],
  ['authenticated Supabase', supabaseAdapter],
] as const;

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
