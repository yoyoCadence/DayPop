import { describe, expect, it } from 'vitest';
import {
  eventDate,
  eventEndTime,
  eventStartTime,
  eventWallTime,
  timedEventFromWallTime,
  wallTimeToInstant,
} from './eventTime';
import type { AllDayCalendarEvent, TimedCalendarEvent } from './types';

/**
 * `eventTime.ts` is the boundary between what the user types (a date and a wall
 * clock) and what DayPop stores (an ISO instant plus an IANA zone). Everything
 * here names its zone explicitly, so the assertions hold wherever the tests run.
 *
 * Occurrence expansion for recurring events is still DP-027; this covers the
 * single-event conversions the sheet and the week grid rely on today.
 */

const COMMON = {
  id: '77777777-7777-4777-8777-777777777777',
  calendarId: '11111111-1111-4111-8111-111111111111',
  title: '會議',
  location: null,
  notes: null,
  reminderMinutes: [],
  recurrence: null,
  sharingScope: 'inherit' as const,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function timed(date: string, start: string, end: string, timezone: string): TimedCalendarEvent {
  return timedEventFromWallTime(COMMON, { date, start, end }, timezone);
}

const ALL_DAY: AllDayCalendarEvent = {
  ...COMMON,
  allDay: true,
  startDate: '2026-08-06',
  endDate: '2026-08-06',
};

describe('wallTimeToInstant', () => {
  it('anchors a wall clock to the offset of its own zone', () => {
    expect(wallTimeToInstant('2026-08-06', '09:00', 'Asia/Taipei')).toBe('2026-08-06T01:00:00.000Z');
    // +05:30 — a zone whose offset is not a whole hour.
    expect(wallTimeToInstant('2026-06-15', '09:00', 'Asia/Kolkata')).toBe('2026-06-15T03:30:00.000Z');
    expect(wallTimeToInstant('2026-07-01', '12:00', 'Europe/London')).toBe('2026-07-01T11:00:00.000Z');
  });

  it('uses the offset in force on that date, not the one in force today', () => {
    // New York is EST (-05:00) in January and EDT (-04:00) in July.
    expect(wallTimeToInstant('2026-01-15', '09:00', 'America/New_York'))
      .toBe('2026-01-15T14:00:00.000Z');
    expect(wallTimeToInstant('2026-07-15', '09:00', 'America/New_York'))
      .toBe('2026-07-15T13:00:00.000Z');
  });

  it('lands on the right side of a spring-forward boundary', () => {
    // 2026-03-08, New York: 02:00 EST becomes 03:00 EDT.
    expect(wallTimeToInstant('2026-03-08', '01:30', 'America/New_York'))
      .toBe('2026-03-08T06:30:00.000Z');
    expect(wallTimeToInstant('2026-03-08', '03:30', 'America/New_York'))
      .toBe('2026-03-08T07:30:00.000Z');
  });

  it('resolves a wall time that never happened to a real instant instead of NaN', () => {
    // 02:30 does not exist on a spring-forward day. There is no right answer, so
    // what matters is that the result is a real instant near the gap rather than
    // an invalid date — pinned here so a change to the algorithm is visible.
    const instant = wallTimeToInstant('2026-03-08', '02:30', 'America/New_York');

    expect(Number.isFinite(Date.parse(instant))).toBe(true);
    expect(instant).toBe('2026-03-08T06:30:00.000Z');
  });

  it('picks the first of the two clocks on a fall-back day', () => {
    // 2026-11-01, New York: 01:30 happens once in EDT and again in EST.
    expect(wallTimeToInstant('2026-11-01', '01:30', 'America/New_York'))
      .toBe('2026-11-01T05:30:00.000Z');
  });
});

describe('reading a stored event back', () => {
  it('round-trips a wall time through the instant it was stored as', () => {
    for (const [date, start, end, zone] of [
      ['2026-08-06', '09:00', '10:00', 'Asia/Taipei'],
      ['2026-01-15', '23:00', '23:45', 'America/New_York'],
      ['2026-07-15', '08:15', '09:45', 'Europe/London'],
      ['2026-06-15', '18:30', '20:00', 'Asia/Kolkata'],
    ] as const) {
      expect(eventWallTime(timed(date, start, end, zone))).toEqual({ date, start, end });
    }
  });

  it('reports the day and clock of a timed event in its own zone', () => {
    const event = timed('2026-08-06', '09:00', '10:30', 'Asia/Taipei');

    expect(eventDate(event)).toBe('2026-08-06');
    expect(eventStartTime(event)).toBe('09:00');
    expect(eventEndTime(event)).toBe('10:30');
  });

  it('gives an all-day event its start date and no clock at all', () => {
    expect(eventDate(ALL_DAY)).toBe('2026-08-06');
    expect(eventStartTime(ALL_DAY)).toBe('');
    expect(eventEndTime(ALL_DAY)).toBe('');
    expect(eventWallTime(ALL_DAY)).toEqual({ date: '2026-08-06', start: '', end: '' });
  });
});

describe('an event that runs past midnight', () => {
  it('ends on the next day rather than earlier than it started', () => {
    const event = timed('2026-08-06', '23:00', '00:30', 'Asia/Taipei');

    expect(event.startsAt).toBe('2026-08-06T15:00:00.000Z');
    expect(event.endsAt).toBe('2026-08-06T16:30:00.000Z');
    expect(Date.parse(event.endsAt) - Date.parse(event.startsAt)).toBe(90 * 60 * 1000);
  });

  it('treats an end equal to the start as a full day', () => {
    const event = timed('2026-08-06', '09:00', '09:00', 'Asia/Taipei');

    expect(Date.parse(event.endsAt) - Date.parse(event.startsAt)).toBe(24 * 60 * 60 * 1000);
  });

  /**
   * Regression: the roll used to add exactly 24 hours to the instant. On the
   * night the clocks go forward a local day is only 23 hours long, so a
   * 23:00–00:30 event was stored as ending at 01:30 — 90 minutes turned into
   * 150 without anyone asking.
   */
  it('keeps its length across a spring-forward night', () => {
    const event = timed('2026-03-08', '23:00', '00:30', 'America/New_York');

    expect(Date.parse(event.endsAt) - Date.parse(event.startsAt)).toBe(90 * 60 * 1000);
    expect(eventEndTime(event)).toBe('00:30');
  });

  it('keeps its length across a fall-back night', () => {
    // 2026-11-01 in New York is 25 hours long.
    const event = timed('2026-10-31', '23:00', '00:30', 'America/New_York');

    expect(Date.parse(event.endsAt) - Date.parse(event.startsAt)).toBe(90 * 60 * 1000);
    expect(eventEndTime(event)).toBe('00:30');
  });

  it('records the day it started on, not the day it ends', () => {
    const event = timed('2026-08-06', '23:00', '00:30', 'Asia/Taipei');

    expect(eventDate(event)).toBe('2026-08-06');
    expect(eventWallTime(event)).toEqual({ date: '2026-08-06', start: '23:00', end: '00:30' });
  });
});
