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
  it('命中日遠在任何取樣視窗之外的密集規則也要擋下', () => {
    // DTSTART 2025-03-01，下一個 2/29 是 2028 —— 探 DTSTART 當天或探一整年
    // 都看不到它，但那一天會有 3 × 60 × 60 = 10,800 次。
    const leapDay = timed('2025-03-01', '09:00', '09:30', 'Asia/Taipei', 'FREQ=SECONDLY;BYMONTH=2;BYMONTHDAY=29;BYHOUR=9,10,11');
    expect(isExpandableEvent(leapDay)).toBe(false);
  });

  it('timed UNTIL 讓規則其實很短時，要照實算而不是誤擋', () => {
    // DTSTART 09:00 Asia/Taipei = 01:00:00Z，UNTIL 01:00:05Z，實際只有 6 次。
    const short = timed('2026-08-03', '09:00', '09:30', 'Asia/Taipei', 'FREQ=SECONDLY;UNTIL=20260803T010005Z');
    expect(isExpandableEvent(short)).toBe(true);
  });

  it('UNTIL 拉長到整天的同一個 FREQ 仍然擋下', () => {
    const long = timed('2026-08-03', '09:00', '09:30', 'Asia/Taipei', 'FREQ=SECONDLY;UNTIL=20260804T010000Z');
    expect(isExpandableEvent(long)).toBe(false);
  });
  it('INTERVAL 不能在 BY* 已經對齊候選之後再除一次', () => {
    // 12 個偶數小時 × 3 分鐘 = 每天 36 次，全年超過上限。
    const aligned = timed('2026-08-03', '00:00', '00:30', 'Asia/Taipei', 'FREQ=HOURLY;INTERVAL=2;BYHOUR=0,2,4,6,8,10,12,14,16,18,20,22;BYMINUTE=0,1,2');
    expect(isExpandableEvent(aligned)).toBe(false);
  });

  it('有 COUNT 的規則比的是單一視窗，不是整個生命週期', () => {
    // 兩萬次分散在五十幾年，任何一年最多 366 次。
    const many = timed('2026-08-03', '09:00', '09:30', 'Asia/Taipei', 'FREQ=DAILY;COUNT=20000');
    expect(isExpandableEvent(many)).toBe(true);
  });

  it('每週規則的單日峰值不會被當成天天發生', () => {
    // 每週一天 48 次，全年約 2,500 次，遠低於上限。
    const weekly = timed('2026-08-03', '00:00', '00:30', 'Asia/Taipei', 'FREQ=WEEKLY;BYHOUR=0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23;BYMINUTE=0,30');
    expect(isExpandableEvent(weekly)).toBe(true);
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
