import { describe, expect, it } from 'vitest';
import { timedEventFromWallTime } from './eventTime';
import { createEmptyUserData, type CalendarEvent } from './types';
import {
  DomainValidationError,
  isDateKey,
  isIanaTimezone,
  isIsoInstant,
  parseDayPopUserData,
  validateDayPopUserData,
} from './validation';

const NOW = '2026-08-04T02:00:00.000Z';
const CALENDAR_ID = '00000000-0000-4000-8000-000000000001';
const EVENT_ID = '00000000-0000-4000-8000-000000000002';

describe('domain primitives', () => {
  it('accepts real calendar dates and rejects rollover dates', () => {
    expect(isDateKey('2028-02-29')).toBe(true);
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2026-13-01')).toBe(false);
  });

  it('requires an explicit offset for instants', () => {
    expect(isIsoInstant('2026-08-04T10:00:00+08:00')).toBe(true);
    expect(isIsoInstant('2026-08-04T02:00:00.000Z')).toBe(true);
    expect(isIsoInstant('2026-08-04T10:00:00')).toBe(false);
  });

  it('validates IANA timezones through Intl', () => {
    expect(isIanaTimezone('Asia/Taipei')).toBe(true);
    expect(isIanaTimezone('Not/A_Timezone')).toBe(false);
  });
});

describe('DayPop runtime contract', () => {
  it('accepts the guest bootstrap and its one stable default calendar', () => {
    const data = createEmptyUserData({ idFactory: () => CALENDAR_ID, now: NOW });
    expect(parseDayPopUserData(data)).toEqual(data);
    expect(data.calendars).toMatchObject([{ id: CALENDAR_ID, isDefault: true }]);
  });

  it('accepts an inclusive one-day all-day event', () => {
    const data = withEvent({
      ...eventCommon(),
      allDay: true,
      startDate: '2026-08-04',
      endDate: '2026-08-04',
    });
    expect(validateDayPopUserData(data).success).toBe(true);
  });

  it('rejects all-day reversal and timed end-before-start', () => {
    const allDay = withEvent({
      ...eventCommon(),
      allDay: true,
      startDate: '2026-08-05',
      endDate: '2026-08-04',
    });
    expect(validateDayPopUserData(allDay)).toMatchObject({ success: false });

    const timed = withEvent({
      ...eventCommon(),
      allDay: false,
      startsAt: '2026-08-04T03:00:00.000Z',
      endsAt: '2026-08-04T02:00:00.000Z',
      timezone: 'Asia/Taipei',
    });
    expect(validateDayPopUserData(timed)).toMatchObject({ success: false });
  });

  it('rejects mixed all-day and timed shapes', () => {
    const data = withEvent({
      ...eventCommon(),
      allDay: true,
      startDate: '2026-08-04',
      endDate: '2026-08-04',
      startsAt: NOW,
    } as unknown as CalendarEvent);
    const result = validateDayPopUserData(data);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.join(' ')).toMatch(/timed fields/);
  });

  it('rejects invalid timezone and dangling calendar references', () => {
    const event = timedEventFromWallTime(
      eventCommon(),
      { date: '2026-08-04', start: '09:00', end: '10:00' },
      'Asia/Taipei',
    );
    const invalidTimezone = validateDayPopUserData({
      ...withEvent(event),
      events: [{ ...event, timezone: 'Not/A_Timezone' }],
    });
    expect(invalidTimezone.success).toBe(false);
    if (!invalidTimezone.success) {
      expect(invalidTimezone.issues.join(' ')).toMatch(/timezone/);
    }

    const missingCalendar = validateDayPopUserData({
      ...withEvent(event),
      events: [{ ...event, calendarId: '00000000-0000-4000-8000-000000000099' }],
    });
    expect(missingCalendar.success).toBe(false);
    if (!missingCalendar.success) {
      expect(missingCalendar.issues.join(' ')).toMatch(/missing calendar/);
    }
  });

  it('throws a diagnostic error for malformed imported data', () => {
    expect(() => parseDayPopUserData({ events: [] })).toThrow(DomainValidationError);
  });
});

function withEvent(event: CalendarEvent) {
  const data = createEmptyUserData({ idFactory: () => CALENDAR_ID, now: NOW });
  data.events = [event];
  return data;
}

function eventCommon() {
  return {
    id: EVENT_ID,
    calendarId: CALENDAR_ID,
    title: '會議',
    location: null,
    notes: null,
    reminderMinutes: [],
    recurrence: null,
    sharingScope: 'inherit' as const,
    createdAt: NOW,
    updatedAt: NOW,
  };
}
