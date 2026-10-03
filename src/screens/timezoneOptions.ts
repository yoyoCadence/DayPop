import { wallTimeToInstant } from '../domain/eventTime';
import { isDateKey } from '../domain/validation';

/**
 * 設定「預設時區」的選項清單。
 *
 * 城市與順序逐字搬自原稿 `日曆桌寵 Calendar Pet.dc.html` :332（含「洛杉矶」的
 * 簡體字）。**offset 不逐字搬移**：原稿把它寫死在字串裡（`洛杉矶 (GMT-8)`、
 * `紐約 (GMT-5)`、`倫敦 (GMT+0)`、`雪梨 (GMT+11)`），但這四個是有夏令時間的
 * 時區，寫死的數字一年裡有一半是錯的 —— 2026-08 當下實際是 GMT-7、-4、+1、+10。
 * 讓使用者照著錯的 offset 挑時區會直接選錯，所以改由 `Intl` 依當下日期產生。
 * 沒有 DST 的台北／東京／上海／香港／新加坡／首爾結果與原稿逐字相同。
 */
const TIMEZONE_CITIES: { value: string; city: string }[] = [
  { value: 'Asia/Taipei', city: '台北' },
  { value: 'Asia/Tokyo', city: '東京' },
  { value: 'Asia/Shanghai', city: '上海' },
  { value: 'Asia/Hong_Kong', city: '香港' },
  { value: 'Asia/Singapore', city: '新加坡' },
  { value: 'Asia/Seoul', city: '首爾' },
  { value: 'America/Los_Angeles', city: '洛杉矶' },
  { value: 'America/New_York', city: '紐約' },
  { value: 'Europe/London', city: '倫敦' },
  { value: 'Australia/Sydney', city: '雪梨' },
  // 原稿的 UTC 選項本來就沒有 offset 後綴，維持原樣。
  { value: 'UTC', city: 'UTC' },
];

/** 原稿 :605 的事件選單，與設定 :332 的 11 個選項不同。 */
const EVENT_TIMEZONE_CITIES = [
  { value: 'Asia/Taipei', city: '台北' },
  { value: 'Asia/Tokyo', city: '東京' },
  { value: 'America/Los_Angeles', city: '洛杉磯' },
  { value: 'Europe/London', city: '倫敦' },
  { value: 'UTC', city: 'UTC' },
];

export interface TimezoneOption {
  value: string;
  label: string;
}

/**
 * `GMT+08:00` → `GMT+8`、`GMT+05:30` → `GMT+5:30`、`GMT` → `GMT+0`。
 * 取不到（時區字串不被這個 runtime 認得）時回 `null`，由呼叫端只顯示城市名。
 */
export function zoneOffsetLabel(zone: string, at: Date): string | null {
  let raw: string | undefined;
  try {
    raw = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value;
  } catch {
    return null;
  }
  if (!raw) return null;
  if (raw === 'GMT' || raw === 'UTC') return 'GMT+0';
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(raw);
  if (!match) return null;
  const [, sign, hours, minutes] = match;
  return minutes === '00' ? `GMT${sign}${Number(hours)}` : `GMT${sign}${Number(hours)}:${minutes}`;
}

/**
 * 使用者實際保存的值可以是任何 IANA 時區 —— legacy 匯入與 .ics 匯入都可能
 * 帶進清單外的值 —— 所以會把當前值補進清單，避免 select 顯示空白並在下一次
 * 變更時把它默默改掉。
 */
export function timezoneOptions(current: string, at: Date): TimezoneOption[] {
  return optionsFor(TIMEZONE_CITIES, current, (zone) => zoneOffsetLabel(zone, at));
}

/** Labels use each candidate city's reading of the draft's own wall clock. */
export function eventTimezoneOptions(current: string, date: string, start: string): TimezoneOption[] {
  const complete = isDateKey(date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(start);
  return optionsFor(EVENT_TIMEZONE_CITIES, current, (zone) => {
    if (!complete) return null;
    try {
      return zoneOffsetLabel(zone, new Date(wallTimeToInstant(date, start, zone)));
    } catch {
      return null;
    }
  });
}

function optionsFor(
  cities: { value: string; city: string }[],
  current: string,
  offsetFor: (zone: string) => string | null,
): TimezoneOption[] {
  const known = cities.map(({ value, city }) => {
    if (value === 'UTC') return { value, label: city };
    const offset = offsetFor(value);
    return { value, label: offset ? `${city} (${offset})` : city };
  });
  if (known.some((option) => option.value === current)) return known;
  const offset = offsetFor(current);
  return [...known, { value: current, label: offset ? `${current} (${offset})` : current }];
}
