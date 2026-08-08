export type DateKey = string;
export type IsoInstant = string;
export type SharingScope = 'inherit' | 'private';
export type TodoPriority = 'none' | 'low' | 'medium' | 'high';
export type CalendarGridMode = 'adaptive' | 'fixed-six';
export type ThemeId = 'manga' | 'minimal' | 'warm' | 'business' | 'vivid' | 'pixel';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface Calendar {
  id: string;
  name: string;
  color: string;
  isVisible: boolean;
  isDefault: boolean;
  sortOrder: number;
  createdAt: IsoInstant;
  updatedAt: IsoInstant;
}

/** RFC 5545 rule text. Expansion and DST behaviour belong to DP-027. */
export interface Recurrence {
  rule: string;
}

interface CalendarEventBase {
  id: string;
  calendarId: string;
  title: string;
  location: string | null;
  notes: string | null;
  /** Up to 10 reminders, each 0–10080 minutes before the event. */
  reminderMinutes: number[];
  recurrence: Recurrence | null;
  sharingScope: SharingScope;
  createdAt: IsoInstant;
  updatedAt: IsoInstant;
}

export interface AllDayCalendarEvent extends CalendarEventBase {
  allDay: true;
  /** Inclusive DayPop boundary; an ICS adapter must add one day for DTEND. */
  startDate: DateKey;
  endDate: DateKey;
}

export interface TimedCalendarEvent extends CalendarEventBase {
  allDay: false;
  startsAt: IsoInstant;
  endsAt: IsoInstant;
  timezone: string;
}

export type CalendarEvent = AllDayCalendarEvent | TimedCalendarEvent;

export type EventOccurrence =
  | { kind: 'all-day'; date: DateKey }
  | { kind: 'timed'; startsAt: IsoInstant };

interface EventExceptionBase {
  id: string;
  eventId: string;
  occurrence: EventOccurrence;
  createdAt: IsoInstant;
  updatedAt: IsoInstant;
}

export interface CancelledEventException extends EventExceptionBase {
  isCancelled: true;
  replacementEventId: null;
}

export interface ReplacementEventException extends EventExceptionBase {
  isCancelled: false;
  replacementEventId: string;
}

export type EventException = CancelledEventException | ReplacementEventException;

export interface TodoItem {
  id: string;
  calendarId: string;
  parentId: string | null;
  title: string;
  dueDate: DateKey | null;
  priority: TodoPriority;
  completedAt: IsoInstant | null;
  sortOrder: number;
  sharingScope: SharingScope;
  createdAt: IsoInstant;
  updatedAt: IsoInstant;
}

export interface Sticker {
  id: string;
  calendarId: string;
  date: DateKey;
  glyph: string | null;
  assetKey: string | null;
  sortOrder: number;
  createdAt: IsoInstant;
  updatedAt: IsoInstant;
}

export interface UserPreferences {
  timezone: string;
  weekStartsOn: 0 | 1;
  theme: ThemePreference;
  themeId: ThemeId;
  calendarGridMode: CalendarGridMode;
  /** Up to 10 reminders, each 0–10080 minutes before an event. */
  defaultReminderMinutes: number[];
  petName: string;
  petEnabled: boolean;
}

export interface DayPopUserData {
  calendars: Calendar[];
  events: CalendarEvent[];
  eventExceptions: EventException[];
  todos: TodoItem[];
  stickers: Sticker[];
  preferences: UserPreferences;
}

export const DEFAULT_CALENDAR_NAME = '我的日曆';
export const DEFAULT_CALENDAR_COLOR = '#F06C5C';

export interface EmptyUserDataOptions {
  idFactory?: () => string;
  now?: string;
}

export function createEmptyUserData(options: EmptyUserDataOptions = {}): DayPopUserData {
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? createDomainId;
  return {
    calendars: [
      {
        id: idFactory(),
        name: DEFAULT_CALENDAR_NAME,
        color: DEFAULT_CALENDAR_COLOR,
        isVisible: true,
        isDefault: true,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    events: [],
    eventExceptions: [],
    todos: [],
    stickers: [],
    preferences: {
      timezone: 'Asia/Taipei',
      weekStartsOn: 0,
      // New users start in the canonical 漫畫 light theme. Existing saved
      // values are preserved by the v2 -> v3 local migration and DB migration.
      theme: 'light',
      themeId: 'manga',
      calendarGridMode: 'adaptive',
      defaultReminderMinutes: [],
      petName: '摩卡',
      petEnabled: true,
    },
  };
}

export function createDomainId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.random() * 256;
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}
