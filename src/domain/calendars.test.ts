import { describe, expect, it } from 'vitest';
import {
  CALENDAR_PALETTE,
  calendarColor,
  calendarSwatches,
  nextCalendarColor,
  sortedCalendars,
  visibleEvents,
} from './calendars';
import { createEventFromInput } from './mutations';
import { createEmptyUserData, type Calendar, type DayPopUserData } from './types';

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
