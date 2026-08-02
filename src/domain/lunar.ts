/**
 * Lunar date and festival labels for the month grid.
 *
 * Ported from the `_LI` / `solar2lunar` / `_lDay` / `lunarCell` helpers of
 * `日曆桌寵 Calendar Pet.dc.html`. Presentation only — nothing here is stored,
 * and the month cell simply shows no lunar line when a date has no answer.
 *
 * The原檔 ships a packed lunar table covering 2024–2040 and DayPop keeps exactly
 * that range. Outside it `solarToLunar` returns `null`, which is why
 * `lunarCell` can still return a solar festival but no lunar day label.
 */

/** Packed lunar year info, 2024–2040, copied verbatim from the原檔. */
const LUNAR_INFO: Record<number, number> = {
  2024: 0x04b60,
  2025: 0x0a6e6,
  2026: 0x0a4e0,
  2027: 0x0d260,
  2028: 0x0ea65,
  2029: 0x0d530,
  2030: 0x05aa0,
  2031: 0x076a3,
  2032: 0x096d0,
  2033: 0x04afb,
  2034: 0x04ad0,
  2035: 0x0a4d0,
  2036: 0x1d0b6,
  2037: 0x0d250,
  2038: 0x0d520,
  2039: 0x0dd45,
  2040: 0x0b5a0,
};

/** First day covered by the table: 2024-02-10 is lunar 2024-01-01. */
const BASE_UTC = Date.UTC(2024, 1, 10);
const DAY_MS = 86_400_000;

const SOLAR_FESTIVALS: Record<string, string> = {
  '1-1': '元旦',
  '2-28': '和平日',
  '4-4': '兒童節',
  '4-5': '清明',
  '5-1': '勞動節',
  '10-10': '國慶',
  '12-25': '行憲',
};

const LUNAR_FESTIVALS: Record<string, string> = {
  '1-1': '春節',
  '1-15': '元宵',
  '5-5': '端午',
  '7-7': '七夕',
  '7-15': '中元',
  '8-15': '中秋',
  '9-9': '重陽',
  '12-8': '臘八',
};

const LUNAR_MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '臘'];
const LUNAR_DAY_DIGITS = '日一二三四五六七八九十';

export interface LunarDate {
  /** Lunar year. */
  year: number;
  /** Lunar month, 1–12. */
  month: number;
  isLeap: boolean;
  /** Lunar day of month, 1–30. */
  day: number;
}

export interface LunarCell {
  /** Festival name when the date is one, otherwise the lunar day label. */
  text: string;
  isFestival: boolean;
}

function leapMonth(year: number): number {
  return (LUNAR_INFO[year] ?? 0) & 0xf;
}

function monthDays(year: number, month: number): number {
  return (LUNAR_INFO[year] ?? 0) & (0x10000 >> month) ? 30 : 29;
}

function leapDays(year: number): number {
  if (!leapMonth(year)) return 0;
  return (LUNAR_INFO[year] ?? 0) & 0x10000 ? 30 : 29;
}

function yearDays(year: number): number {
  let total = 348;
  for (let bit = 0x8000; bit > 0x8; bit >>= 1) {
    if ((LUNAR_INFO[year] ?? 0) & bit) total += 1;
  }
  return total + leapDays(year);
}

export function solarToLunar(year: number, month: number, day: number): LunarDate | null {
  let offset = Math.round((Date.UTC(year, month - 1, day) - BASE_UTC) / DAY_MS);
  if (offset < 0 || LUNAR_INFO[year] === undefined) return null;

  let lunarYear = 2024;
  while (LUNAR_INFO[lunarYear] !== undefined) {
    const days = yearDays(lunarYear);
    if (offset < days) break;
    offset -= days;
    lunarYear += 1;
  }
  if (LUNAR_INFO[lunarYear] === undefined) return null;

  const leap = leapMonth(lunarYear);
  let lunarMonth = 1;
  let isLeap = false;
  for (;;) {
    const days = isLeap ? leapDays(lunarYear) : monthDays(lunarYear, lunarMonth);
    if (offset < days) break;
    offset -= days;
    if (!isLeap && lunarMonth === leap && leap > 0) {
      isLeap = true;
    } else if (isLeap) {
      isLeap = false;
      lunarMonth += 1;
    } else {
      lunarMonth += 1;
    }
  }

  return { year: lunarYear, month: lunarMonth, isLeap, day: offset + 1 };
}

/** 初一 … 三十 */
export function lunarDayLabel(day: number): string {
  if (day === 10) return '初十';
  if (day === 20) return '二十';
  if (day === 30) return '三十';
  if (day < 10) return `初${LUNAR_DAY_DIGITS[day]}`;
  if (day < 20) return `十${LUNAR_DAY_DIGITS[day - 10]}`;
  return `廿${LUNAR_DAY_DIGITS[day - 20]}`;
}

/**
 * The small second line inside a month cell: a festival name when there is one,
 * otherwise the lunar month name on lunar day 1 and the lunar day otherwise.
 */
export function lunarCell(date: Date): LunarCell {
  const lunar = solarToLunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const solarKey = `${date.getMonth() + 1}-${date.getDate()}`;
  let festival = SOLAR_FESTIVALS[solarKey] ?? '';

  if (lunar && !lunar.isLeap && !festival) {
    const lunarKey = `${lunar.month}-${lunar.day}`;
    if (LUNAR_FESTIVALS[lunarKey]) {
      festival = LUNAR_FESTIVALS[lunarKey];
    } else if (lunar.month === 12 && lunar.day === monthDays(lunar.year, 12)) {
      festival = '除夕';
    }
  }

  if (festival) return { text: festival, isFestival: true };
  if (!lunar) return { text: '', isFestival: false };

  const text =
    lunar.day === 1
      ? `${lunar.isLeap ? '閏' : ''}${LUNAR_MONTH_NAMES[lunar.month - 1]}月`
      : lunarDayLabel(lunar.day);
  return { text, isFestival: false };
}
