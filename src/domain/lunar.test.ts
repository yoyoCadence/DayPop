import { describe, expect, it } from 'vitest';
import { lunarCell, lunarDayLabel, solarToLunar } from './lunar';

describe('solarToLunar', () => {
  it('maps the table base date to lunar new year 2024', () => {
    expect(solarToLunar(2024, 2, 10)).toEqual({ year: 2024, month: 1, isLeap: false, day: 1 });
  });

  it('maps known lunar new years', () => {
    expect(solarToLunar(2025, 1, 29)).toMatchObject({ month: 1, day: 1 });
    expect(solarToLunar(2026, 2, 17)).toMatchObject({ month: 1, day: 1 });
  });

  it('advances one lunar day per solar day', () => {
    expect(solarToLunar(2026, 2, 18)).toMatchObject({ month: 1, day: 2 });
    expect(solarToLunar(2026, 2, 19)).toMatchObject({ month: 1, day: 3 });
  });

  it('returns null outside the原檔 table instead of guessing', () => {
    expect(solarToLunar(2023, 6, 1)).toBeNull();
    expect(solarToLunar(2041, 6, 1)).toBeNull();
    // Before the base date but inside a covered year.
    expect(solarToLunar(2024, 1, 1)).toBeNull();
  });
});

describe('lunarDayLabel', () => {
  it('uses the原檔 wording for every decade boundary', () => {
    expect(lunarDayLabel(1)).toBe('初一');
    expect(lunarDayLabel(9)).toBe('初九');
    expect(lunarDayLabel(10)).toBe('初十');
    expect(lunarDayLabel(11)).toBe('十一');
    expect(lunarDayLabel(20)).toBe('二十');
    expect(lunarDayLabel(21)).toBe('廿一');
    expect(lunarDayLabel(30)).toBe('三十');
  });
});

describe('lunarCell', () => {
  it('prefers a solar festival over the lunar day', () => {
    expect(lunarCell(new Date(2026, 0, 1))).toEqual({ text: '元旦', isFestival: true });
    expect(lunarCell(new Date(2026, 9, 10))).toEqual({ text: '國慶', isFestival: true });
  });

  it('labels lunar festivals', () => {
    expect(lunarCell(new Date(2026, 1, 17))).toEqual({ text: '春節', isFestival: true });
    expect(lunarCell(new Date(2026, 1, 16))).toEqual({ text: '除夕', isFestival: true });
  });

  it('shows the lunar month name on lunar day 1 and the day otherwise', () => {
    expect(lunarCell(new Date(2026, 1, 18))).toEqual({ text: '初二', isFestival: false });
    // 2026-03-19 is lunar 2/1.
    const monthStart = lunarCell(new Date(2026, 2, 19));
    expect(monthStart.text).toMatch(/月$/);
    expect(monthStart.isFestival).toBe(false);
  });

  it('falls back to an empty label outside the table', () => {
    expect(lunarCell(new Date(2050, 5, 15))).toEqual({ text: '', isFestival: false });
  });
});
