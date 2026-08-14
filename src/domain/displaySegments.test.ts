import { describe, expect, it } from 'vitest';
import {
  BASELINE_HOUR_RANGE,
  conflictingOccurrenceKeys,
  countOccurrences,
  DisplaySegmentRangeError,
  eventDisplaySegments,
  hourRangeForSegments,
  occurrencesConflict,
  type DisplaySegment,
} from './displaySegments';
import { timedEventFromWallTime, wallTimeToInstant } from './eventTime';
import type { AllDayCalendarEvent, TimedCalendarEvent } from './types';

/**
 * DP-064. Every assertion names its zones explicitly, because the whole point
 * of this module is that the cut happens in the *display* zone rather than the
 * event's own — the two differ, and so do their midnights.
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

const KEY = 'event-1:2026-08-13';

function timed(date: string, start: string, end: string, timezone: string): TimedCalendarEvent {
  return timedEventFromWallTime(COMMON, { date, start, end }, timezone);
}

/** Builds an event straight from instants, for spans a wall time cannot express. */
function spanning(startsAt: string, endsAt: string, timezone: string): TimedCalendarEvent {
  return { ...COMMON, allDay: false, startsAt, endsAt, timezone };
}

function shape(segments: DisplaySegment[]) {
  return segments.map((segment) => ({
    dateKey: segment.dateKey,
    startMinutes: segment.startMinutes,
    endMinutes: segment.endMinutes,
    isContinuation: segment.isContinuation,
    continuesNextDay: segment.continuesNextDay,
  }));
}

describe('eventDisplaySegments', () => {
  it('leaves a same-day event as one segment', () => {
    const event = timed('2026-08-13', '09:00', '10:30', 'Asia/Taipei');

    expect(shape(eventDisplaySegments(event, KEY, 'Asia/Taipei'))).toEqual([
      {
        dateKey: '2026-08-13',
        startMinutes: 540,
        endMinutes: 630,
        isContinuation: false,
        continuesNextDay: false,
      },
    ]);
  });

  it('cuts a cross-midnight event at local midnight and marks the continuation', () => {
    const event = timed('2026-08-13', '23:00', '00:30', 'Asia/Taipei');

    expect(shape(eventDisplaySegments(event, KEY, 'Asia/Taipei'))).toEqual([
      {
        dateKey: '2026-08-13',
        startMinutes: 1380,
        endMinutes: 1440,
        isContinuation: false,
        continuesNextDay: true,
      },
      {
        dateKey: '2026-08-14',
        startMinutes: 0,
        endMinutes: 30,
        isContinuation: true,
        continuesNextDay: false,
      },
    ]);
  });

  it('ends at 24:00 on the first day rather than 00:00 on the next', () => {
    const event = timed('2026-08-13', '22:00', '00:00', 'Asia/Taipei');
    const segments = eventDisplaySegments(event, KEY, 'Asia/Taipei');

    expect(shape(segments)).toEqual([
      {
        dateKey: '2026-08-13',
        startMinutes: 1320,
        endMinutes: 1440,
        isContinuation: false,
        continuesNextDay: false,
      },
    ]);
  });

  it('fills the whole of every day in between', () => {
    const event = spanning(
      wallTimeToInstant('2026-08-13', '23:00', 'Asia/Taipei'),
      wallTimeToInstant('2026-08-16', '14:00', 'Asia/Taipei'),
      'Asia/Taipei',
    );

    expect(shape(eventDisplaySegments(event, KEY, 'Asia/Taipei'))).toEqual([
      { dateKey: '2026-08-13', startMinutes: 1380, endMinutes: 1440, isContinuation: false, continuesNextDay: true },
      { dateKey: '2026-08-14', startMinutes: 0, endMinutes: 1440, isContinuation: true, continuesNextDay: true },
      { dateKey: '2026-08-15', startMinutes: 0, endMinutes: 1440, isContinuation: true, continuesNextDay: true },
      { dateKey: '2026-08-16', startMinutes: 0, endMinutes: 840, isContinuation: true, continuesNextDay: false },
    ]);
  });

  it('cuts in the display zone, not the event’s own zone', () => {
    // 09:00–10:00 in New York is 21:00–22:00 in Taipei: same day in both, but
    // 23:00 New York is already the next day in Taipei.
    const event = timed('2026-08-13', '23:00', '23:30', 'America/New_York');

    expect(shape(eventDisplaySegments(event, KEY, 'America/New_York'))).toEqual([
      { dateKey: '2026-08-13', startMinutes: 1380, endMinutes: 1410, isContinuation: false, continuesNextDay: false },
    ]);
    expect(shape(eventDisplaySegments(event, KEY, 'Asia/Taipei'))).toEqual([
      { dateKey: '2026-08-14', startMinutes: 660, endMinutes: 690, isContinuation: false, continuesNextDay: false },
    ]);
  });

  it('keeps wall-clock minutes across a spring-forward night', () => {
    // 2026-03-08 in New York loses an hour at 02:00, so this local day is 23
    // hours long. The segments must still read 23:00→24:00 and 00:00→00:30.
    const event = timed('2026-03-07', '23:00', '00:30', 'America/New_York');
    const segments = eventDisplaySegments(event, KEY, 'America/New_York');

    expect(shape(segments)).toEqual([
      { dateKey: '2026-03-07', startMinutes: 1380, endMinutes: 1440, isContinuation: false, continuesNextDay: true },
      { dateKey: '2026-03-08', startMinutes: 0, endMinutes: 30, isContinuation: true, continuesNextDay: false },
    ]);
  });

  it('keeps the occurrence key on every segment', () => {
    const event = timed('2026-08-13', '23:00', '02:00', 'Asia/Taipei');
    const segments = eventDisplaySegments(event, KEY, 'Asia/Taipei');

    expect(segments).toHaveLength(2);
    expect(segments.every((segment) => segment.key === KEY)).toBe(true);
    // Two segments, still one occurrence.
    expect(countOccurrences(segments)).toBe(1);
  });

  it('returns nothing for data that ends before it starts', () => {
    // `events_time_shape` forbids this in the database; the guard exists so a
    // corrupt local document cannot spin the loop forever.
    const event = spanning(
      wallTimeToInstant('2026-08-13', '10:00', 'UTC'),
      wallTimeToInstant('2026-08-11', '10:00', 'UTC'),
      'UTC',
    );

    expect(eventDisplaySegments(event, KEY, 'UTC')).toEqual([]);
  });

  it('returns nothing when the reversal is inside one day', () => {
    // The date keys match, so only comparing them let this through as a segment
    // ending on a smaller minute than it started — the negative height §6
    // forbids the grid's 20px minimum from hiding.
    const event = spanning(
      wallTimeToInstant('2026-08-13', '15:00', 'UTC'),
      wallTimeToInstant('2026-08-13', '10:00', 'UTC'),
      'UTC',
    );

    expect(eventDisplaySegments(event, KEY, 'UTC')).toEqual([]);
  });

  it('returns nothing for a zero-length event', () => {
    const at = wallTimeToInstant('2026-08-13', '10:00', 'UTC');

    expect(eventDisplaySegments(spanning(at, at, 'UTC'), KEY, 'UTC')).toEqual([]);
  });

  it('collapses a repeated fall-back hour rather than drawing a negative height', () => {
    // New York puts the clocks back at 02:00 EDT on 2026-11-01, so 01:00–02:00
    // happens twice. 05:30Z reads 01:30 EDT and 06:00Z reads 01:00 EST: thirty
    // real minutes whose end wall clock is the *smaller* number. The rail has no
    // room for the hour that ran twice, so the segment has no height — but it
    // must never have less than none.
    const event = spanning('2026-11-01T05:30:00.000Z', '2026-11-01T06:00:00.000Z', 'America/New_York');
    const segments = eventDisplaySegments(event, KEY, 'America/New_York');

    expect(shape(segments)).toEqual([
      { dateKey: '2026-11-01', startMinutes: 90, endMinutes: 90, isContinuation: false, continuesNextDay: false },
    ]);
  });

  it('keeps wall-clock minutes across a fall-back night', () => {
    // The mirror of the spring-forward case: this local day is 25 hours long and
    // the segment must still read 00:30→23:30.
    const event = spanning(
      wallTimeToInstant('2026-11-01', '00:30', 'America/New_York'),
      wallTimeToInstant('2026-11-01', '23:30', 'America/New_York'),
      'America/New_York',
    );

    expect(shape(eventDisplaySegments(event, KEY, 'America/New_York'))).toEqual([
      { dateKey: '2026-11-01', startMinutes: 30, endMinutes: 1410, isContinuation: false, continuesNextDay: false },
    ]);
  });

  it('fails closed on an absurd span rather than building a million segments', () => {
    const event = spanning(
      wallTimeToInstant('2026-01-01', '00:00', 'UTC'),
      wallTimeToInstant('2030-01-01', '00:00', 'UTC'),
      'UTC',
    );

    expect(() => eventDisplaySegments(event, KEY, 'UTC')).toThrow(DisplaySegmentRangeError);
  });
});

describe('occurrencesConflict', () => {
  const zone = 'Asia/Taipei';

  it('treats the interval as half-open, so touching endpoints do not conflict', () => {
    const earlier = timed('2026-08-13', '09:00', '10:00', zone);
    const later = timed('2026-08-13', '10:00', '11:00', zone);

    expect(occurrencesConflict(earlier, later)).toBe(false);
  });

  it('flags a real overlap', () => {
    const first = timed('2026-08-13', '09:00', '10:30', zone);
    const second = timed('2026-08-13', '10:00', '11:00', zone);

    expect(occurrencesConflict(first, second)).toBe(true);
  });

  it('flags the cross-midnight overlap the clock-string comparison always missed', () => {
    // The old check compared minutes(end) = 30 against minutes(start) = 1380,
    // so these never registered.
    const overnight = timed('2026-08-13', '23:00', '00:30', zone);
    const evening = timed('2026-08-13', '23:30', '23:45', zone);

    expect(occurrencesConflict(overnight, evening)).toBe(true);
  });

  it('compares instants, so two zones cannot fake a conflict', () => {
    // 09:00 New York is 21:00 Taipei — the wall clocks look far apart, the
    // instants are the same hour.
    const newYork = timed('2026-08-13', '09:00', '10:00', 'America/New_York');
    const taipei = timed('2026-08-13', '21:30', '22:30', 'Asia/Taipei');

    expect(occurrencesConflict(newYork, taipei)).toBe(true);
  });

  it('never conflicts with an all-day event', () => {
    const allDay: AllDayCalendarEvent = {
      ...COMMON,
      allDay: true,
      startDate: '2026-08-13',
      endDate: '2026-08-13',
    };

    expect(occurrencesConflict(allDay, timed('2026-08-13', '09:00', '10:00', zone))).toBe(false);
  });
});

describe('conflictingOccurrenceKeys', () => {
  const zone = 'Asia/Taipei';

  it('returns both sides of every overlap and nothing else', () => {
    const candidates = [
      { key: 'a', event: timed('2026-08-13', '09:00', '10:30', zone) },
      { key: 'b', event: timed('2026-08-13', '10:00', '11:00', zone) },
      { key: 'c', event: timed('2026-08-13', '14:00', '15:00', zone) },
    ];

    expect([...conflictingOccurrenceKeys(candidates)].sort()).toEqual(['a', 'b']);
  });

  it('does not compare an occurrence with itself', () => {
    const event = timed('2026-08-13', '09:00', '10:00', zone);

    expect(conflictingOccurrenceKeys([{ key: 'a', event }, { key: 'a', event }]).size).toBe(0);
  });
});

describe('hourRangeForSegments', () => {
  function segment(startMinutes: number, endMinutes: number): DisplaySegment {
    return {
      key: KEY,
      event: timed('2026-08-13', '09:00', '10:00', 'Asia/Taipei'),
      dateKey: '2026-08-13',
      startMinutes,
      endMinutes,
      isContinuation: false,
      continuesNextDay: false,
    };
  }

  it('keeps the原檔 rail when everything fits inside it', () => {
    expect(hourRangeForSegments([segment(540, 600)])).toEqual(BASELINE_HOUR_RANGE);
    expect(hourRangeForSegments([])).toEqual(BASELINE_HOUR_RANGE);
  });

  it('grows to whole hours around anything outside', () => {
    // 06:30 floors to 6; 22:15 ceils to 23.
    expect(hourRangeForSegments([segment(390, 1335)])).toEqual({ startHour: 6, endHour: 23 });
  });

  it('reaches 24 for a segment running to midnight, and never past it', () => {
    expect(hourRangeForSegments([segment(1380, 1440)])).toEqual({ startHour: 7, endHour: 24 });
  });

  it('never goes below 0', () => {
    expect(hourRangeForSegments([segment(0, 1440)])).toEqual({ startHour: 0, endHour: 24 });
  });

  it('spans the widest pair across the whole week', () => {
    expect(hourRangeForSegments([segment(300, 360), segment(1380, 1440)])).toEqual({
      startHour: 5,
      endHour: 24,
    });
  });
});
