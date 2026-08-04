import type { Tables, TablesInsert } from '../lib/database.types';
import type {
  Calendar,
  CalendarEvent,
  EventException,
  Sticker,
  TodoItem,
  UserPreferences,
} from './types';
import {
  parseCalendar,
  parseCalendarEvent,
  parseDomainId,
  parseEventException,
  parseSticker,
  parseTodo,
  parseUserPreferences,
} from './validation';

export function calendarFromRow(row: Tables<'calendars'>): Calendar {
  return parseCalendar({
    id: row.id,
    name: row.name,
    color: row.color,
    isVisible: row.is_visible,
    isDefault: row.is_default,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function calendarToInsert(
  calendar: Calendar,
  ownerId: string,
): TablesInsert<'calendars'> {
  const valid = parseCalendar(calendar);
  const validOwnerId = parseDomainId(ownerId, 'ownerId');
  return {
    id: valid.id,
    owner_id: validOwnerId,
    name: valid.name,
    color: valid.color,
    is_visible: valid.isVisible,
    is_default: valid.isDefault,
    sort_order: valid.sortOrder,
  };
}

export function eventFromRow(row: Tables<'events'>): CalendarEvent {
  const common = {
    id: row.id,
    calendarId: row.calendar_id,
    title: row.title,
    location: row.location,
    notes: row.notes,
    reminderMinutes: row.reminder_minutes,
    recurrence: row.recurrence_rule === null ? null : { rule: row.recurrence_rule },
    sharingScope: row.sharing_scope,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return row.is_all_day
    ? parseCalendarEvent({
        ...common,
        allDay: true,
        startDate: row.start_date,
        endDate: row.end_date,
      })
    : parseCalendarEvent({
        ...common,
        allDay: false,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        timezone: row.timezone,
      });
}

export function eventToInsert(
  event: CalendarEvent,
  ownerId: string,
): TablesInsert<'events'> {
  const valid = parseCalendarEvent(event);
  const validOwnerId = parseDomainId(ownerId, 'ownerId');
  const common: TablesInsert<'events'> = {
    id: valid.id,
    owner_id: validOwnerId,
    calendar_id: valid.calendarId,
    title: valid.title,
    location: valid.location,
    notes: valid.notes,
    reminder_minutes: valid.reminderMinutes,
    recurrence_rule: valid.recurrence?.rule ?? null,
    sharing_scope: valid.sharingScope,
    is_all_day: valid.allDay,
  };
  return valid.allDay
    ? {
        ...common,
        start_date: valid.startDate,
        end_date: valid.endDate,
        starts_at: null,
        ends_at: null,
        timezone: null,
      }
    : {
        ...common,
        start_date: null,
        end_date: null,
        starts_at: valid.startsAt,
        ends_at: valid.endsAt,
        timezone: valid.timezone,
      };
}

export function eventExceptionFromRow(row: Tables<'event_exceptions'>): EventException {
  const occurrence =
    row.occurrence_date === null
      ? { kind: 'timed' as const, startsAt: row.occurrence_starts_at }
      : { kind: 'all-day' as const, date: row.occurrence_date };
  return parseEventException({
    id: row.id,
    eventId: row.event_id,
    occurrence,
    isCancelled: row.is_cancelled,
    replacementEventId: row.replacement_event_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function eventExceptionToInsert(
  exception: EventException,
  ownerId: string,
): TablesInsert<'event_exceptions'> {
  const valid = parseEventException(exception);
  const validOwnerId = parseDomainId(ownerId, 'ownerId');
  return {
    id: valid.id,
    owner_id: validOwnerId,
    event_id: valid.eventId,
    occurrence_date: valid.occurrence.kind === 'all-day' ? valid.occurrence.date : null,
    occurrence_starts_at:
      valid.occurrence.kind === 'timed' ? valid.occurrence.startsAt : null,
    is_cancelled: valid.isCancelled,
    replacement_event_id: valid.replacementEventId,
  };
}

export function todoFromRow(row: Tables<'todos'>): TodoItem {
  return parseTodo({
    id: row.id,
    calendarId: row.calendar_id,
    parentId: row.parent_id,
    title: row.title,
    dueDate: row.due_date,
    priority: row.priority,
    completedAt: row.completed_at,
    sortOrder: row.sort_order,
    sharingScope: row.sharing_scope,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function todoToInsert(todo: TodoItem, ownerId: string): TablesInsert<'todos'> {
  const valid = parseTodo(todo);
  const validOwnerId = parseDomainId(ownerId, 'ownerId');
  return {
    id: valid.id,
    owner_id: validOwnerId,
    calendar_id: valid.calendarId,
    parent_id: valid.parentId,
    title: valid.title,
    due_date: valid.dueDate,
    priority: valid.priority,
    completed_at: valid.completedAt,
    sort_order: valid.sortOrder,
    sharing_scope: valid.sharingScope,
  };
}

export function stickerFromRow(row: Tables<'stickers'>): Sticker {
  return parseSticker({
    id: row.id,
    calendarId: row.calendar_id,
    date: row.sticker_date,
    glyph: row.glyph,
    assetKey: row.asset_key,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function stickerToInsert(sticker: Sticker, ownerId: string): TablesInsert<'stickers'> {
  const valid = parseSticker(sticker);
  const validOwnerId = parseDomainId(ownerId, 'ownerId');
  return {
    id: valid.id,
    owner_id: validOwnerId,
    calendar_id: valid.calendarId,
    sticker_date: valid.date,
    glyph: valid.glyph,
    asset_key: valid.assetKey,
    sort_order: valid.sortOrder,
  };
}

export function preferencesFromRow(row: Tables<'user_preferences'>): UserPreferences {
  return parseUserPreferences({
    timezone: row.timezone,
    weekStartsOn: row.week_starts_on,
    theme: row.theme,
    // DB rename to fixed_six_week_grid remains DP-018. Until then 4/5 both
    // collapse to the only meaningful non-fixed domain state.
    calendarGridMode: row.month_weeks === 6 ? 'fixed-six' : 'adaptive',
    defaultReminderMinutes: row.default_reminder_minutes,
    petName: row.pet_name,
    petEnabled: row.pet_enabled,
  });
}

export function preferencesToInsert(
  preferences: UserPreferences,
  userId: string,
): TablesInsert<'user_preferences'> {
  const valid = parseUserPreferences(preferences);
  const validUserId = parseDomainId(userId, 'userId');
  return {
    user_id: validUserId,
    timezone: valid.timezone,
    week_starts_on: valid.weekStartsOn,
    theme: valid.theme,
    // Compatibility encoding only; DP-018 replaces this numeric DB column.
    month_weeks: valid.calendarGridMode === 'fixed-six' ? 6 : 4,
    default_reminder_minutes: valid.defaultReminderMinutes,
    pet_name: valid.petName,
    pet_enabled: valid.petEnabled,
  };
}
