import { describe, expect, it } from 'vitest';
import {
  CALENDAR_PALETTE,
  calendarColor,
  calendarSwatches,
  nextCalendarColor,
  sortedCalendars,
  visibleEvents,
  visibleOccurrences,
} from './calendars';
import { instantDateInZone } from './eventTime';
import { createEventFromInput } from './mutations';
import {
  createEmptyUserData,
  type Calendar,
  type CalendarEvent,
  type DayPopUserData,
} from './types';

const NOW = '2026-08-08T00:00:00.000Z';
const SECOND_CALENDAR = '66666666-6666-4666-8666-666666666666';

function withSecondCalendar(data: DayPopUserData, overrides: Partial<Calendar> = {}) {
  const first = data.calendars[0]!;
  return {
    ...data,
    calendars: [
      first,
      {
        ...first,
        id: SECOND_CALENDAR,
        name: '工作',
        color: '#2563eb',
        isDefault: false,
        sortOrder: 1,
        ...overrides,
      },
    ],
  };
}

describe('calendar palette', () => {
  it('offers the next palette entry and wraps around', () => {
    expect(nextCalendarColor(0)).toBe(CALENDAR_PALETTE[0]);
    expect(nextCalendarColor(CALENDAR_PALETTE.length)).toBe(CALENDAR_PALETTE[0]);
  });

  it('keeps a colour outside the palette visible at the front', () => {
    expect(calendarSwatches('#123456')[0]).toBe('#123456');
    expect(calendarSwatches('#123456')).toHaveLength(CALENDAR_PALETTE.length + 1);
    // A palette colour is not duplicated.
    expect(calendarSwatches(CALENDAR_PALETTE[3]!)).toHaveLength(CALENDAR_PALETTE.length);
  });
});

describe('calendarColor', () => {
  it('falls back to the原檔 grey when the calendar is gone', () => {
    expect(calendarColor([], 'missing')).toBe('#888888');
  });
});

describe('visibleEvents', () => {
  it('drops events from hidden calendars without touching storage', () => {
    let data = withSecondCalendar(createEmptyUserData({ now: NOW }));
    const input = {
      title: '會議',
      date: '2026-08-06',
      allDay: true,
      start: '',
      end: '',
    };
    data = {
      ...data,
      events: [
        createEventFromInput(data, input, { id: '77777777-7777-4777-8777-777777777777', now: NOW }),
        createEventFromInput(
          data,
          { ...input, title: '工作會議', calendarId: SECOND_CALENDAR },
          { id: '88888888-8888-4888-8888-888888888888', now: NOW },
        ),
      ],
    };

    expect(visibleEvents(data)).toHaveLength(2);

    const hidden = {
      ...data,
      calendars: data.calendars.map((calendar) =>
        calendar.id === SECOND_CALENDAR ? { ...calendar, isVisible: false } : calendar,
      ),
    };

    expect(visibleEvents(hidden).map((event) => event.title)).toEqual(['會議']);
    // Hiding is a filter, not a delete.
    expect(hidden.events).toHaveLength(2);
  });
});

describe('sortedCalendars', () => {
  it('orders by sortOrder without mutating the input', () => {
    const data = withSecondCalendar(createEmptyUserData({ now: NOW }));
    const reversed = [...data.calendars].reverse();

    expect(sortedCalendars(reversed).map((calendar) => calendar.sortOrder)).toEqual([0, 1]);
    expect(reversed[0]?.sortOrder).toBe(1);
  });
});

describe('visibleOccurrences（DP-081 覆驗修正）', () => {
  /** `CalendarEvent` 是全天／定時的聯集，取 instants 前要先縮小型別。 */
  function startDayIn(event: CalendarEvent, zone: string): string {
    if (event.allDay) return event.startDate;
    return instantDateInZone(event.startsAt, zone);
  }

  function withEvents(events: CalendarEvent[]): DayPopUserData {
    const base = createEmptyUserData();
    const calendarId = base.calendars[0]!.id;
    return { ...base, events: events.map((event) => ({ ...event, calendarId })) };
  }

  function daily(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
    return {
      id: 'r1',
      calendarId: 'replaced',
      title: '每日',
      location: null,
      notes: null,
      reminderMinutes: [],
      recurrence: { rule: 'FREQ=DAILY;COUNT=10' },
      sharingScope: 'inherit',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      allDay: false,
      // 2026-08-01 00:30 Asia/Tokyo
      startsAt: '2026-07-31T15:30:00.000Z',
      endsAt: '2026-07-31T16:00:00.000Z',
      timezone: 'Asia/Tokyo',
      ...overrides,
    } as CalendarEvent;
  }

  it('事件時區在顯示時區之後時，邊界的那一次不會消失', () => {
    const data = withEvents([daily()]);

    // 東京 8/2 00:30 = LA 8/1 08:30，所以 LA 的 8/1 要有一筆。
    const resolved = visibleOccurrences(
      data,
      { startDate: '2026-08-01', endDate: '2026-08-01' },
      'America/Los_Angeles',
    );

    expect(
      resolved.map((r) => startDayIn(r.event, 'America/Los_Angeles')),
    ).toEqual(['2026-08-01']);
  });

  it('反方向也一樣：事件時區在顯示時區之前', () => {
    // LA 每天 23:30 起。LA 8/1 23:30 = 東京 8/2 15:30。
    const data = withEvents([
      daily({
        startsAt: '2026-08-02T06:30:00.000Z',
        endsAt: '2026-08-02T07:00:00.000Z',
        timezone: 'America/Los_Angeles',
      }),
    ]);

    const resolved = visibleOccurrences(
      data,
      { startDate: '2026-08-02', endDate: '2026-08-02' },
      'Asia/Tokyo',
    );

    expect(resolved.map((r) => startDayIn(r.event, 'Asia/Tokyo'))).toEqual([
      '2026-08-02',
    ]);
  });

  it('只回落在顯示視窗內的那幾天，沒有把補寬的邊界漏出去', () => {
    const data = withEvents([daily()]);

    const resolved = visibleOccurrences(
      data,
      { startDate: '2026-08-02', endDate: '2026-08-03' },
      'Asia/Tokyo',
    );

    expect(resolved.map((r) => startDayIn(r.event, 'Asia/Tokyo'))).toEqual([
      '2026-08-02',
      '2026-08-03',
    ]);
  });

  it('隱藏的日曆仍然不會出現', () => {
    const base = withEvents([daily()]);
    const data: DayPopUserData = {
      ...base,
      calendars: base.calendars.map((calendar) => ({ ...calendar, isVisible: false })),
    };

    expect(
      visibleOccurrences(data, { startDate: '2026-08-02', endDate: '2026-08-03' }, 'Asia/Tokyo'),
    ).toEqual([]);
  });

  it('已存的密集規則不會讓畫面丟例外，該事件仍然看得到一次', () => {
    // `parseRecurrenceRule()` 現在會在寫入邊界擋掉 sub-daily，但既有文件
    // 可能已經存著一筆；畫面是在 render 時展開的，丟例外就是整頁白畫面。
    const data = withEvents([
      daily({ recurrence: { rule: 'FREQ=SECONDLY;COUNT=20000' }, timezone: 'Asia/Taipei' }),
    ]);

    let resolved: ReturnType<typeof visibleOccurrences> = [];
    expect(() => {
      resolved = visibleOccurrences(data, { startDate: '2026-08-01', endDate: '2026-08-01' }, 'Asia/Taipei');
    }).not.toThrow();
    // 退回成單次，事件還在，使用者刪得掉。
    expect(resolved).toHaveLength(1);
  });

  it('一筆壞規則不會連累同一份資料裡的其他事件', () => {
    const data = withEvents([
      daily({ id: 'bad', recurrence: { rule: 'FREQ=SECONDLY;COUNT=20000' }, timezone: 'Asia/Taipei' }),
      daily({
        id: 'good',
        // 每天 10:00–11:00 台北，不跨午夜，一天就是一筆。
        startsAt: '2026-08-01T02:00:00.000Z',
        endsAt: '2026-08-01T03:00:00.000Z',
        recurrence: { rule: 'FREQ=DAILY;COUNT=3' },
        timezone: 'Asia/Taipei',
      }),
    ]);

    const resolved = visibleOccurrences(
      data,
      { startDate: '2026-08-01', endDate: '2026-08-01' },
      'Asia/Taipei',
    );

    expect(resolved.map((r) => r.event.id).sort()).toEqual(['bad', 'good']);
  });
});
