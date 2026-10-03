import { addDays, toDateKey } from './date';

/**
 * Natural-language parser for the calendar quick-add row.
 *
 * Ported from `parseQuick()` in `日曆桌寵 Calendar Pet.dc.html`, including the
 * order in which fragments are stripped from the string — that order decides
 * what is left over as the title, so it is part of the behaviour, not an
 * implementation detail.
 * DP-075 extends only the clock grammar (ADR §6); unrecognised clocks remain
 * visible in the draft instead of being truncated into a valid time.
 *
 * The原檔 optionally routes the same string through an AI parser first when the
 * user has supplied their own API key. DayPop does not: storing a provider
 * secret in the browser is exactly what DP-043 exists to remove.
 */

export type QuickAddRepeat = 'none' | 'daily' | 'weekday' | 'weekly' | 'monthly' | 'yearly';

export interface QuickAddDraft {
  title: string;
  /** `YYYY-MM-DD` */
  date: string;
  allDay: boolean;
  /** `HH:MM`, defaults to 09:00 for all-day input, matching the原檔. */
  start: string;
  /** `HH:MM`, one hour after `start`. */
  end: string;
  /**
   * Recognised but not stored by quick add yet. DP-014 hands this draft to the
   * event sheet; DP-027 owns recurrence expansion and occurrence semantics.
   */
  repeat: QuickAddRepeat;
  /** Recognised but not stored by quick add until the event sheet is wired. */
  reminderMinutes: number;
  /** Recognised but not stored by quick add until the event sheet is wired. */
  location: string;
}

const REPEAT_WORDS: [string, QuickAddRepeat][] = [
  ['每天', 'daily'],
  ['每日', 'daily'],
  ['工作日', 'weekday'],
  ['平日', 'weekday'],
  ['每週', 'weekly'],
  ['每周', 'weekly'],
  ['每月', 'monthly'],
  ['每年', 'yearly'],
];

const RELATIVE_DAYS: [string, number][] = [
  ['大後天', 3],
  ['後天', 2],
  ['明天', 1],
  ['明日', 1],
  ['今天', 0],
  ['今日', 0],
];

const WEEKDAYS: Record<string, number> = {
  週日: 0, 週一: 1, 週二: 2, 週三: 3, 週四: 4, 週五: 5, 週六: 6,
  周日: 0, 周一: 1, 周二: 2, 周三: 3, 周四: 4, 周五: 5, 周六: 6,
  星期日: 0, 星期一: 1, 星期二: 2, 星期三: 3, 星期四: 4, 星期五: 5, 星期六: 6,
};

// Include unsupported numeric forms in the candidate so "一百三點" cannot
// accidentally match just its valid suffix "三點".
const NUMBER_CHARACTERS = '0-9０-９零〇一二兩两三四五六七八九十百千萬万億亿廿卅卌壹貳贰參叁肆伍陸陆柒捌玖拾佰仟';
const CLOCK = new RegExp(
  `(?<![${NUMBER_CHARACTERS}])([${NUMBER_CHARACTERS}]+)\\s*([:：點点時时])`,
);
const CLOCK_MINUTES = new RegExp(
  `^(\\s*)(半|一刻|三刻|[${NUMBER_CHARACTERS}]+)(\\s*(?:分鐘|分钟|分))?`,
);
const RELATIVE_CLOCK = new RegExp(`差\\s*[${NUMBER_CHARACTERS}]+\\s*(?:分鐘|分钟|分|刻)`);
const CHINESE_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** Parse a complete numeric token; never fall back to a numeric prefix. */
function clockNumber(token: string): number | null {
  const normalized = token.replace(/[０-９]/g, (digit) =>
    String(digit.charCodeAt(0) - '０'.charCodeAt(0)),
  );
  if (/^\d{1,2}$/.test(normalized)) return Number(normalized);
  if (token.length === 1 && token in CHINESE_DIGITS) return CHINESE_DIGITS[token]!;
  const leadingZero = token.match(/^[零〇]([一二三四五六七八九])$/);
  if (leadingZero) return CHINESE_DIGITS[leadingZero[1]!]!;
  const tens = token.match(/^([一二兩两三四五六七八九])?十([一二三四五六七八九])?$/);
  if (!tens) return null;
  return (tens[1] ? CHINESE_DIGITS[tens[1]]! : 1) * 10
    + (tens[2] ? CHINESE_DIGITS[tens[2]]! : 0);
}

function parseClock(text: string): { hour: number; minute: number; token: string } | null {
  const clock = text.match(CLOCK);
  if (!clock || RELATIVE_CLOCK.test(text)) return null;
  const hour = clockNumber(clock[1]!);
  if (hour === null || hour > 23) return null;
  const tail = text.slice(clock.index! + clock[0].length);
  let minutes = tail.match(CLOCK_MINUTES);
  if (minutes && tail.slice(minutes[0].length).startsWith('刻')) return null;
  // A number at the beginning of a separate title is not a minute field.
  // Attached clocks such as "三點十五開會" and explicit "三點 三十分" work.
  if (minutes?.[1] && !minutes[3]
    && !['半', '一刻', '三刻'].includes(minutes[2]!)
    && /^[^\s，,、。]/.test(tail.slice(minutes[0].length))) {
    minutes = null;
  }
  const isColon = /[:：]/.test(clock[2]!);
  if (isColon && (!minutes || ['半', '一刻', '三刻'].includes(minutes[2]!))) return null;
  const minute = !minutes ? 0
    : minutes[2] === '半' ? 30
      : minutes[2] === '一刻' ? 15
        : minutes[2] === '三刻' ? 45
          : clockNumber(minutes[2]!);
  if (minute === null || minute > 59) return null;
  return { hour, minute, token: clock[0] + (minutes?.[0] ?? '') };
}

export function parseQuickAdd(input: string, now: Date = new Date()): QuickAddDraft | null {
  let rest = input.trim();
  if (!rest) return null;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  let date = toDateKey(today);
  let location = '';
  let reminderMinutes = 10;
  let repeat: QuickAddRepeat = 'none';

  for (const [word, value] of REPEAT_WORDS) {
    if (rest.includes(word)) {
      repeat = value;
      rest = rest.replace(word, '');
      break;
    }
  }

  const reminder = rest.match(/(?:提前|提醒|前)\s*(\d{1,3})\s*(分鐘|分|小時)?/);
  if (reminder) {
    let minutes = Number.parseInt(reminder[1] ?? '0', 10);
    if (/小時/.test(reminder[2] ?? '')) minutes *= 60;
    reminderMinutes = minutes;
    rest = rest.replace(reminder[0], '');
  }

  const place = rest.match(/(?:@|＠|在)\s*([^ \u3000,，]+)/);
  if (place) {
    location = place[1] ?? '';
    rest = rest.replace(place[0], '');
  }

  for (const [word, offset] of RELATIVE_DAYS) {
    if (rest.includes(word)) {
      date = toDateKey(addDays(today, offset));
      rest = rest.replace(word, '');
      break;
    }
  }

  for (const [word, weekday] of Object.entries(WEEKDAYS)) {
    if (rest.includes(word)) {
      // The原檔 always jumps forward: naming today's weekday means next week.
      let offset = (weekday - today.getDay() + 7) % 7;
      if (offset === 0) offset = 7;
      date = toDateKey(addDays(today, offset));
      rest = rest.replace(word, '');
      break;
    }
  }

  let hour: number | null = null;
  let minute = 0;
  const isPm = /下午|晚上|傍晚/.test(rest);
  const isAm = /上午|早上|清晨/.test(rest);
  const isNoon = /中午/.test(rest);

  const time = parseClock(rest);
  if (time) {
    hour = time.hour;
    minute = time.minute;
    rest = rest.replace(time.token, '');
  }
  if (isNoon && hour === null && !CLOCK.test(rest) && !RELATIVE_CLOCK.test(rest)) hour = 12;
  if (hour !== null) {
    if (isPm && hour < 12) hour += 12;
    if (isAm && hour === 12) hour = 0;
    rest = rest.replace(/(上午|下午|晚上|早上|傍晚|清晨|中午)/g, '');
  }

  rest = rest.replace(/[，,、和跟與在]/g, ' ');

  const allDay = hour === null;
  const start = hour === null ? '09:00' : `${pad(hour)}:${pad(minute)}`;
  const title = rest.trim().replace(/\s+/g, ' ');

  return {
    title,
    date,
    allDay,
    start,
    end: addOneHour(start),
    repeat,
    reminderMinutes,
    location,
  };
}

/** Fragments that were understood but cannot be stored by today's data model. */
export function unsupportedQuickAddParts(draft: QuickAddDraft): string[] {
  const parts: string[] = [];
  if (draft.repeat !== 'none') parts.push('重複');
  if (draft.location) parts.push('地點');
  if (draft.reminderMinutes !== 10) parts.push('提醒');
  return parts;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function addOneHour(time: string): string {
  const [hour = 9, minute = 0] = time.split(':').map(Number);
  return `${pad((hour + 1) % 24)}:${pad(minute)}`;
}
