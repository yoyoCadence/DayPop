import { describe, expect, it } from 'vitest';
import { timedEventFromWallTime } from './eventTime';
import {
  exportCalendarToIcs,
  IcsFormatError,
  importCalendarFromIcs,
} from './ics';
import type { CalendarEvent, EventException } from './types';

const CALENDAR = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';
const REPLACEMENT = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-08-08T08:30:00.000Z';

function common(id = SOURCE) {
  return {
    id,
    calendarId: CALENDAR,
    title: '例會，台北; A 組',
    location: '會議室 A',
    notes: '第一行\n第二行',
    reminderMinutes: [],
    recurrence: null,
    sharingScope: 'private' as const,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function ids() {
  let value = 10;
  return () => {
    const suffix = String(value++).padStart(12, '0');
    return `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`;
  };
}

describe('ICS date boundary', () => {
  it('exports DayPop inclusive all-day end as exclusive DTEND and restores it', () => {
    const event: CalendarEvent = {
      ...common(),
      allDay: true,
      startDate: '2026-08-08',
      endDate: '2026-08-10',
      recurrence: { rule: 'FREQ=YEARLY;COUNT=2' },
    };
    const text = exportCalendarToIcs({ events: [event], eventExceptions: [] });

    expect(text).toContain('DTSTART;VALUE=DATE:20260808\r\n');
    expect(text).toContain('DTEND;VALUE=DATE:20260811\r\n');
    expect(text).toContain('RRULE:FREQ=YEARLY;COUNT=2\r\n');

    const imported = importCalendarFromIcs(text, {
      calendarId: CALENDAR,
      defaultTimezone: 'Asia/Taipei',
      now: NOW,
      idFactory: ids(),
    });
    expect(imported.events[0]).toMatchObject({
      id: SOURCE,
      allDay: true,
      startDate: '2026-08-08',
      endDate: '2026-08-10',
      recurrence: { rule: 'FREQ=YEARLY;COUNT=2' },
      title: '例會，台北; A 組',
      notes: '第一行\n第二行',
      sharingScope: 'private',
    });
  });

  it('round-trips a timed TZID event without changing its instants', () => {
    const event = timedEventFromWallTime(
      {
        ...common(),
        recurrence: { rule: 'FREQ=DAILY;COUNT=3' },
      },
      { date: '2026-03-07', start: '09:00', end: '10:00' },
      'America/New_York',
    );
    const text = exportCalendarToIcs({ events: [event], eventExceptions: [] });

    expect(text).toContain('DTSTART;TZID=America/New_York:20260307T090000');
    const imported = importCalendarFromIcs(text, {
      calendarId: CALENDAR,
      defaultTimezone: 'Asia/Taipei',
      now: NOW,
      idFactory: ids(),
    });
    expect(imported.events[0]).toMatchObject({
      allDay: false,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: 'America/New_York',
      recurrence: { rule: 'FREQ=DAILY;COUNT=3' },
    });
  });

  it('round-trips cancelled and replacement occurrences through EXDATE and RECURRENCE-ID', () => {
    const source: CalendarEvent = {
      ...common(),
      allDay: true,
      startDate: '2026-08-08',
      endDate: '2026-08-08',
      recurrence: { rule: 'FREQ=DAILY;COUNT=4' },
    };
    const replacement: CalendarEvent = {
      ...common(REPLACEMENT),
      title: '改期例會',
      allDay: true,
      startDate: '2026-08-12',
      endDate: '2026-08-12',
    };
    const cancelledException: EventException =
      {
        id: '44444444-4444-4444-8444-444444444444',
        eventId: SOURCE,
        occurrence: { kind: 'all-day', date: '2026-08-09' },
        isCancelled: true,
        replacementEventId: null,
        createdAt: NOW,
        updatedAt: NOW,
      };
    const replacementException: EventException =
      {
        id: '55555555-5555-4555-8555-555555555555',
        eventId: SOURCE,
        occurrence: { kind: 'all-day', date: '2026-08-10' },
        isCancelled: false,
        replacementEventId: REPLACEMENT,
        createdAt: NOW,
        updatedAt: NOW,
      };
    // Keep the replacement first to ensure EXDATE is still inserted into the
    // master VEVENT instead of the later override component.
    const exceptions = [replacementException, cancelledException];

    const text = exportCalendarToIcs({
      events: [source, replacement],
      eventExceptions: exceptions,
    });
    expect(text).toContain('EXDATE;VALUE=DATE:20260809');
    expect(text).toContain('RECURRENCE-ID;VALUE=DATE:20260810');

    const imported = importCalendarFromIcs(text, {
      calendarId: CALENDAR,
      defaultTimezone: 'Asia/Taipei',
      now: NOW,
      idFactory: ids(),
    });
    expect(imported.events).toHaveLength(2);
    expect(imported.events[1]).toMatchObject({
      title: '改期例會',
      recurrence: null,
      startDate: '2026-08-12',
    });
    expect(imported.eventExceptions).toHaveLength(2);
    expect(imported.eventExceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          occurrence: { kind: 'all-day', date: '2026-08-09' },
          isCancelled: true,
          replacementEventId: null,
        }),
        expect.objectContaining({
          occurrence: { kind: 'all-day', date: '2026-08-10' },
          isCancelled: false,
          replacementEventId: imported.events[1]!.id,
        }),
      ]),
    );
  });

  it('rejects invalid timezones and malformed recurrence values', () => {
    const invalidTimezone = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      `UID:${SOURCE}@daypop.local`,
      'DTSTART;TZID=Not/A_Zone:20260808T090000',
      'DTEND;TZID=Not/A_Zone:20260808T100000',
      'SUMMARY:壞資料',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(() =>
      importCalendarFromIcs(invalidTimezone, {
        calendarId: CALENDAR,
        defaultTimezone: 'Asia/Taipei',
      }),
    ).toThrow(IcsFormatError);

    const badRuleEvent: CalendarEvent = {
      ...common(),
      allDay: true,
      startDate: '2026-08-08',
      endDate: '2026-08-08',
      recurrence: { rule: 'FREQ=DAILY;COUNT=0' },
    };
    expect(() =>
      exportCalendarToIcs({ events: [badRuleEvent], eventExceptions: [] }),
    ).toThrow(IcsFormatError);
  });
});
