import { describe, expect, it } from 'vitest';
import {
  applyEventPatch,
  createCalendarFromInput,
  createEventFromInput,
  createStickerFromInput,
  resolveDefaultCalendarId,
  withCalendar,
  withEvent,
  withoutSticker,
  withSticker,
  withTodo,
} from './mutations';
import { createEmptyUserData, type CalendarEvent, type DayPopUserData } from './types';

const NOW = '2026-08-04T00:00:00.000Z';
const OTHER_CALENDAR = '66666666-6666-4666-8666-666666666666';

function baseData(): DayPopUserData {
  return createEmptyUserData({ now: NOW });
}

function timedEvent(data: DayPopUserData): CalendarEvent {
  return createEventFromInput(
    data,
    { title: '會議', date: '2026-08-06', allDay: false, start: '09:00', end: '10:00' },
    { id: '77777777-7777-4777-8777-777777777777', now: NOW },
  );
}

/**
 * A four-day all-day event. Nothing in the UI creates one yet, but the domain
 * contract allows it — `endDate` is inclusive — and the Supabase adapter will
 * read exactly this shape back out of `events` (DP-026).
 */
function multiDayEvent(): CalendarEvent {
  const event = createEventFromInput(
    baseData(),
    { title: '出差', date: '2026-08-06', allDay: true, start: '', end: '' },
    { id: '77777777-7777-4777-8777-777777777777', now: NOW },
  );
  return { ...event, allDay: true, startDate: '2026-08-06', endDate: '2026-08-09' };
}

describe('resolveDefaultCalendarId', () => {
  it('prefers the flagged default over the first calendar', () => {
    const data = baseData();
    const [first] = data.calendars;
    data.calendars = [
      { ...first!, id: OTHER_CALENDAR, isDefault: false, sortOrder: 0 },
      { ...first!, isDefault: true, sortOrder: 1 },
    ];

    expect(resolveDefaultCalendarId(data)).toBe(first!.id);
  });

  it('refuses to invent a calendar when there is none', () => {
    const data = { ...baseData(), calendars: [] };

    expect(() => resolveDefaultCalendarId(data)).toThrow('缺少預設日曆');
  });
});

describe('createEventFromInput', () => {
  it('honours an explicit calendar instead of the default', () => {
    const data = baseData();

    const event = createEventFromInput(
      data,
      {
        title: '會議',
        date: '2026-08-06',
        allDay: true,
        start: '',
        end: '',
        calendarId: OTHER_CALENDAR,
      },
      { id: '88888888-8888-4888-8888-888888888888', now: NOW },
    );

    expect(event.calendarId).toBe(OTHER_CALENDAR);
  });
});

describe('optional text fields', () => {
  it('stores a blank location and notes as null, not as an empty string', () => {
    const data = baseData();
    const event = createEventFromInput(
      data,
      {
        title: '會議',
        date: '2026-08-06',
        allDay: true,
        start: '',
        end: '',
        location: '   ',
        notes: '',
      },
      { id: '77777777-7777-4777-8777-777777777777', now: NOW },
    );

    expect(event.location).toBeNull();
    expect(event.notes).toBeNull();
  });

  it('trims location and notes when they have content', () => {
    const data = baseData();
    const event = createEventFromInput(
      data,
      {
        title: '會議',
        date: '2026-08-06',
        allDay: true,
        start: '',
        end: '',
        location: '  會議室A  ',
        notes: '  帶筆電  ',
      },
      { id: '77777777-7777-4777-8777-777777777777', now: NOW },
    );

    expect(event.location).toBe('會議室A');
    expect(event.notes).toBe('帶筆電');
  });

  it('leaves untouched fields alone but lets an empty patch clear them', () => {
    const data = baseData();
    const event = createEventFromInput(
      data,
      {
        title: '會議',
        date: '2026-08-06',
        allDay: true,
        start: '',
        end: '',
        location: '會議室A',
        notes: '帶筆電',
      },
      { id: '77777777-7777-4777-8777-777777777777', now: NOW },
    );

    // Absent key = unchanged.
    expect(applyEventPatch(event, { title: '改名' }, 'Asia/Taipei', NOW).location).toBe('會議室A');
    // Present but empty = cleared.
    expect(applyEventPatch(event, { location: '' }, 'Asia/Taipei', NOW).location).toBeNull();
  });

  it('moves an event to another calendar', () => {
    const data = baseData();
    const event = timedEvent(data);

    expect(applyEventPatch(event, { calendarId: OTHER_CALENDAR }, 'Asia/Taipei', NOW).calendarId).toBe(
      OTHER_CALENDAR,
    );
  });
});

describe('applyEventPatch', () => {
  it('keeps createdAt and only moves updatedAt', () => {
    const data = baseData();
    const event = timedEvent(data);

    const patched = applyEventPatch(event, { title: '改名' }, 'Asia/Taipei', '2026-08-05T00:00:00.000Z');

    expect(patched.createdAt).toBe(NOW);
    expect(patched.updatedAt).toBe('2026-08-05T00:00:00.000Z');
  });

  it('converts a timed event to all-day and back', () => {
    const data = baseData();
    const event = timedEvent(data);

    const allDay = applyEventPatch(event, { allDay: true }, 'Asia/Taipei', NOW);
    expect(allDay).toMatchObject({ allDay: true, startDate: '2026-08-06', endDate: '2026-08-06' });

    // Coming back from all-day there is no timezone left on the event, so the
    // preference timezone is what the wall time is re-anchored to.
    const timed = applyEventPatch(
      allDay,
      { allDay: false, start: '09:00', end: '10:00' },
      'Asia/Taipei',
      NOW,
    );
    expect(timed).toMatchObject({
      allDay: false,
      startsAt: '2026-08-06T01:00:00.000Z',
      timezone: 'Asia/Taipei',
    });
  });

  // Regression: deriving both ends from one date turned a multi-day all-day
  // event into a single day on any edit that never asked to shorten it.
  it('keeps the length of a multi-day all-day event when something else changes', () => {
    const renamed = applyEventPatch(multiDayEvent(), { title: '出差（改）' }, 'Asia/Taipei', NOW);

    expect(renamed).toMatchObject({ startDate: '2026-08-06', endDate: '2026-08-09' });
  });

  it('moves both ends of a multi-day all-day event together', () => {
    const moved = applyEventPatch(multiDayEvent(), { date: '2026-09-01' }, 'Asia/Taipei', NOW);

    // The span is three days either side of the move, not a collapsed single day.
    expect(moved).toMatchObject({ startDate: '2026-09-01', endDate: '2026-09-04' });
  });

  it('still creates a single day when a timed event becomes all-day', () => {
    const data = baseData();

    const allDay = applyEventPatch(timedEvent(data), { allDay: true }, 'Asia/Taipei', NOW);

    expect(allDay).toMatchObject({ startDate: '2026-08-06', endDate: '2026-08-06' });
  });
});

describe('sortOrder', () => {
  // Regression: deriving the next key from `.length` hands out a value that is
  // still in use as soon as anything has been deleted.
  it('does not reuse a live sticker sortOrder after a delete', () => {
    let data = baseData();
    const date = '2026-08-06';
    const make = (id: string, glyph: string) =>
      createStickerFromInput(data, { date, glyph }, { id, now: NOW });

    data = withSticker(data, make('11111111-1111-4111-8111-111111111111', '🎂'));
    data = withSticker(data, make('22222222-2222-4222-8222-222222222222', '✈️'));
    data = withoutSticker(data, '11111111-1111-4111-8111-111111111111');
    data = withSticker(data, make('33333333-3333-4333-8333-333333333333', '❤️'));

    const orders = data.stickers.map((sticker) => sticker.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('does not reuse a live calendar sortOrder after a delete', () => {
    let data = baseData();
    const make = (id: string, name: string) =>
      createCalendarFromInput(data, { name, color: '#2563eb' }, { id, now: NOW });

    data = withCalendar(data, make('11111111-1111-4111-8111-111111111111', 'A'));
    data = withCalendar(data, make('22222222-2222-4222-8222-222222222222', 'B'));
    data = {
      ...data,
      calendars: data.calendars.filter(
        (calendar) => calendar.id !== '11111111-1111-4111-8111-111111111111',
      ),
    };
    data = withCalendar(data, make('33333333-3333-4333-8333-333333333333', 'C'));

    const orders = data.calendars.map((calendar) => calendar.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });
});

describe('document helpers', () => {
  it('replaces an event in place instead of appending a duplicate', () => {
    const data = baseData();
    const event = timedEvent(data);
    const withOne = withEvent(withEvent(data, event), { ...event, title: '改過的' });

    expect(withOne.events).toHaveLength(1);
    expect(withOne.events[0]?.title).toBe('改過的');
  });

  it('appends a todo that is not there yet', () => {
    const data = baseData();
    const todo = {
      id: '99999999-9999-4999-8999-999999999999',
      calendarId: data.calendars[0]!.id,
      parentId: null,
      title: '買菜',
      dueDate: '2026-08-06',
      priority: 'none' as const,
      completedAt: null,
      sortOrder: 0,
      sharingScope: 'inherit' as const,
      createdAt: NOW,
      updatedAt: NOW,
    };

    expect(withTodo(data, todo).todos).toHaveLength(1);
    expect(withTodo(withTodo(data, todo), todo).todos).toHaveLength(1);
  });
});
