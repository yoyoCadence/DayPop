import { addDays, fromDateKey, toDateKey } from '../domain/date';
import { timedEventFromWallTime, wallTimeToInstant } from '../domain/eventTime';
import type {
  Calendar,
  CalendarEvent,
  DayPopUserData,
  EventException,
  Sticker,
  TodoItem,
  TodoPriority,
  UserPreferences,
} from '../domain/types';
import { createDomainId } from '../domain/types';
import { isDateKey, isIanaTimezone, parseDayPopUserData } from '../domain/validation';

export const LEGACY_STORAGE_KEY = 'calpet.v2';

const LIMITS = {
  calendars: 100,
  events: 10_000,
  eventExceptions: 50_000,
  todos: 20_000,
  stickers: 10_000,
} as const;

type JsonRecord = Record<string, unknown>;

export interface LegacyImportPreview {
  calendars: number;
  events: number;
  eventExceptions: number;
  todos: number;
  stickers: number;
  remappedDuplicateIds: number;
  skippedInvitees: number;
  skippedAttachments: number;
  containedAiKey: boolean;
}

export interface LegacyImportPlan {
  imported: Pick<DayPopUserData, 'calendars' | 'events' | 'eventExceptions' | 'todos' | 'stickers'>;
  preferences: UserPreferences;
  preview: LegacyImportPreview;
}

export interface LegacyImportPayload {
  calendars: Array<{
    id: string;
    name: string;
    color: string;
    is_visible: boolean;
    sort_order: number;
  }>;
  events: Array<{
    id: string;
    calendar_id: string;
    title: string;
    is_all_day: boolean;
    start_date: string | null;
    end_date: string | null;
    starts_at: string | null;
    ends_at: string | null;
    timezone: string | null;
    location: string | null;
    notes: string | null;
    reminder_minutes: number[];
    recurrence_rule: string | null;
  }>;
  event_exceptions: Array<{
    id: string;
    event_id: string;
    occurrence_date: string | null;
    occurrence_starts_at: string | null;
  }>;
  todos: Array<{
    id: string;
    calendar_id: string;
    parent_id: string | null;
    title: string;
    due_date: string | null;
    priority: TodoPriority;
    completed_at: string | null;
    sort_order: number;
  }>;
  stickers: Array<{
    id: string;
    calendar_id: string;
    sticker_date: string;
    glyph: string;
    sort_order: number;
  }>;
  preferences: {
    timezone: string;
    week_starts_on: 0 | 1;
    theme: UserPreferences['theme'];
    theme_id: UserPreferences['themeId'];
    fixed_six_week_grid: boolean;
    default_reminder_minutes: number[];
    pet_name: string;
    pet_enabled: boolean;
  };
}

export class LegacyImportValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`舊版資料無法安全匯入：${issues.join('；')}`);
    this.name = 'LegacyImportValidationError';
  }
}

interface BuildOptions {
  idFactory?: () => string;
  now?: string;
  today?: string;
}

/** Strictly converts the original prototype document without mutating its bytes. */
export function buildLegacyImportPlan(
  raw: string,
  current: DayPopUserData,
  options: BuildOptions = {},
): LegacyImportPlan {
  const root = parseRoot(raw);
  const issues: string[] = [];
  const idFactory = options.idFactory ?? createDomainId;
  const now = options.now ?? new Date().toISOString();
  const today = options.today ?? toDateKey(new Date());
  const settings = record(root.settings, 'settings', issues);
  const legacyCalendars = array(root.calendars, 'calendars', LIMITS.calendars, issues);
  const legacyEvents = array(root.events, 'events', LIMITS.events, issues);
  const legacyTodos = array(root.todos, 'todos', LIMITS.todos, issues);
  const legacyStickers = array(root.stickers, 'stickers', LIMITS.stickers, issues);
  if (issues.length) throw new LegacyImportValidationError(issues);

  const defaultCalendar = current.calendars.find((item) => item.isDefault);
  if (!defaultCalendar) throw new LegacyImportValidationError(['目前帳號缺少預設日曆']);

  const calendarIds = new Map<string, string>();
  const calendars = legacyCalendars.map((value, index): Calendar => {
    const item = record(value, `calendars[${index}]`, issues);
    const legacyId = text(item.id, `calendars[${index}].id`, 200, issues);
    if (calendarIds.has(legacyId)) issues.push(`calendars[${index}].id 重複，無法判定事件關聯`);
    const id = idFactory();
    calendarIds.set(legacyId, id);
    return {
      id,
      name: text(item.name, `calendars[${index}].name`, 80, issues),
      color: color(item.color, `calendars[${index}].color`, issues),
      isVisible: optionalBoolean(item.visible, true, `calendars[${index}].visible`, issues),
      isDefault: false,
      sortOrder: current.calendars.length + index,
      createdAt: now,
      updatedAt: now,
    };
  });

  const duplicateTracker = new DuplicateTracker();
  let skippedInvitees = 0;
  let skippedAttachments = 0;
  const events: CalendarEvent[] = [];
  const eventExceptions: EventException[] = [];

  legacyEvents.forEach((value, index) => {
    const path = `events[${index}]`;
    const item = record(value, path, issues);
    duplicateTracker.observe(item.id);
    const eventId = idFactory();
    const date = dateKey(item.date, `${path}.date`, issues);
    const calendarId = resolveCalendar(item.cal, calendarIds, defaultCalendar.id, `${path}.cal`, issues);
    const timezone = optionalTimezone(item.tz, optionalTimezone(settings.tz, current.preferences.timezone, 'settings.tz', issues), `${path}.tz`, issues);
    const recurrence = recurrenceRule(item.repeat, `${path}.repeat`, issues);
    const reminderMinutes = reminder(item.reminder, `${path}.reminder`, issues);
    const common = {
      id: eventId,
      calendarId,
      title: text(item.title, `${path}.title`, 300, issues),
      location: nullableText(item.location, `${path}.location`, 500, issues),
      notes: nullableText(item.notes, `${path}.notes`, 20_000, issues),
      reminderMinutes,
      recurrence: recurrence === null ? null : { rule: recurrence },
      sharingScope: 'inherit' as const,
      createdAt: now,
      updatedAt: now,
    };
    const allDay = optionalBoolean(item.allDay, false, `${path}.allDay`, issues);
    const event: CalendarEvent = allDay
      ? { ...common, allDay: true, startDate: date, endDate: date }
      : timedEventFromWallTime(
          common,
          {
            date,
            start: clock(item.start, `${path}.start`, issues),
            end: clock(item.end, `${path}.end`, issues),
          },
          timezone,
        );
    events.push(event);

    const exdates = optionalArray(item.exdates, `${path}.exdates`, LIMITS.eventExceptions, issues);
    if (exdates.length > 0 && recurrence === null) {
      issues.push(`${path}.exdates 只能用於重複行程`);
    }
    const seenExdates = new Set<string>();
    exdates.forEach((candidate, exceptionIndex) => {
      const occurrenceDate = dateKey(candidate, `${path}.exdates[${exceptionIndex}]`, issues);
      if (seenExdates.has(occurrenceDate)) return;
      seenExdates.add(occurrenceDate);
      eventExceptions.push({
        id: idFactory(),
        eventId,
        occurrence: allDay
          ? { kind: 'all-day', date: occurrenceDate }
          : {
              kind: 'timed',
              startsAt: wallTimeToInstant(
                occurrenceDate,
                clock(item.start, `${path}.start`, issues),
                timezone,
              ),
            },
        isCancelled: true,
        replacementEventId: null,
        createdAt: now,
        updatedAt: now,
      });
    });
    skippedInvitees += countOptionalArray(item.invitees, `${path}.invitees`, issues);
    skippedAttachments += countOptionalArray(item.attachments, `${path}.attachments`, issues);
  });

  if (eventExceptions.length > LIMITS.eventExceptions) {
    issues.push(`eventExceptions 超過上限 ${LIMITS.eventExceptions}`);
  }

  const todos: TodoItem[] = [];
  legacyTodos.forEach((value, index) => {
    const path = `todos[${index}]`;
    const item = record(value, path, issues);
    duplicateTracker.observe(item.id);
    const parentId = idFactory();
    const completedAt = optionalBoolean(item.done, false, `${path}.done`, issues) ? now : null;
    const dueDate = legacyTodoDate(item, today, path, issues);
    todos.push({
      id: parentId,
      calendarId: defaultCalendar.id,
      parentId: null,
      title: text(item.title, `${path}.title`, 300, issues),
      dueDate,
      priority: priority(item.priority, `${path}.priority`, issues),
      completedAt,
      sortOrder: todos.length,
      sharingScope: 'inherit',
      createdAt: now,
      updatedAt: now,
    });
    optionalArray(item.subs, `${path}.subs`, LIMITS.todos, issues).forEach((childValue, childIndex) => {
      const childPath = `${path}.subs[${childIndex}]`;
      const child = record(childValue, childPath, issues);
      duplicateTracker.observe(child.id);
      todos.push({
        id: idFactory(),
        calendarId: defaultCalendar.id,
        parentId,
        title: text(child.title, `${childPath}.title`, 300, issues),
        dueDate,
        priority: 'none',
        completedAt: optionalBoolean(child.done, false, `${childPath}.done`, issues) ? now : null,
        sortOrder: childIndex,
        sharingScope: 'inherit',
        createdAt: now,
        updatedAt: now,
      });
    });
  });
  if (todos.length > LIMITS.todos) issues.push(`todos（含子項）超過上限 ${LIMITS.todos}`);

  const stickers: Sticker[] = legacyStickers.map((value, index) => {
    const path = `stickers[${index}]`;
    const item = record(value, path, issues);
    duplicateTracker.observe(item.id);
    return {
      id: idFactory(),
      calendarId: defaultCalendar.id,
      date: dateKey(item.date, `${path}.date`, issues),
      glyph: text(item.glyph, `${path}.glyph`, 100, issues),
      assetKey: null,
      sortOrder: index,
      createdAt: now,
      updatedAt: now,
    };
  });

  const preferences = legacyPreferences(settings, current.preferences, issues);
  if (issues.length) throw new LegacyImportValidationError(issues);

  parseDayPopUserData({
    calendars: [...current.calendars, ...calendars],
    events: [...current.events, ...events],
    eventExceptions: [...current.eventExceptions, ...eventExceptions],
    todos: [...current.todos, ...todos],
    stickers: [...current.stickers, ...stickers],
    preferences,
  });

  return {
    imported: { calendars, events, eventExceptions, todos, stickers },
    preferences,
    preview: {
      calendars: calendars.length,
      events: events.length,
      eventExceptions: eventExceptions.length,
      todos: todos.length,
      stickers: stickers.length,
      remappedDuplicateIds: duplicateTracker.duplicates,
      skippedInvitees,
      skippedAttachments,
      containedAiKey: typeof settings.aiKey === 'string' && settings.aiKey.length > 0,
    },
  };
}

export function legacyPlanToPayload(plan: LegacyImportPlan): LegacyImportPayload {
  return {
    calendars: plan.imported.calendars.map((item) => ({
      id: item.id,
      name: item.name,
      color: item.color,
      is_visible: item.isVisible,
      sort_order: item.sortOrder,
    })),
    events: plan.imported.events.map((item) => ({
      id: item.id,
      calendar_id: item.calendarId,
      title: item.title,
      is_all_day: item.allDay,
      start_date: item.allDay ? item.startDate : null,
      end_date: item.allDay ? item.endDate : null,
      starts_at: item.allDay ? null : item.startsAt,
      ends_at: item.allDay ? null : item.endsAt,
      timezone: item.allDay ? null : item.timezone,
      location: item.location,
      notes: item.notes,
      reminder_minutes: item.reminderMinutes,
      recurrence_rule: item.recurrence?.rule ?? null,
    })),
    event_exceptions: plan.imported.eventExceptions.map((item) => ({
      id: item.id,
      event_id: item.eventId,
      occurrence_date: item.occurrence.kind === 'all-day' ? item.occurrence.date : null,
      occurrence_starts_at:
        item.occurrence.kind === 'timed' ? item.occurrence.startsAt : null,
    })),
    todos: plan.imported.todos.map((item) => ({
      id: item.id,
      calendar_id: item.calendarId,
      parent_id: item.parentId,
      title: item.title,
      due_date: item.dueDate,
      priority: item.priority,
      completed_at: item.completedAt,
      sort_order: item.sortOrder,
    })),
    stickers: plan.imported.stickers.map((item) => ({
      id: item.id,
      calendar_id: item.calendarId,
      sticker_date: item.date,
      glyph: item.glyph!,
      sort_order: item.sortOrder,
    })),
    preferences: {
      timezone: plan.preferences.timezone,
      week_starts_on: plan.preferences.weekStartsOn,
      theme: plan.preferences.theme,
      theme_id: plan.preferences.themeId,
      fixed_six_week_grid: plan.preferences.calendarGridMode === 'fixed-six',
      default_reminder_minutes: plan.preferences.defaultReminderMinutes,
      pet_name: plan.preferences.petName,
      pet_enabled: plan.preferences.petEnabled,
    },
  };
}

export async function fingerprintLegacyData(raw: string): Promise<string> {
  const root = parseRoot(raw);
  const sanitized = sanitizeFingerprintSource(root);
  const bytes = new TextEncoder().encode(stableJson(sanitized));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Excluded values do not enter the database and must not influence its retry marker. */
function sanitizeFingerprintSource(root: JsonRecord): JsonRecord {
  const sanitized: JsonRecord = { ...root };
  if (isRecord(root.settings)) {
    const safeSettings = { ...root.settings };
    delete safeSettings.aiKey;
    sanitized.settings = safeSettings;
  }
  if (Array.isArray(root.events)) {
    sanitized.events = root.events.map((value) => {
      if (!isRecord(value)) return value;
      const safeEvent = { ...value };
      delete safeEvent.invitees;
      delete safeEvent.attachments;
      return safeEvent;
    });
  }
  return sanitized;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function parseRoot(raw: string): JsonRecord {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new LegacyImportValidationError(['calpet.v2 不是有效的 JSON']);
  }
  if (!isRecord(value)) throw new LegacyImportValidationError(['最外層必須是物件']);
  return value;
}

function legacyPreferences(
  settings: JsonRecord,
  current: UserPreferences,
  issues: string[],
): UserPreferences {
  const themeId = optionalEnum(
    settings.themeId,
    ['manga', 'minimal', 'warm', 'business', 'vivid', 'pixel'] as const,
    current.themeId,
    'settings.themeId',
    issues,
  );
  const weekStartsOn = optionalEnum(settings.weekStart, [0, 1] as const, current.weekStartsOn, 'settings.weekStart', issues);
  const defaultReminderMinutes = reminder(settings.defaultRem, 'settings.defaultRem', issues);
  return {
    timezone: optionalTimezone(settings.tz, current.timezone, 'settings.tz', issues),
    weekStartsOn,
    theme: optionalBoolean(settings.dark, current.theme === 'dark', 'settings.dark', issues) ? 'dark' : 'light',
    themeId,
    calendarGridMode: legacyGridMode(
      settings.weeksShown,
      current.calendarGridMode,
      issues,
    ),
    defaultReminderMinutes,
    petName: optionalText(settings.petName, current.petName, 'settings.petName', 40, issues),
    petEnabled: optionalBoolean(settings.petEnabled, current.petEnabled, 'settings.petEnabled', issues),
  };
}

function legacyGridMode(
  value: unknown,
  fallback: UserPreferences['calendarGridMode'],
  issues: string[],
): UserPreferences['calendarGridMode'] {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === 6) return 'fixed-six';
  if (value === 4 || value === 5) return 'adaptive';
  issues.push('settings.weeksShown 必須是 4、5 或 6');
  return fallback;
}

function legacyTodoDate(item: JsonRecord, today: string, path: string, issues: string[]): string | null {
  if (item.date !== undefined && item.date !== null && item.date !== '') {
    return dateKey(item.date, `${path}.date`, issues);
  }
  if (item.when === undefined || item.when === null || item.when === '') return null;
  if (item.when === 'today') return today;
  if (item.when === 'tomorrow') return toDateKey(addDays(fromDateKey(today), 1));
  issues.push(`${path}.when 必須是 today 或 tomorrow`);
  return null;
}

function recurrenceRule(value: unknown, path: string, issues: string[]): string | null {
  if (value === undefined || value === null || value === '' || value === 'none') return null;
  const rules: Record<string, string> = {
    daily: 'FREQ=DAILY',
    weekday: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    weekly: 'FREQ=WEEKLY',
    monthly: 'FREQ=MONTHLY',
    yearly: 'FREQ=YEARLY',
  };
  if (typeof value === 'string' && rules[value]) return rules[value]!;
  issues.push(`${path} 是不支援的重複規則`);
  return null;
}

function reminder(value: unknown, path: string, issues: string[]): number[] {
  if (value === undefined || value === null || value === '' || value === 'none') return [];
  const minutes = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10_080) {
    issues.push(`${path} 必須是 0–10080 分鐘或 none`);
    return [];
  }
  return [minutes];
}

function priority(value: unknown, path: string, issues: string[]): TodoPriority {
  if (value === undefined || value === null || value === '') return 'none';
  if (value === 'mid') return 'medium';
  if (value === 'none' || value === 'low' || value === 'medium' || value === 'high') return value;
  issues.push(`${path} 是不支援的優先度`);
  return 'none';
}

function resolveCalendar(
  value: unknown,
  ids: Map<string, string>,
  fallback: string,
  path: string,
  issues: string[],
): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') {
    issues.push(`${path} 必須是字串`);
    return fallback;
  }
  const resolved = ids.get(value);
  if (!resolved) issues.push(`${path} 指向不存在的舊日曆 ${value}`);
  return resolved ?? fallback;
}

function array(value: unknown, path: string, limit: number, issues: string[]): unknown[] {
  if (!Array.isArray(value)) {
    issues.push(`${path} 必須是陣列`);
    return [];
  }
  if (value.length > limit) issues.push(`${path} 超過上限 ${limit}`);
  return value;
}

function optionalArray(value: unknown, path: string, limit: number, issues: string[]): unknown[] {
  if (value === undefined || value === null) return [];
  return array(value, path, limit, issues);
}

function countOptionalArray(value: unknown, path: string, issues: string[]): number {
  return optionalArray(value, path, 10_000, issues).length;
}

function record(value: unknown, path: string, issues: string[]): JsonRecord {
  if (!isRecord(value)) {
    issues.push(`${path} 必須是物件`);
    return {};
  }
  return value;
}

function text(value: unknown, path: string, max: number, issues: string[]): string {
  if (typeof value !== 'string' || value.trim() === '' || value.trim().length > max) {
    issues.push(`${path} 必須是 1–${max} 字的字串`);
    return '無效資料';
  }
  return value.trim();
}

function nullableText(value: unknown, path: string, max: number, issues: string[]): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) {
    issues.push(`${path} 必須是不超過 ${max} 字的字串`);
    return null;
  }
  return value;
}

function optionalText(value: unknown, fallback: string, path: string, max: number, issues: string[]): string {
  if (value === undefined || value === null || value === '') return fallback;
  return text(value, path, max, issues);
}

function dateKey(value: unknown, path: string, issues: string[]): string {
  if (!isDateKey(value)) {
    issues.push(`${path} 必須是有效的 YYYY-MM-DD`);
    return '1970-01-01';
  }
  return value;
}

function clock(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    issues.push(`${path} 必須是有效的 HH:MM`);
    return '00:00';
  }
  return value;
}

function color(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(value)) {
    issues.push(`${path} 必須是六位十六進位色碼`);
    return '#F06C5C';
  }
  return value;
}

function optionalTimezone(value: unknown, fallback: string, path: string, issues: string[]): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (!isIanaTimezone(value)) {
    issues.push(`${path} 必須是支援的 IANA timezone`);
    return fallback;
  }
  return value;
}

function optionalBoolean(value: unknown, fallback: boolean, path: string, issues: string[]): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') {
    issues.push(`${path} 必須是 boolean`);
    return fallback;
  }
  return value;
}

function optionalEnum<T extends readonly (string | number)[]>(
  value: unknown,
  values: T,
  fallback: T[number],
  path: string,
  issues: string[],
): T[number] {
  if (value === undefined || value === null || value === '') return fallback;
  if (!values.includes(value as never)) {
    issues.push(`${path} 值不受支援`);
    return fallback;
  }
  return value as T[number];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class DuplicateTracker {
  readonly #seen = new Set<string>();
  duplicates = 0;

  observe(value: unknown) {
    if (typeof value !== 'string' || value === '') return;
    if (this.#seen.has(value)) this.duplicates += 1;
    this.#seen.add(value);
  }
}
