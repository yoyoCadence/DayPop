import { describe, expect, it } from 'vitest';
import { isExpandableEvent, resolveEventOccurrences } from './recurrence';
import { timedEventFromWallTime } from './eventTime';
import type { CalendarEvent } from './types';

function ev(date: string, rule: string, start: string): CalendarEvent {
  return timedEventFromWallTime(
    {
      id: 'r1',
      calendarId: '11111111-1111-4111-8111-111111111111',
      title: 'x',
      location: null,
      notes: null,
      reminderMinutes: [],
      recurrence: { rule },
      sharingScope: 'inherit' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    { date, start, end: '00:30' },
    'Asia/Taipei',
  );
}

/**
 * 這裡的每一條都真的展開一整年的 occurrence 來對照，屬於整個測試套件裡最吃
 * CPU 的部分。機器同時在跑別的東西時，預設的 5 秒會變成偽陽性，所以放寬。
 */
const SLOW = 30_000;

const HOURS = (n: number) => `BYHOUR=${Array.from({ length: n }, (_, i) => i).join(',')}`;
const MINUTES = (n: number) => `BYMINUTE=${Array.from({ length: n }, (_, i) => i).join(',')}`;
const SECONDS = (n: number) => `BYSECOND=${Array.from({ length: n }, (_, i) => i).join(',')}`;

const RULES: string[] = [
  'FREQ=DAILY',
  'FREQ=DAILY;INTERVAL=3',
  'FREQ=WEEKLY',
  'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  'FREQ=MONTHLY',
  'FREQ=MONTHLY;BYDAY=-1MO',
  'FREQ=YEARLY',
  'FREQ=HOURLY',
  'FREQ=HOURLY;INTERVAL=2',
  `FREQ=HOURLY;INTERVAL=2;${HOURS(24)}`,
  `FREQ=HOURLY;${MINUTES(4)}`,
  `FREQ=WEEKLY;${HOURS(24)};${MINUTES(2)}`,
  `FREQ=WEEKLY;${HOURS(24)};${MINUTES(30)}`,
  `FREQ=DAILY;${HOURS(24)};${MINUTES(30)}`,
  `FREQ=MINUTELY;INTERVAL=30`,
  'FREQ=MINUTELY',
  'FREQ=SECONDLY',
  `FREQ=MONTHLY;${HOURS(24)};${MINUTES(60)}`,
  // 非 ordinal 的 BYDAY 在 MONTHLY 下是「每個月的所有星期一」，不是一天。
  `FREQ=MONTHLY;BYDAY=MO;${HOURS(20)};${MINUTES(20)}`,
  `FREQ=YEARLY;BYDAY=MO;${HOURS(20)};${MINUTES(20)}`,
  `FREQ=MONTHLY;${HOURS(24)};${MINUTES(60)};BYSETPOS=1`,
  // 2100 是世紀年、不是閏年，所以 2064 起算的下一次要到 2136 —— look-ahead 內完全沒有輸出。
  `FREQ=YEARLY;INTERVAL=9;BYMONTH=2;BYMONTHDAY=29;${HOURS(24)};${MINUTES(60)};${SECONDS(60)}`,
  // INTERVAL 超過 look-ahead 的上限，同樣不能因為沒看到就放行。
  `FREQ=YEARLY;INTERVAL=401;BYMONTH=2;BYMONTHDAY=29;${HOURS(24)};${MINUTES(60)};${SECONDS(60)}`,
  // 第一次在 27 年後才發生，且當天 86,400 次；有限的 look-ahead 看不到它。
  `FREQ=YEARLY;INTERVAL=9;BYMONTH=2;BYMONTHDAY=29;${HOURS(24)};${MINUTES(60)};${SECONDS(60)}`,
];

/**
 * The check must never accept a rule that a real year-wide expansion cannot
 * handle. The reverse (rejecting something a single year happens to survive) is
 * allowed: the dense days may simply lie outside that year.
 */
describe('isExpandableEvent 不得比實際展開寬鬆', () => {
  for (const rule of RULES) {
    it(rule, { timeout: SLOW }, () => {
      const event = ev('2026-01-01', rule, '00:00');
      const accepted = isExpandableEvent(event);
      let expandable = true;
      try {
        resolveEventOccurrences(
          { events: [event], eventExceptions: [] },
          { startDate: '2026-01-01', endDate: '2026-12-31' },
        );
      } catch {
        expandable = false;
      }
      if (accepted) expect(expandable, `${rule} 被接受但實際展不開`).toBe(true);
    });
  }
});

/**
 * 反方向：實際展開得了的規則不能被誤擋。
 *
 * 只驗「接受的必須展得開」抓不到匯入能力的退步 —— BYSETPOS 那一條就是這樣
 * 溜過去的：它被誤擋，但因為誤擋是被允許的方向，測試不會亮紅燈。
 */
const MUST_ACCEPT: string[] = [
  'FREQ=DAILY',
  'FREQ=DAILY;COUNT=20000',
  'FREQ=WEEKLY;BYDAY=MO,WE,FR',
  'FREQ=MONTHLY;BYDAY=-1MO',
  'FREQ=YEARLY',
  'FREQ=HOURLY',
  'FREQ=HOURLY;COUNT=2',
  'FREQ=MINUTELY;COUNT=10',
  // BYSETPOS 只會把候選變少，不能被當成完整的候選集拒絕。
  `FREQ=MONTHLY;BYDAY=MO;${HOURS(24)};${MINUTES(60)};BYSETPOS=1`,
  // 每週一天 48 次，全年約 2,500 次。
  `FREQ=WEEKLY;${HOURS(24)};BYMINUTE=0,30`,
  // 12 個偶數小時已經對齊 INTERVAL，實際仍是 12 個小時。
  'FREQ=HOURLY;INTERVAL=2;BYHOUR=0,2,4,6,8,10,12,14,16,18,20,22',
  // 每 9 年一次、當天 1,440 次 —— 稀疏但安全，不能因為看起來密就擋掉。
  `FREQ=YEARLY;INTERVAL=9;${HOURS(24)};${MINUTES(60)}`,
];

describe('isExpandableEvent 不得誤擋展得開的規則', () => {
  for (const rule of MUST_ACCEPT) {
    it(rule, { timeout: SLOW }, () => {
      const event = ev('2026-01-05', rule, '00:00');
      // 先確認這條規則真的展得開，測試本身才有意義。
      expect(() =>
        resolveEventOccurrences(
          { events: [event], eventExceptions: [] },
          { startDate: '2026-01-01', endDate: '2026-12-31' },
        ),
      ).not.toThrow();
      expect(isExpandableEvent(event), `${rule} 展得開卻被擋下`).toBe(true);
    });
  }
});

/**
 * 未來才爆量的規則：look-ahead 內看不到輸出時必須 fail closed。
 *
 * 每一條都先證明它真的會爆 —— 展開那個真正命中的年份會拋例外 —— 測試才不是
 * 只在釘住現況。
 */
const MUST_REJECT: { rule: string; start: string; densYear: string }[] = [
  {
    // 2064 起算每 9 年：2100 是世紀年不閏，所以真正命中的是 2136。
    rule: `FREQ=YEARLY;INTERVAL=9;BYMONTH=2;BYMONTHDAY=29;${HOURS(24)};${MINUTES(60)};${SECONDS(60)}`,
    start: '2064-03-01',
    densYear: '2136',
  },
  {
    // 稀疏年份只有 2/28（6,000 筆），閏年才 2/28+2/29（12,000 筆）——
    // 先看到稀疏的那幾次就早判安全是不夠的。
    rule: `FREQ=YEARLY;INTERVAL=9;BYMONTH=2;BYMONTHDAY=28,29;${HOURS(24)};${MINUTES(50)};BYSECOND=0,1,2,3,4`,
    start: '2064-03-01',
    densYear: '2136',
  },
  {
    // INTERVAL 比 look-ahead 的上限還長。
    rule: `FREQ=YEARLY;INTERVAL=401;BYMONTH=2;BYMONTHDAY=29;${HOURS(24)};${MINUTES(60)};${SECONDS(60)}`,
    start: '2064-03-01',
    densYear: '3668',
  },
];

describe('look-ahead 內沒有輸出時必須擋下', () => {
  for (const { rule, start, densYear } of MUST_REJECT) {
    it(`${start} ${rule}`, { timeout: SLOW }, () => {
      const event = ev(start, rule, '00:00');
      // 先證明它真的展不開，這個測試才有意義。
      expect(() =>
        resolveEventOccurrences(
          { events: [event], eventExceptions: [] },
          { startDate: `${densYear}-01-01`, endDate: `${densYear}-12-31` },
        ),
      ).toThrow();
      expect(isExpandableEvent(event), `${rule} 未來會爆量卻被放行`).toBe(false);
    });
  }
});
