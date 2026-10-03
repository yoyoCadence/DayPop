import { describe, expect, it } from 'vitest';
import { eventTimezoneOptions } from './timezoneOptions';

describe('eventTimezoneOptions (DP-111)', () => {
  it('keeps the five event cities in the original order', () => {
    expect(eventTimezoneOptions('Asia/Taipei', '2026-08-13', '09:00')).toEqual([
      { value: 'Asia/Taipei', label: '台北 (GMT+8)' },
      { value: 'Asia/Tokyo', label: '東京 (GMT+9)' },
      { value: 'America/Los_Angeles', label: '洛杉磯 (GMT-7)' },
      { value: 'Europe/London', label: '倫敦 (GMT+1)' },
      { value: 'UTC', label: 'UTC' },
    ]);
  });
  it.each([
    ['2026-01-15', '09:00', 'GMT-8'], ['2026-08-13', '09:00', 'GMT-7'],
    ['2026-03-08', '01:30', 'GMT-8'], ['2026-03-08', '03:30', 'GMT-7'],
  ])('reads Los Angeles at the event wall clock %s %s', (date, start, offset) => {
    expect(eventTimezoneOptions('UTC', date, start).find((option) => option.value === 'America/Los_Angeles')?.label)
      .toBe(`洛杉磯 (${offset})`);
  });
  it('appends a stored non-menu timezone exactly once with its half-hour offset', () => {
    const options = eventTimezoneOptions('Asia/Kolkata', '2026-08-13', '09:00');
    expect(options).toHaveLength(6);
    expect(options[5]).toEqual({ value: 'Asia/Kolkata', label: 'Asia/Kolkata (GMT+5:30)' });
  });
  it.each([['', '09:00'], ['2026-02-30', '09:00'], ['2026-08-13', '']])(
    'does not guess an offset while the date/time is incomplete: %s %s', (date, start) => {
      expect(eventTimezoneOptions('UTC', date, start).map((option) => option.label))
        .toEqual(['台北', '東京', '洛杉磯', '倫敦', 'UTC']);
    },
  );
});
