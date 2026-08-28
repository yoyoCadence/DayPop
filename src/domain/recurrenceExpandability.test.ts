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

const HOURS = (n: number) => `BYHOUR=${Array.from({ length: n }, (_, i) => i).join(',')}`;
const MINUTES = (n: number) => `BYMINUTE=${Array.from({ length: n }, (_, i) => i).join(',')}`;

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
];

/**
 * The check must never accept a rule that a real year-wide expansion cannot
 * handle. The reverse (rejecting something a single year happens to survive) is
 * allowed: the dense days may simply lie outside that year.
 */
describe('isExpandableEvent 不得比實際展開寬鬆', () => {
  for (const rule of RULES) {
    it(rule, () => {
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
