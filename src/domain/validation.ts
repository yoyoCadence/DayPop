import type {
  Calendar,
  CalendarEvent,
  DayPopUserData,
  EventException,
  Sticker,
  TodoItem,
  UserPreferences,
} from './types';
import { isRecurrenceRule } from './recurrence';

export const MAX_REMINDER_COUNT = 10;
export const MAX_REMINDER_MINUTES = 7 * 24 * 60;

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; issues: string[] };

export class DomainValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`DayPop domain validation failed: ${issues.join('; ')}`);
    this.name = 'DomainValidationError';
  }
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
}

/** Requires an explicit UTC marker or numeric offset; local datetime strings are rejected. */
export function isIsoInstant(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function isIanaTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() !== value || value === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function validateDayPopUserData(value: unknown): ValidationResult<DayPopUserData> {
  const issues: string[] = [];
  if (!isRecord(value)) return failure('data must be an object');

  const calendars = validateArray(value.calendars, 'calendars', validateCalendar, issues);
  const events = validateArray(value.events, 'events', validateEvent, issues);
  const exceptions = validateArray(
    value.eventExceptions,
    'eventExceptions',
    validateEventException,
    issues,
  );
  const todos = validateArray(value.todos, 'todos', validateTodo, issues);
  const stickers = validateArray(value.stickers, 'stickers', validateSticker, issues);
  const preferences = validatePreferences(value.preferences, 'preferences', issues);

  if (!calendars || !events || !exceptions || !todos || !stickers || !preferences) {
    return { success: false, issues };
  }

  validateUniqueIds(calendars, 'calendars', issues);
  validateUniqueIds(events, 'events', issues);
  validateUniqueIds(exceptions, 'eventExceptions', issues);
  validateUniqueIds(todos, 'todos', issues);
  validateUniqueIds(stickers, 'stickers', issues);

  const calendarIds = new Set(calendars.map((calendar) => calendar.id));
  if (calendars.length === 0) issues.push('calendars must contain a default calendar');
  if (calendars.filter((calendar) => calendar.isDefault).length !== 1) {
    issues.push('calendars must contain exactly one default calendar');
  }
  for (const [index, item] of [...events, ...todos, ...stickers].entries()) {
    if (!calendarIds.has(item.calendarId)) {
      issues.push(`calendar owner item ${index} references missing calendar ${item.calendarId}`);
    }
  }

  const eventsById = new Map(events.map((event) => [event.id, event]));
  for (const [index, exception] of exceptions.entries()) {
    const source = eventsById.get(exception.eventId);
    if (!source) {
      issues.push(`eventExceptions[${index}].eventId references a missing event`);
    } else {
      if (source.recurrence === null) {
        issues.push(`eventExceptions[${index}].eventId must reference a recurring event`);
      }
      const expectedKind = source.allDay ? 'all-day' : 'timed';
      if (exception.occurrence.kind !== expectedKind) {
        issues.push(`eventExceptions[${index}].occurrence must match the source event shape`);
      }
    }
    if (
      exception.replacementEventId !== null &&
      !eventsById.has(exception.replacementEventId)
    ) {
      issues.push(`eventExceptions[${index}].replacementEventId references a missing event`);
    } else if (exception.replacementEventId !== null) {
      const replacement = eventsById.get(exception.replacementEventId)!;
      if (replacement.recurrence !== null) {
        issues.push(`eventExceptions[${index}] replacement event must not recur`);
      }
    }
  }

  const todosById = new Map(todos.map((todo) => [todo.id, todo]));
  for (const [index, todo] of todos.entries()) {
    if (todo.parentId === null) continue;
    const parent = todosById.get(todo.parentId);
    if (!parent) issues.push(`todos[${index}].parentId references a missing todo`);
    else if (parent.calendarId !== todo.calendarId) {
      issues.push(`todos[${index}].parentId must belong to the same calendar`);
    }
  }

  if (issues.length > 0) return { success: false, issues };
  return {
    success: true,
    data: { calendars, events, eventExceptions: exceptions, todos, stickers, preferences },
  };
}

export function parseDayPopUserData(value: unknown): DayPopUserData {
  const result = validateDayPopUserData(value);
  if (!result.success) throw new DomainValidationError(result.issues);
  return result.data;
}

export function parseCalendar(value: unknown): Calendar {
  return parseEntity(value, 'calendar', validateCalendar);
}

export function parseCalendarEvent(value: unknown): CalendarEvent {
  return parseEntity(value, 'event', validateEvent);
}

export function parseEventException(value: unknown): EventException {
  return parseEntity(value, 'eventException', validateEventException);
}

export function parseTodo(value: unknown): TodoItem {
  return parseEntity(value, 'todo', validateTodo);
}

export function parseSticker(value: unknown): Sticker {
  return parseEntity(value, 'sticker', validateSticker);
}

export function parseUserPreferences(value: unknown): UserPreferences {
  return parseEntity(value, 'preferences', validatePreferences);
}

export function parseDomainId(value: unknown, path = 'id'): string {
  const issues: string[] = [];
  if (!validateId(value, path, issues)) throw new DomainValidationError(issues);
  return value;
}

function validateCalendar(value: unknown, path: string, issues: string[]): Calendar | null {
  if (!isRecord(value)) return invalidObject(path, issues);
  const valid =
    validateId(value.id, `${path}.id`, issues) &&
    validateTrimmedString(value.name, `${path}.name`, issues) &&
    validateHexColor(value.color, `${path}.color`, issues) &&
    validateBoolean(value.isVisible, `${path}.isVisible`, issues) &&
    validateBoolean(value.isDefault, `${path}.isDefault`, issues) &&
    validateNonnegativeInteger(value.sortOrder, `${path}.sortOrder`, issues) &&
    validateInstant(value.createdAt, `${path}.createdAt`, issues) &&
    validateInstant(value.updatedAt, `${path}.updatedAt`, issues);
  return valid ? (value as unknown as Calendar) : null;
}

function validateEvent(value: unknown, path: string, issues: string[]): CalendarEvent | null {
  if (!isRecord(value)) return invalidObject(path, issues);
  let valid =
    validateId(value.id, `${path}.id`, issues) &&
    validateId(value.calendarId, `${path}.calendarId`, issues) &&
    validateTrimmedString(value.title, `${path}.title`, issues) &&
    validateNullableString(value.location, `${path}.location`, issues) &&
    validateNullableString(value.notes, `${path}.notes`, issues) &&
    validateReminderMinutes(value.reminderMinutes, `${path}.reminderMinutes`, issues) &&
    validateEnum(value.sharingScope, ['inherit', 'private'], `${path}.sharingScope`, issues) &&
    validateInstant(value.createdAt, `${path}.createdAt`, issues) &&
    validateInstant(value.updatedAt, `${path}.updatedAt`, issues);

  if (value.allDay === true) {
    valid = validateRecurrence(value.recurrence, `${path}.recurrence`, issues, true) && valid;
    valid = validateDate(value.startDate, `${path}.startDate`, issues) && valid;
    valid = validateDate(value.endDate, `${path}.endDate`, issues) && valid;
    if (hasDefined(value, ['startsAt', 'endsAt', 'timezone'])) {
      issues.push(`${path} all-day shape cannot contain timed fields`);
      valid = false;
    }
    if (isDateKey(value.startDate) && isDateKey(value.endDate) && value.endDate < value.startDate) {
      issues.push(`${path}.endDate must be on or after startDate`);
      valid = false;
    }
  } else if (value.allDay === false) {
    valid = validateRecurrence(value.recurrence, `${path}.recurrence`, issues, false) && valid;
    valid = validateInstant(value.startsAt, `${path}.startsAt`, issues) && valid;
    valid = validateInstant(value.endsAt, `${path}.endsAt`, issues) && valid;
    valid = validateTimezone(value.timezone, `${path}.timezone`, issues) && valid;
    if (hasDefined(value, ['startDate', 'endDate'])) {
      issues.push(`${path} timed shape cannot contain all-day fields`);
      valid = false;
    }
    if (
      isIsoInstant(value.startsAt) &&
      isIsoInstant(value.endsAt) &&
      Date.parse(value.endsAt) <= Date.parse(value.startsAt)
    ) {
      issues.push(`${path}.endsAt must be later than startsAt`);
      valid = false;
    }
  } else {
    issues.push(`${path}.allDay must be a boolean discriminator`);
    valid = false;
  }
  return valid ? (value as unknown as CalendarEvent) : null;
}

function validateEventException(
  value: unknown,
  path: string,
  issues: string[],
): EventException | null {
  if (!isRecord(value)) return invalidObject(path, issues);
  let valid =
    validateId(value.id, `${path}.id`, issues) &&
    validateId(value.eventId, `${path}.eventId`, issues) &&
    validateInstant(value.createdAt, `${path}.createdAt`, issues) &&
    validateInstant(value.updatedAt, `${path}.updatedAt`, issues);

  if (!isRecord(value.occurrence)) {
    issues.push(`${path}.occurrence must be an object`);
    valid = false;
  } else if (value.occurrence.kind === 'all-day') {
    valid = validateDate(value.occurrence.date, `${path}.occurrence.date`, issues) && valid;
  } else if (value.occurrence.kind === 'timed') {
    valid = validateInstant(value.occurrence.startsAt, `${path}.occurrence.startsAt`, issues) && valid;
  } else {
    issues.push(`${path}.occurrence.kind is invalid`);
    valid = false;
  }

  if (value.isCancelled === true) {
    if (value.replacementEventId !== null) {
      issues.push(`${path}.replacementEventId must be null when cancelled`);
      valid = false;
    }
  } else if (value.isCancelled === false) {
    valid = validateId(value.replacementEventId, `${path}.replacementEventId`, issues) && valid;
    if (value.replacementEventId === value.eventId) {
      issues.push(`${path}.replacementEventId cannot equal eventId`);
      valid = false;
    }
  } else {
    issues.push(`${path}.isCancelled must be boolean`);
    valid = false;
  }
  return valid ? (value as unknown as EventException) : null;
}

function validateTodo(value: unknown, path: string, issues: string[]): TodoItem | null {
  if (!isRecord(value)) return invalidObject(path, issues);
  let valid =
    validateId(value.id, `${path}.id`, issues) &&
    validateId(value.calendarId, `${path}.calendarId`, issues) &&
    validateNullableId(value.parentId, `${path}.parentId`, issues) &&
    validateTrimmedString(value.title, `${path}.title`, issues) &&
    validateNullableDate(value.dueDate, `${path}.dueDate`, issues) &&
    validateEnum(value.priority, ['none', 'low', 'medium', 'high'], `${path}.priority`, issues) &&
    validateNullableInstant(value.completedAt, `${path}.completedAt`, issues) &&
    validateNonnegativeInteger(value.sortOrder, `${path}.sortOrder`, issues) &&
    validateEnum(value.sharingScope, ['inherit', 'private'], `${path}.sharingScope`, issues) &&
    validateInstant(value.createdAt, `${path}.createdAt`, issues) &&
    validateInstant(value.updatedAt, `${path}.updatedAt`, issues);
  if (value.parentId === value.id) {
    issues.push(`${path}.parentId cannot equal id`);
    valid = false;
  }
  return valid ? (value as unknown as TodoItem) : null;
}

function validateSticker(value: unknown, path: string, issues: string[]): Sticker | null {
  if (!isRecord(value)) return invalidObject(path, issues);
  let valid =
    validateId(value.id, `${path}.id`, issues) &&
    validateId(value.calendarId, `${path}.calendarId`, issues) &&
    validateDate(value.date, `${path}.date`, issues) &&
    validateNullableString(value.glyph, `${path}.glyph`, issues) &&
    validateNullableString(value.assetKey, `${path}.assetKey`, issues) &&
    validateNonnegativeInteger(value.sortOrder, `${path}.sortOrder`, issues) &&
    validateInstant(value.createdAt, `${path}.createdAt`, issues) &&
    validateInstant(value.updatedAt, `${path}.updatedAt`, issues);
  if (!hasText(value.glyph) && !hasText(value.assetKey)) {
    issues.push(`${path} must contain glyph or assetKey`);
    valid = false;
  }
  return valid ? (value as unknown as Sticker) : null;
}

function validatePreferences(
  value: unknown,
  path: string,
  issues: string[],
): UserPreferences | null {
  if (!isRecord(value)) return invalidObject(path, issues);
  const valid =
    validateTimezone(value.timezone, `${path}.timezone`, issues) &&
    validateEnum(value.weekStartsOn, [0, 1], `${path}.weekStartsOn`, issues) &&
    validateEnum(value.theme, ['system', 'light', 'dark'], `${path}.theme`, issues) &&
    validateEnum(
      value.themeId,
      ['manga', 'minimal', 'warm', 'business', 'vivid', 'pixel'],
      `${path}.themeId`,
      issues,
    ) &&
    validateEnum(
      value.calendarGridMode,
      ['adaptive', 'fixed-six'],
      `${path}.calendarGridMode`,
      issues,
    ) &&
    validateReminderMinutes(
      value.defaultReminderMinutes,
      `${path}.defaultReminderMinutes`,
      issues,
    ) &&
    validateTrimmedString(value.petName, `${path}.petName`, issues) &&
    validateBoolean(value.petEnabled, `${path}.petEnabled`, issues);
  return valid ? (value as unknown as UserPreferences) : null;
}

function validateArray<T>(
  value: unknown,
  path: string,
  validate: (item: unknown, path: string, issues: string[]) => T | null,
  issues: string[],
): T[] | null {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return null;
  }
  const result: T[] = [];
  value.forEach((item, index) => {
    const parsed = validate(item, `${path}[${index}]`, issues);
    if (parsed) result.push(parsed);
  });
  return result.length === value.length ? result : null;
}

function parseEntity<T>(
  value: unknown,
  path: string,
  validate: (item: unknown, path: string, issues: string[]) => T | null,
): T {
  const issues: string[] = [];
  const parsed = validate(value, path, issues);
  if (!parsed) throw new DomainValidationError(issues);
  return parsed;
}

function validateUniqueIds(items: Array<{ id: string }>, path: string, issues: string[]): void {
  const ids = new Set<string>();
  items.forEach((item, index) => {
    if (ids.has(item.id)) issues.push(`${path}[${index}].id must be unique`);
    ids.add(item.id);
  });
}

function validateId(value: unknown, path: string, issues: string[]): value is string {
  if (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    return true;
  }
  issues.push(`${path} must be a UUID`);
  return false;
}

function validateNullableId(value: unknown, path: string, issues: string[]): boolean {
  return value === null || validateId(value, path, issues);
}

function validateTrimmedString(value: unknown, path: string, issues: string[]): value is string {
  if (typeof value === 'string' && value.length > 0 && value.trim() === value) return true;
  issues.push(`${path} must be a non-empty trimmed string`);
  return false;
}

function validateNullableString(value: unknown, path: string, issues: string[]): boolean {
  if (value === null || typeof value === 'string') return true;
  issues.push(`${path} must be a string or null`);
  return false;
}

function validateBoolean(value: unknown, path: string, issues: string[]): value is boolean {
  if (typeof value === 'boolean') return true;
  issues.push(`${path} must be boolean`);
  return false;
}

function validateNonnegativeInteger(value: unknown, path: string, issues: string[]): boolean {
  if (Number.isInteger(value) && Number(value) >= 0) return true;
  issues.push(`${path} must be a nonnegative integer`);
  return false;
}

function validateReminderMinutes(value: unknown, path: string, issues: string[]): boolean {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return false;
  }
  let valid = true;
  if (value.length > MAX_REMINDER_COUNT) {
    issues.push(`${path} must contain at most ${MAX_REMINDER_COUNT} reminders`);
    valid = false;
  }
  if (
    !value.every(
      (item) =>
        Number.isInteger(item) &&
        Number(item) >= 0 &&
        Number(item) <= MAX_REMINDER_MINUTES,
    )
  ) {
    issues.push(`${path} minutes must be integers between 0 and ${MAX_REMINDER_MINUTES}`);
    valid = false;
  }
  return valid;
}

function validateEnum<T extends string | number>(
  value: unknown,
  choices: readonly T[],
  path: string,
  issues: string[],
): value is T {
  if (choices.includes(value as T)) return true;
  issues.push(`${path} must be one of ${choices.join(', ')}`);
  return false;
}

function validateDate(value: unknown, path: string, issues: string[]): value is string {
  if (isDateKey(value)) return true;
  issues.push(`${path} must be a valid YYYY-MM-DD date`);
  return false;
}

function validateNullableDate(value: unknown, path: string, issues: string[]): boolean {
  return value === null || validateDate(value, path, issues);
}

function validateInstant(value: unknown, path: string, issues: string[]): value is string {
  if (isIsoInstant(value)) return true;
  issues.push(`${path} must be an ISO instant with Z or a numeric offset`);
  return false;
}

function validateNullableInstant(value: unknown, path: string, issues: string[]): boolean {
  return value === null || validateInstant(value, path, issues);
}

function validateTimezone(value: unknown, path: string, issues: string[]): value is string {
  if (isIanaTimezone(value)) return true;
  issues.push(`${path} must be a supported IANA timezone`);
  return false;
}

function validateHexColor(value: unknown, path: string, issues: string[]): value is string {
  if (typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value)) return true;
  issues.push(`${path} must be a six-digit hex color`);
  return false;
}

function validateRecurrence(
  value: unknown,
  path: string,
  issues: string[],
  allDay: boolean,
): boolean {
  if (value === null) return true;
  if (isRecord(value) && isRecurrenceRule(value.rule, allDay)) return true;
  if (isRecord(value)) issues.push(`${path}.rule must be a valid RFC 5545 recurrence rule`);
  if (!isRecord(value)) issues.push(`${path} must be an object or null`);
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function hasDefined(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => value[key] !== undefined);
}

function invalidObject(path: string, issues: string[]): null {
  issues.push(`${path} must be an object`);
  return null;
}

function failure(issue: string): ValidationResult<never> {
  return { success: false, issues: [issue] };
}
