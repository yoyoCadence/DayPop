import { describe, expect, it } from 'vitest';
import { timedEventFromWallTime } from './eventTime';
import {
  isExpandableEvent,
  isRecurrenceRule,
  parseRecurrenceRule,
  RecurrenceRuleError,
  recurrenceRuleForPreset,
  resolveEventOccurrences,
} from './recurrence';
import type { CalendarEvent, DayPopUserData, EventException } from './types';

const CALENDAR = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';
const REPLACEMENT = '33333333-3333-4333-8333-333333333333';
const EXCEPTION = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-01-01T00:00:00.000Z';

function common(id = SOURCE) {
  return {
    id,
    calendarId: CALENDAR,
    title: '站會',
    location: null,
    notes: null,
    reminderMinutes: [],
    recurrence: { rule: 'FREQ=DAILY;COUNT=3' },
    sharingScope: 'inherit' as const,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function timed(
  date: string,
  start: string,
  end: string,
  timezone: string,
  rule = 'FREQ=DAILY;COUNT=3',
): CalendarEvent {
  return timedEventFromWallTime(
    { ...common(), recurrence: { rule } },
    { date, start, end },
    timezone,
  );
}

function document(events: CalendarEvent[], eventExceptions: EventException[] = []) {
  return { events, eventExceptions } satisfies Pick<
    DayPopUserData,
    'events' | 'eventExceptions'
  >;
}

describe('RFC 5545 recurrence rules', () => {
  it('accepts the prototype presets as canonical RECUR values', () => {
    expect(recurrenceRuleForPreset('none')).toBeNull();
    expect(recurrenceRuleForPreset('weekday')).toBe(
      'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    );
    expect(parseRecurrenceRule('FREQ=MONTHLY;BYDAY=-1MO;COUNT=4', false).canonical).toBe(
      'FREQ=MONTHLY;BYDAY=-1MO;COUNT=4',
    );
  });

  it('rejects malformed and shape-incompatible rules', () => {
    for (const rule of [
      '',
      'RRULE:FREQ=DAILY',
      'FREQ=DAILY;FREQ=WEEKLY',
      'FREQ=DAILY;COUNT=0',
      'FREQ=DAILY;COUNT=2;UNTIL=20260801T000000Z',
      'NOPE=DAILY',
    ]) {
      expect(isRecurrenceRule(rule, false), rule).toBe(false);
    }
    expect(isRecurrenceRule('FREQ=DAILY;BYHOUR=9', true)).toBe(false);
    expect(isRecurrenceRule('FREQ=DAILY;UNTIL=20260801', true)).toBe(true);
    expect(isRecurrenceRule('FREQ=DAILY;UNTIL=20260801T000000Z', false)).toBe(true);
  });

  it('fails closed instead of truncating an excessively dense result window', () => {
    const event = timed(
      '2026-03-07',
      '09:00',
      '10:00',
      'UTC',
      'FREQ=SECONDLY;COUNT=20000',
    );
    expect(() =>
      resolveEventOccurrences(document([event]), {
        startDate: '2026-03-07',
        endDate: '2026-03-07',
      }),
    ).toThrow(RecurrenceRuleError);
  });
});

describe('occurrence expansion', () => {
  it('keeps the same wall clock when a daily event crosses spring DST', () => {
    const event = timed(
      '2026-03-07',
      '09:00',
      '10:00',
      'America/New_York',
      'FREQ=DAILY;COUNT=3',
    );
    const occurrences = resolveEventOccurrences(document([event]), {
      startDate: '2026-03-07',
      endDate: '2026-03-09',
    });

    expect(occurrences.map(({ event: item }) => (item.allDay ? '' : item.startsAt))).toEqual([
      '2026-03-07T14:00:00.000Z',
      '2026-03-08T13:00:00.000Z',
      '2026-03-09T13:00:00.000Z',
    ]);
  });

  it('omits a generated local start that does not exist', () => {
    const event = timed(
      '2026-03-07',
      '02:30',
      '03:00',
      'America/New_York',
      'FREQ=DAILY;COUNT=3',
    );
    const occurrences = resolveEventOccurrences(document([event]), {
      startDate: '2026-03-07',
      endDate: '2026-03-09',
    });

    expect(occurrences.map(({ event: item }) => (item.allDay ? '' : item.startsAt))).toEqual([
      '2026-03-07T07:30:00.000Z',
      '2026-03-09T06:30:00.000Z',
    ]);
  });

  it('uses RFC monthly semantics instead of clamping missing dates', () => {
    const event: CalendarEvent = {
      ...common(),
      allDay: true,
      startDate: '2026-01-31',
      endDate: '2026-01-31',
      recurrence: { rule: 'FREQ=MONTHLY;COUNT=4' },
    };
    const occurrences = resolveEventOccurrences(document([event]), {
      startDate: '2026-01-01',
      endDate: '2026-07-31',
    });

    expect(occurrences.map(({ event: item }) => (item.allDay ? item.startDate : ''))).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
    ]);
  });

  it('preserves the inclusive span of a recurring all-day event', () => {
    const event: CalendarEvent = {
      ...common(),
      allDay: true,
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      recurrence: { rule: 'FREQ=WEEKLY;COUNT=2' },
    };
    const occurrences = resolveEventOccurrences(document([event]), {
      startDate: '2026-08-01',
      endDate: '2026-08-10',
    });

    expect(
      occurrences.map(({ event: item }) =>
        item.allDay ? [item.startDate, item.endDate] : [],
      ),
    ).toEqual([
      ['2026-08-01', '2026-08-03'],
      ['2026-08-08', '2026-08-10'],
    ]);
  });

  it('applies cancellation and replacement exceptions without duplicating replacements', () => {
    const source: CalendarEvent = {
      ...common(),
      allDay: true,
      startDate: '2026-08-01',
      endDate: '2026-08-01',
      recurrence: { rule: 'FREQ=DAILY;COUNT=5' },
    };
    const replacement: CalendarEvent = {
      ...common(REPLACEMENT),
      title: '改期站會',
      recurrence: null,
      allDay: true,
      startDate: '2026-08-05',
      endDate: '2026-08-05',
    };
    const exceptions: EventException[] = [
      {
        id: EXCEPTION,
        eventId: SOURCE,
        occurrence: { kind: 'all-day', date: '2026-08-02' },
        isCancelled: true,
        replacementEventId: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        eventId: SOURCE,
        occurrence: { kind: 'all-day', date: '2026-08-03' },
        isCancelled: false,
        replacementEventId: REPLACEMENT,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];

    const occurrences = resolveEventOccurrences(document([source, replacement], exceptions), {
      startDate: '2026-08-01',
      endDate: '2026-08-05',
    });

    expect(
      occurrences.map(({ event, replacementEventId }) => [
        event.allDay ? event.startDate : '',
        event.title,
        replacementEventId,
      ]),
    ).toEqual([
      ['2026-08-01', '站會', null],
      ['2026-08-04', '站會', null],
      ['2026-08-05', '改期站會', REPLACEMENT],
      ['2026-08-05', '站會', null],
    ]);
  });
});

describe('isExpandableEvent（DP-081 兩輪覆驗修正）', () => {
  const hourly = (rule: string) =>
    timed('2026-08-03', '09:00', '09:30', 'Asia/Taipei', rule);

  it('依實際展開量判斷，不是整類封鎖 sub-daily', () => {
    // 兩次的 HOURLY 畫得出來；兩萬次的 SECONDLY 畫不出來。
    expect(isExpandableEvent(hourly('FREQ=HOURLY;COUNT=2'))).toBe(true);
    expect(isExpandableEvent(hourly('FREQ=MINUTELY;COUNT=10'))).toBe(true);
    expect(isExpandableEvent(hourly('FREQ=SECONDLY;COUNT=20000'))).toBe(false);
  });

  it('密集的那一天不是 DTSTART 當天時也要抓到（BYDAY）', () => {
    // 2026-08-03 是週一，規則只命中週二，每個週二 3 小時 × 60 分 × 60 秒
    // = 10,800 次。只探 DTSTART 當天會放行，因為那天一次都沒有。
    const byDay = timed('2026-08-03', '09:00', '09:30', 'Asia/Taipei', 'FREQ=SECONDLY;BYDAY=TU;BYHOUR=9,10,11');
    expect(isExpandableEvent(byDay)).toBe(false);
  });

  it('BYDAY 但不密集的規則不受影響', () => {
    const weekly = timed('2026-08-03', '09:00', '09:30', 'Asia/Taipei', 'FREQ=WEEKLY;BYDAY=TU');
    expect(isExpandableEvent(weekly)).toBe(true);
    const monthly = timed('2026-08-03', '09:00', '09:30', 'Asia/Taipei', 'FREQ=MONTHLY;BYDAY=-1MO');
    expect(isExpandableEvent(monthly)).toBe(true);
  });
  it('一般頻率與不重複的事件都可展開', () => {
    for (const freq of ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']) {
      expect(isExpandableEvent(hourly(`FREQ=${freq}`))).toBe(true);
    }
    expect(isExpandableEvent({ ...hourly('FREQ=DAILY'), recurrence: null })).toBe(true);
  });

  it('**不會**讓既有文件失效：validation 仍然接受 sub-daily', () => {
    // 這是刻意的。把它變成 validation 規則，會讓已經存著這種事件的文件
    // 整份讀不出來，一列壞資料就把整個日曆推進復原畫面。
    expect(isRecurrenceRule('FREQ=SECONDLY;COUNT=20000', false)).toBe(true);
  });
});
