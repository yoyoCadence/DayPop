import { sortedCalendars } from './calendars';
import { addDays, daysBetween, fromDateKey, toDateKey } from './date';
import {
  eventDateInZone,
  eventEndTimeInZone,
  eventStartTimeInZone,
  eventWallTime,
  instantDateInZone,
  timedEventFromWallTime,
  wallTimeToInstant,
} from './eventTime';
import { resolveEventOccurrences } from './recurrence';
import { DomainValidationError, isDateKey, isIsoInstant } from './validation';
import { TodoInputError } from './todos';
import { assertTitleLength } from './titles';
import { AllDayInputError, allDayDateIssue, dateKeyDaysBetween, shiftDateKey } from './allDayDates';
import type {
  Calendar,
  CalendarEvent,
  DayPopUserData,
  EventException,
  EventOccurrence,
  Sticker,
  TodoItem,
  TodoPriority,
  UserPreferences,
} from './types';

/**
 * Pure domain edits shared by every repository adapter.
 *
 * The guest adapter applies these to a whole local document; the authenticated
 * adapter applies the same functions to build the row it writes to Supabase.
 * Keeping them here is what makes the two adapters agree on defaults, trimming
 * and timestamps instead of each re-deriving them.
 *
 * Nothing in this module touches storage, the network or the clock — ids and
 * timestamps are passed in so both adapters and their tests stay deterministic.
 */

/** What the quick-add row and the event sheet collect for a new event. */
export interface NewEventInput {
  title: string;
  date: string;
  allDay: boolean;
  /** Inclusive end date for all-day events only; omitted means one day. */
  endDate?: string;
  start: string;
  end: string;
  calendarId?: string;
  location?: string;
  notes?: string;
  /** RFC 5545 RECUR value, without the RRULE: prefix. */
  recurrenceRule?: string | null;
  /** Timed events default to the account preference when omitted. */
  timezone?: string;
}

export interface NewTodoInput {
  title: string;
  date: string;
  calendarId?: string;
  /** One-level subtasks inherit the existing root's date, calendar and sharing. */
  parentId?: string;
}

export interface NewStickerInput {
  date: string;
  /** Emoji today; `assetKey` stays open for a future art set. */
  glyph: string;
  calendarId?: string;
}

/** Fields the week grid and the event sheet are allowed to change. */
export interface EventPatch {
  title?: string;
  date?: string;
  allDay?: boolean;
  /** Explicit inclusive end date; omitted preserves an all-day event's span. */
  endDate?: string;
  start?: string;
  end?: string;
  calendarId?: string;
  /** Empty string clears the field, since the domain stores `null`. */
  location?: string;
  notes?: string;
  /** Undefined keeps the series; null makes the event non-recurring. */
  recurrenceRule?: string | null;
  /** Reanchors the same wall time in a different IANA timezone. */
  timezone?: string;
  /**
   * The zone `date`/`start`/`end` in this patch are expressed in, when that is
   * not the event's own — DP-064.
   *
   * The week grid is drawn in the display timezone, so a drag hands back a
   * *display* wall coordinate. Resolving that against `event.timezone` would
   * move a cross-timezone event by the offset between the two zones instead of
   * by the distance dragged. Unlike `timezone`, this does not change
   * `event.timezone`: it only says how to read the numbers in this patch.
   *
   * **`timezone` wins if both are given.** The two describe different intents —
   * "the user picked a new zone for this event" and "these numbers came off a
   * grid drawn in that zone" — and honouring both at once produces an event
   * that satisfies neither: the wall clock would be read in one zone and then
   * stored as belonging to another. No caller sends both (the sheet sends
   * `timezone`, the week grid sends `wallTimeZone`); this rule exists so the
   * combination has a defined result rather than an accidental one.
   */
  wallTimeZone?: string;
  /**
   * Complete resolved grid interval — DP-072. Only for timed events; mutually
   * exclusive with date/endDate/start/end/allDay/timezone/wallTimeZone. Resolving grid
   * wall coordinates happens before this seam, preserving the event's zone.
   */
  timedInterval?: { startsAt: string; endsAt: string };
}

export interface NewCalendarInput {
  name: string;
  color: string;
}

/** Fields the 我的日曆 list and the edit dialog can change. */
export interface CalendarPatch {
  name?: string;
  color?: string;
  isVisible?: boolean;
}

/** Preference fields are merged, then validated by each repository boundary. */
export type PreferencesPatch = Partial<UserPreferences>;

export function applyPreferencesPatch(
  preferences: UserPreferences,
  patch: PreferencesPatch,
): UserPreferences {
  return { ...preferences, ...patch };
}

export interface CreateContext {
  /** Client-generated UUID for the new row. */
  id: string;
  /** ISO instant used for both `createdAt` and `updatedAt`. */
  now: string;
}

/** The原檔's fallback when the name field is left empty. */
export const UNNAMED_CALENDAR_NAME = '未命名日曆';

/** The domain stores an absent optional string as `null`, never as `''`. */
function optionalText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Next ordering key for a set of rows.
 *
 * Deliberately `max + 1` rather than `length`: after anything is deleted the
 * count no longer matches the highest key, so `length` hands out a value that
 * is already taken. Gaps in the sequence are fine — this is an ordering key,
 * not a position.
 */
function nextSortOrder(existing: { sortOrder: number }[]): number {
  return existing.reduce((highest, row) => Math.max(highest, row.sortOrder + 1), 0);
}

export function createCalendarFromInput(
  data: DayPopUserData,
  input: NewCalendarInput,
  context: CreateContext,
): Calendar {
  return {
    id: context.id,
    name: input.name.trim() || UNNAMED_CALENDAR_NAME,
    color: input.color,
    isVisible: true,
    // Only the bootstrap calendar is the default; a new one never steals it.
    isDefault: false,
    sortOrder: nextSortOrder(data.calendars),
    createdAt: context.now,
    updatedAt: context.now,
  };
}

export function applyCalendarPatch(
  calendar: Calendar,
  patch: CalendarPatch,
  updatedAt: string,
): Calendar {
  return {
    ...calendar,
    name: patch.name === undefined ? calendar.name : patch.name.trim() || UNNAMED_CALENDAR_NAME,
    color: patch.color ?? calendar.color,
    isVisible: patch.isVisible ?? calendar.isVisible,
    updatedAt,
  };
}

export function findCalendarById(data: DayPopUserData, id: string): Calendar | undefined {
  return data.calendars.find((calendar) => calendar.id === id);
}

export function withCalendar(data: DayPopUserData, calendar: Calendar): DayPopUserData {
  const exists = data.calendars.some((candidate) => candidate.id === calendar.id);
  return {
    ...data,
    calendars: exists
      ? data.calendars.map((candidate) => (candidate.id === calendar.id ? calendar : candidate))
      : [...data.calendars, calendar],
  };
}

/**
 * Which calendar inherits the rows of one being deleted.
 *
 * The原檔 simply drops the calendar and leaves its events pointing at nothing.
 * DayPop cannot: the domain contract requires every event, todo and sticker to
 * reference a live calendar, and losing them would be data loss rather than a
 * display change. So the rows move to the surviving default, and if the
 * default itself is deleted the next calendar in order is promoted.
 */
export function calendarDeletionPlan(
  data: DayPopUserData,
  id: string,
): { target: Calendar; promote: boolean } | null {
  const doomed = findCalendarById(data, id);
  // The原檔 refuses to delete the last calendar; so does the domain contract,
  // which requires exactly one default to exist.
  if (!doomed || data.calendars.length <= 1) return null;

  const survivors = sortedCalendars(data.calendars.filter((calendar) => calendar.id !== id));
  const existingDefault = survivors.find((calendar) => calendar.isDefault);
  const target = existingDefault ?? survivors[0]!;
  return { target, promote: !existingDefault };
}

export function withoutCalendar(data: DayPopUserData, id: string, now: string): DayPopUserData {
  const plan = calendarDeletionPlan(data, id);
  if (!plan) return data;
  const { target, promote } = plan;

  const reassign = <T extends { calendarId: string; updatedAt: string }>(rows: T[]): T[] =>
    rows.map((row) =>
      row.calendarId === id ? { ...row, calendarId: target.id, updatedAt: now } : row,
    );

  return {
    ...data,
    calendars: data.calendars
      .filter((calendar) => calendar.id !== id)
      .map((calendar) =>
        promote && calendar.id === target.id
          ? { ...calendar, isDefault: true, updatedAt: now }
          : calendar,
      ),
    events: reassign(data.events),
    todos: reassign(data.todos),
    stickers: reassign(data.stickers),
  };
}

export function resolveDefaultCalendarId(data: DayPopUserData): string {
  const calendar = data.calendars.find((candidate) => candidate.isDefault) ?? data.calendars[0];
  if (!calendar) throw new Error('DayPop 資料缺少預設日曆。');
  return calendar.id;
}

export function createEventFromInput(
  data: DayPopUserData,
  input: NewEventInput,
  context: CreateContext,
): CalendarEvent {
  assertTitleLength(input.title);
  if (input.endDate !== undefined && !input.allDay) throw new AllDayInputError('結束日期只適用於全天行程。');
  if (input.allDay) {
    const issue = allDayDateIssue(input.date, input.endDate ?? input.date);
    if (issue) throw new AllDayInputError(issue);
  }
  const common = {
    id: context.id,
    calendarId: input.calendarId ?? resolveDefaultCalendarId(data),
    title: input.title.trim(),
    location: optionalText(input.location),
    notes: optionalText(input.notes),
    reminderMinutes: [],
    recurrence: input.recurrenceRule ? { rule: input.recurrenceRule } : null,
    sharingScope: 'inherit' as const,
    createdAt: context.now,
    updatedAt: context.now,
  };
  return input.allDay
    ? { ...common, allDay: true, startDate: input.date, endDate: input.endDate ?? input.date }
    : timedEventFromWallTime(
        common,
        { date: input.date, start: input.start, end: input.end },
        input.timezone ?? data.preferences.timezone,
      );
}

export function applyEventPatch(
  event: CalendarEvent,
  patch: EventPatch,
  defaultTimezone: string,
  updatedAt: string,
): CalendarEvent {
  if (patch.title !== undefined && patch.title.trim() !== event.title) assertTitleLength(patch.title);
  const previous = eventWallTime(event);
  const allDay = patch.allDay ?? event.allDay;
  if (patch.endDate !== undefined && !allDay) throw new AllDayInputError('結束日期只適用於全天行程。');
  const common = {
    id: event.id,
    calendarId: patch.calendarId ?? event.calendarId,
    title: patch.title?.trim() ?? event.title,
    location: patch.location === undefined ? event.location : optionalText(patch.location),
    notes: patch.notes === undefined ? event.notes : optionalText(patch.notes),
    reminderMinutes: event.reminderMinutes,
    recurrence:
      patch.recurrenceRule === undefined
        ? event.recurrence
        : patch.recurrenceRule === null
          ? null
          : { rule: patch.recurrenceRule },
    sharingScope: event.sharingScope,
    createdAt: event.createdAt,
    updatedAt,
  };
  const date = patch.date ?? previous.date;
  if (patch.timedInterval) {
    const { startsAt, endsAt } = patch.timedInterval;
    if (event.allDay || [patch.date, patch.endDate, patch.start, patch.end, patch.allDay, patch.timezone, patch.wallTimeZone]
      .some((value) => value !== undefined) || !isIsoInstant(startsAt) || !isIsoInstant(endsAt)
      || Date.parse(endsAt) <= Date.parse(startsAt)) {
      throw new DomainValidationError(['timedInterval requires one valid positive interval and no competing wall-time fields.']);
    }
    return { ...common, allDay: false, startsAt, endsAt, timezone: event.timezone };
  }
  if (allDay) {
    // `endDate` is inclusive and may be later than `startDate`, so both ends
    // have to move together. Deriving them from one date instead would shorten
    // a multi-day all-day event to a single day on an edit that never asked to
    // — renaming it, for example. An explicit endDate changes the duration.
    // A timed event converted without an end date defaults to one day.
    const spanDays = event.allDay
      ? dateKeyDaysBetween(event.startDate, event.endDate)
      : 0;
    const endDate = patch.endDate ?? shiftDateKey(date, spanDays);
    const issue = allDayDateIssue(date, endDate ?? '');
    if (issue) throw new AllDayInputError(issue);
    return {
      ...common,
      allDay: true,
      startDate: date,
      endDate: endDate!,
    };
  }
  // An all-day event has no timezone of its own to keep.
  const ownTimezone = patch.timezone ?? (event.allDay ? defaultTimezone : event.timezone);

  // `timezone` wins over `wallTimeZone`. A sheet reads the event's own clock
  // before reanchoring in a newly selected zone; a grid reads display clocks
  // and writes in that frame while preserving the event's timezone identity.
  const displayFrame = patch.wallTimeZone && patch.timezone === undefined && !event.allDay;
  const readingZone = displayFrame ? patch.wallTimeZone! : event.allDay ? defaultTimezone : event.timezone;
  const writingZone = displayFrame ? readingZone : ownTimezone;
  const seen = displayFrame ? {
    date: eventDateInZone(event, readingZone),
    start: eventStartTimeInZone(event, readingZone),
    end: eventEndTimeInZone(event, readingZone),
  } : previous;
  const wall = {
    date: patch.date ?? seen.date,
    start: (patch.start ?? seen.start) || '09:00',
    end: (patch.end ?? seen.end) || '10:00',
  };
  // DP-112: a metadata edit or an untouched sheet must preserve exact instants,
  // including seconds and the later reading of a repeated DST clock.
  if (!event.allDay && ownTimezone === event.timezone
    && wall.date === seen.date && wall.start === seen.start && wall.end === seen.end) {
    return { ...common, allDay: false, startsAt: event.startsAt, endsAt: event.endsAt, timezone: ownTimezone };
  }
  const spanDays = event.allDay ? 0 : daysBetween(
    fromDateKey(seen.date), fromDateKey(instantDateInZone(event.endsAt, readingZone)),
  );
  const moved = timedEventFromWallTime(
    common,
    wall,
    writingZone,
  );
  // Ordinary clocks still infer same-day/overnight as before (DP-064/083).
  // A longer imported interval carries extra days that two clocks cannot
  // express: keep its end-day span. Re-resolve that day's clock across DST.
  const minimumSpanDays = seen.end <= seen.start ? 1 : 0;
  const endsAt = spanDays > minimumSpanDays
    ? wallTimeToInstant(toDateKey(addDays(fromDateKey(wall.date), spanDays)), wall.end, writingZone)
    : moved.endsAt;
  return { ...moved, endsAt, timezone: ownTimezone };
}

export interface OccurrenceMutationContext {
  /** Used only when this occurrence does not already have an exception row. */
  exceptionId: string;
  /** Used only when this occurrence does not already have a replacement row. */
  replacementEventId: string;
  now: string;
}

/**
 * Cancel one generated occurrence. Updating or deleting the base event remains
 * the explicit “all occurrences” operation used by both repositories.
 */
export function cancelEventOccurrence(
  data: DayPopUserData,
  eventId: string,
  occurrence: EventOccurrence,
  context: OccurrenceMutationContext,
): DayPopUserData {
  const source = requireRecurringOccurrence(data, eventId, occurrence);
  const existing = findEventException(data, eventId, occurrence);
  const exception: EventException = {
    id: existing?.id ?? context.exceptionId,
    eventId: source.id,
    occurrence,
    isCancelled: true,
    replacementEventId: null,
    createdAt: existing?.createdAt ?? context.now,
    updatedAt: context.now,
  };
  const supersededId = existing?.replacementEventId ?? null;
  if (supersededId === null) return withEventException(data, exception);
  // The replacement is a real event, so it can own attachments — DP-082 review.
  // Dropping the event but keeping its rows leaves `eventAttachments[].eventId
  // references a missing event`, which `parseDayPopUserData()` refuses, so the
  // whole cancel would fail validation rather than the document being wrong.
  // `withoutEvent()` has always cleared both together; this is the same rule.
  return withEventException(
    {
      ...data,
      events: data.events.filter((event) => event.id !== supersededId),
      eventAttachments: data.eventAttachments.filter(
        (attachment) => attachment.eventId !== supersededId,
      ),
    },
    exception,
  );
}

/**
 * Replace one generated occurrence with a standalone, non-recurring event.
 *
 * Re-editing the same occurrence reuses both row ids. That keeps the operation
 * idempotent for a retried repository write and avoids orphan replacement rows.
 */
export function replaceEventOccurrence(
  data: DayPopUserData,
  eventId: string,
  occurrence: EventOccurrence,
  patch: EventPatch,
  context: OccurrenceMutationContext,
): DayPopUserData {
  const source = requireRecurringOccurrence(data, eventId, occurrence);
  const existing = findEventException(data, eventId, occurrence);
  const previousReplacement =
    existing?.replacementEventId === null
      ? undefined
      : data.events.find((event) => event.id === existing?.replacementEventId);
  const occurrenceDate =
    occurrence.kind === 'all-day'
      ? occurrence.date
      : instantDateInZone(occurrence.startsAt, source.allDay ? data.preferences.timezone : source.timezone);
  const concrete =
    previousReplacement ??
    resolveEventOccurrences(
      {
        events: data.events,
        eventExceptions: data.eventExceptions.filter(
          (candidate) => !sameEventOccurrence(candidate, eventId, occurrence),
        ),
      },
      { startDate: occurrenceDate, endDate: occurrenceDate },
    ).find(
      (candidate) =>
        candidate.sourceEventId === eventId && sameOccurrence(candidate.occurrence, occurrence),
    )?.event;
  if (!concrete) throw new RangeError('occurrence is not generated by the recurring event');

  const replacementId = existing?.replacementEventId ?? context.replacementEventId;
  const replacement: CalendarEvent = {
    ...applyEventPatch(
      concrete,
      { ...patch, recurrenceRule: null },
      data.preferences.timezone,
      context.now,
    ),
    id: replacementId,
    recurrence: null,
    createdAt: previousReplacement?.createdAt ?? context.now,
    updatedAt: context.now,
  };
  const exception: EventException = {
    id: existing?.id ?? context.exceptionId,
    eventId: source.id,
    occurrence,
    isCancelled: false,
    replacementEventId: replacement.id,
    createdAt: existing?.createdAt ?? context.now,
    updatedAt: context.now,
  };
  return withEventException(withEvent(data, replacement), exception);
}

export function createTodoFromInput(
  data: DayPopUserData,
  input: NewTodoInput,
  context: CreateContext,
): TodoItem {
  assertTitleLength(input.title);
  const parent = input.parentId === undefined ? undefined : findTodo(data, input.parentId);
  if (input.parentId !== undefined) {
    if (!parent) throw new TodoInputError('找不到父待辦，請重新開啟待辦清單。');
    if (parent.parentId !== null) throw new TodoInputError('子項不能再新增子項。');
    if (parent.id === context.id) throw new TodoInputError('待辦不能是自己的子項。');
    if (input.calendarId !== undefined && input.calendarId !== parent.calendarId) {
      throw new TodoInputError('子項必須與父待辦屬於同一日曆。');
    }
  }
  return {
    id: context.id,
    calendarId: parent ? parent.calendarId : input.calendarId ?? resolveDefaultCalendarId(data),
    parentId: parent?.id ?? null,
    title: input.title.trim(),
    dueDate: parent ? parent.dueDate : input.date,
    priority: 'none',
    completedAt: null,
    sortOrder: nextSortOrder(parent ? data.todos.filter((todo) => todo.parentId === parent.id) : data.todos),
    sharingScope: parent?.sharingScope ?? 'inherit',
    createdAt: context.now,
    updatedAt: context.now,
  };
}

export function toggleTodoCompletion(todo: TodoItem, now: string): TodoItem {
  return { ...todo, completedAt: todo.completedAt === null ? now : null, updatedAt: now };
}

/** A title edit must preserve the row's scheduling, hierarchy and completion. */
export function renamedTodo(data: DayPopUserData, id: string, title: string, now: string): TodoItem {
  const trimmed = title.trim();
  if (!trimmed) throw new TodoInputError('待辦標題不能空白。');
  const todo = findTodo(data, id);
  if (!todo) throw new TodoInputError('找不到待辦，請重新開啟待辦清單。');
  assertTitleLength(trimmed);
  return { ...todo, title: trimmed, updatedAt: now };
}

/** Priority belongs to one row; it never cascades to children or reorders them. */
export function todoWithPriority(data: DayPopUserData, id: string, priority: TodoPriority, now: string): TodoItem {
  const todo = findTodo(data, id);
  if (!todo) throw new TodoInputError('找不到待辦，請重新開啟待辦清單。');
  if (!['none', 'low', 'medium', 'high'].includes(priority)) throw new TodoInputError('請選擇有效的待辦優先度。');
  return { ...todo, priority, updatedAt: now };
}

/** A date-only edit keeps each row's hierarchy and other dates independent. */
export function rescheduledTodo(data: DayPopUserData, id: string, date: string, now: string): TodoItem {
  const todo = findTodo(data, id);
  if (!todo) throw new TodoInputError('找不到待辦，請重新開啟待辦清單。');
  if (!isDateKey(date)) throw new TodoInputError('請選擇有效的待辦日期。');
  return { ...todo, dueDate: date, updatedAt: now };
}

export function createStickerFromInput(
  data: DayPopUserData,
  input: NewStickerInput,
  context: CreateContext,
): Sticker {
  return {
    id: context.id,
    calendarId: input.calendarId ?? resolveDefaultCalendarId(data),
    date: input.date,
    glyph: input.glyph,
    // Reserved for the future art set; a glyph sticker never sets both.
    assetKey: null,
    // Per day rather than per document: the原檔 renders each day's stickers in
    // the order they were added, and a global counter would not survive a
    // sticker being deleted from another day.
    sortOrder: nextSortOrder(stickersOn(data, input.date)),
    createdAt: context.now,
    updatedAt: context.now,
  };
}

/** The原檔's `stickersOn(ds)`, in stored order. */
export function stickersOn(data: DayPopUserData, dateKey: string): Sticker[] {
  return data.stickers.filter((sticker) => sticker.date === dateKey);
}

export function findEvent(data: DayPopUserData, id: string): CalendarEvent | undefined {
  return data.events.find((event) => event.id === id);
}

export function findTodo(data: DayPopUserData, id: string): TodoItem | undefined {
  return data.todos.find((todo) => todo.id === id);
}

export function findSticker(data: DayPopUserData, id: string): Sticker | undefined {
  return data.stickers.find((sticker) => sticker.id === id);
}

/** Replaces the event with the same id, keeping its position, or appends it. */
export function withEvent(data: DayPopUserData, event: CalendarEvent): DayPopUserData {
  if (data.events.find((item) => item.id === event.id)?.title !== event.title) assertTitleLength(event.title);
  const exists = data.events.some((candidate) => candidate.id === event.id);
  return {
    ...data,
    events: exists
      ? data.events.map((candidate) => (candidate.id === event.id ? event : candidate))
      : [...data.events, event],
  };
}

export function withoutEvent(data: DayPopUserData, id: string): DayPopUserData {
  const ownedExceptions = data.eventExceptions.filter((exception) => exception.eventId === id);
  const replacementIds = new Set(
    ownedExceptions
      .map((exception) => exception.replacementEventId)
      .filter((replacementId): replacementId is string => replacementId !== null),
  );
  replacementIds.add(id);
  return {
    ...data,
    events: data.events.filter((event) => !replacementIds.has(event.id)),
    eventAttachments: data.eventAttachments.filter(
      (attachment) => !replacementIds.has(attachment.eventId),
    ),
    eventExceptions: data.eventExceptions.filter(
      (exception) =>
        exception.eventId !== id &&
        (exception.replacementEventId === null || !replacementIds.has(exception.replacementEventId)),
    ),
  };
}

/**
 * The exception row already registered for this occurrence, if any — DP-082.
 *
 * Exported for the repository adapters rather than the screens. The Supabase
 * adapter has to know the *previous* row before the mutation runs: cancelling
 * an occurrence that currently has a replacement drops that replacement event,
 * and the row id it needs to delete is only visible here.
 */
export function findEventException(
  data: DayPopUserData,
  eventId: string,
  occurrence: EventOccurrence,
): EventException | undefined {
  return data.eventExceptions.find((candidate) =>
    sameEventOccurrence(candidate, eventId, occurrence),
  );
}

function sameEventOccurrence(
  exception: EventException,
  eventId: string,
  occurrence: EventOccurrence,
): boolean {
  return exception.eventId === eventId && sameOccurrence(exception.occurrence, occurrence);
}

function sameOccurrence(left: EventOccurrence, right: EventOccurrence): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === 'all-day'
    ? left.date === (right as Extract<EventOccurrence, { kind: 'all-day' }>).date
    : left.startsAt === (right as Extract<EventOccurrence, { kind: 'timed' }>).startsAt;
}

function requireRecurringOccurrence(
  data: DayPopUserData,
  eventId: string,
  occurrence: EventOccurrence,
): CalendarEvent {
  const source = findEvent(data, eventId);
  if (!source || source.recurrence === null) {
    throw new RangeError('occurrence operation requires a recurring event');
  }
  if ((source.allDay && occurrence.kind !== 'all-day') || (!source.allDay && occurrence.kind !== 'timed')) {
    throw new RangeError('occurrence shape must match the recurring event');
  }
  return source;
}

function withEventException(
  data: DayPopUserData,
  exception: EventException,
): DayPopUserData {
  const existing = data.eventExceptions.findIndex((candidate) =>
    sameEventOccurrence(candidate, exception.eventId, exception.occurrence),
  );
  return {
    ...data,
    eventExceptions:
      existing < 0
        ? [...data.eventExceptions, exception]
        : data.eventExceptions.map((candidate, index) =>
            index === existing ? exception : candidate,
          ),
  };
}

export function withTodo(data: DayPopUserData, todo: TodoItem): DayPopUserData {
  const exists = data.todos.some((candidate) => candidate.id === todo.id);
  return {
    ...data,
    todos: exists
      ? data.todos.map((candidate) => (candidate.id === todo.id ? todo : candidate))
      : [...data.todos, todo],
  };
}

export function withoutTodo(data: DayPopUserData, id: string): DayPopUserData {
  // Match the existing PostgreSQL ON DELETE CASCADE for both adapters' snapshots.
  // Index once and walk iteratively: imported trees need not be ordered or shallow.
  const children = new Map<string, string[]>();
  for (const todo of data.todos) {
    if (todo.parentId === null) continue;
    const siblings = children.get(todo.parentId) ?? [];
    siblings.push(todo.id);
    children.set(todo.parentId, siblings);
  }
  const deleted = new Set([id]);
  const queue = [id];
  for (let index = 0; index < queue.length; index += 1) {
    for (const child of children.get(queue[index]!) ?? []) {
      if (deleted.has(child)) continue;
      deleted.add(child);
      queue.push(child);
    }
  }
  return { ...data, todos: data.todos.filter((todo) => !deleted.has(todo.id)) };
}

export function withSticker(data: DayPopUserData, sticker: Sticker): DayPopUserData {
  const exists = data.stickers.some((candidate) => candidate.id === sticker.id);
  return {
    ...data,
    stickers: exists
      ? data.stickers.map((candidate) => (candidate.id === sticker.id ? sticker : candidate))
      : [...data.stickers, sticker],
  };
}

export function withoutSticker(data: DayPopUserData, id: string): DayPopUserData {
  return { ...data, stickers: data.stickers.filter((sticker) => sticker.id !== id) };
}
