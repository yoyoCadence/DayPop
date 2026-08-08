import { addDays, fromDateKey, toDateKey } from './date';
import {
  instantDateInZone,
  instantTimeInZone,
  wallTimeToInstant,
} from './eventTime';
import { parseRecurrenceRule } from './recurrence';
import {
  createDomainId,
  type CalendarEvent,
  type EventException,
  type EventOccurrence,
} from './types';
import {
  DomainValidationError,
  isIanaTimezone,
  parseCalendarEvent,
  parseEventException,
} from './validation';

const UUID_PREFIX =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:@|$)/i;
const DATE_VALUE = /^\d{8}$/;
const DATE_TIME_VALUE = /^\d{8}T\d{6}Z?$/;

export class IcsFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IcsFormatError';
  }
}

export interface IcsImportContext {
  calendarId: string;
  defaultTimezone: string;
  now?: string;
  idFactory?: () => string;
}

export interface IcsImportResult {
  events: CalendarEvent[];
  eventExceptions: EventException[];
}

type IcsProperty = {
  name: string;
  params: Map<string, string>;
  value: string;
};

/**
 * Serialize canonical events and exception rows without involving browser IO.
 *
 * DP-056 owns file selection, preview, duplicate handling and all-or-nothing
 * import. This adapter owns only the date/time semantics needed by that task.
 */
export function exportCalendarToIcs(
  data: Pick<IcsImportResult, 'events' | 'eventExceptions'>,
): string {
  const eventsById = new Map(data.events.map((event) => [event.id, event]));
  const replacementIds = new Set(
    data.eventExceptions
      .map((exception) => exception.replacementEventId)
      .filter((id): id is string => id !== null),
  );
  const exceptionsByEvent = new Map<string, EventException[]>();
  for (const exception of data.eventExceptions) {
    const rows = exceptionsByEvent.get(exception.eventId) ?? [];
    rows.push(exception);
    exceptionsByEvent.set(exception.eventId, rows);
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DayPop//Calendar//ZH-TW',
    'CALSCALE:GREGORIAN',
  ];

  for (const event of data.events) {
    if (replacementIds.has(event.id)) continue;
    const uid = `${event.id}@daypop.local`;
    const exceptions = exceptionsByEvent.get(event.id) ?? [];
    const masterLines = serializeEvent(event, uid);
    for (const exception of exceptions) {
      if (exception.isCancelled) {
        masterLines.splice(
          masterLines.length - 1,
          0,
          serializeExceptionDate('EXDATE', event, exception.occurrence),
        );
      }
    }
    lines.push(...masterLines);

    for (const exception of exceptions) {
      if (exception.isCancelled) continue;
      const replacement = eventsById.get(exception.replacementEventId);
      if (!replacement) {
        throw new IcsFormatError('replacement exception references a missing event');
      }
      lines.push(...serializeEvent(replacement, uid, exception.occurrence, event));
    }
  }

  lines.push('END:VCALENDAR');
  return lines.flatMap(foldLine).join('\r\n') + '\r\n';
}

export function importCalendarFromIcs(
  input: string,
  context: IcsImportContext,
): IcsImportResult {
  if (!isIanaTimezone(context.defaultTimezone)) {
    throw new IcsFormatError('defaultTimezone must be a supported IANA timezone');
  }
  const now = context.now ?? new Date().toISOString();
  const idFactory = context.idFactory ?? createDomainId;
  const components = parseEventComponents(input);
  const groups = new Map<string, IcsProperty[][]>();
  for (const component of components) {
    const uid = property(component, 'UID')?.value;
    if (!uid) throw new IcsFormatError('VEVENT requires UID');
    const group = groups.get(uid) ?? [];
    group.push(component);
    groups.set(uid, group);
  }

  const events: CalendarEvent[] = [];
  const eventExceptions: EventException[] = [];
  for (const [uid, componentsForUid] of groups) {
    const master = componentsForUid.find((component) => !property(component, 'RECURRENCE-ID'));
    if (!master) throw new IcsFormatError(`UID ${uid} has no master VEVENT`);
    const masterId = UUID_PREFIX.exec(uid)?.[1] ?? idFactory();
    const source = parseEventComponent(master, {
      id: masterId,
      calendarId: context.calendarId,
      defaultTimezone: context.defaultTimezone,
      now,
    });
    events.push(source);

    for (const exdate of properties(master, 'EXDATE')) {
      for (const value of exdate.value.split(',')) {
        const occurrence = parseOccurrenceProperty({ ...exdate, value }, source);
        eventExceptions.push(
          parseEventException({
            id: idFactory(),
            eventId: source.id,
            occurrence,
            isCancelled: true,
            replacementEventId: null,
            createdAt: now,
            updatedAt: now,
          }),
        );
      }
    }

    for (const override of componentsForUid) {
      const recurrenceId = property(override, 'RECURRENCE-ID');
      if (!recurrenceId) continue;
      const occurrence = parseOccurrenceProperty(recurrenceId, source);
      if (property(override, 'STATUS')?.value.toUpperCase() === 'CANCELLED') {
        eventExceptions.push(
          parseEventException({
            id: idFactory(),
            eventId: source.id,
            occurrence,
            isCancelled: true,
            replacementEventId: null,
            createdAt: now,
            updatedAt: now,
          }),
        );
        continue;
      }

      const replacement = parseEventComponent(override, {
        id: idFactory(),
        calendarId: context.calendarId,
        defaultTimezone: context.defaultTimezone,
        now,
        ignoreRecurrence: true,
      });
      events.push(replacement);
      eventExceptions.push(
        parseEventException({
          id: idFactory(),
          eventId: source.id,
          occurrence,
          isCancelled: false,
          replacementEventId: replacement.id,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
  }

  return { events, eventExceptions };
}

function serializeEvent(
  event: CalendarEvent,
  uid: string,
  recurrenceId?: EventOccurrence,
  recurrenceSource?: CalendarEvent,
): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatUtcDateTime(event.updatedAt)}`,
  ];
  if (recurrenceId && recurrenceSource) {
    lines.push(serializeExceptionDate('RECURRENCE-ID', recurrenceSource, recurrenceId));
  }
  lines.push(...serializeTiming(event));
  lines.push(`SUMMARY:${escapeText(event.title)}`);
  if (event.location !== null) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.notes !== null) lines.push(`DESCRIPTION:${escapeText(event.notes)}`);
  if (event.sharingScope === 'private') lines.push('CLASS:PRIVATE');
  if (!recurrenceId && event.recurrence !== null) {
    try {
      parseRecurrenceRule(event.recurrence.rule, event.allDay);
    } catch (error) {
      throw new IcsFormatError(
        error instanceof Error ? error.message : 'VEVENT contains an invalid RRULE',
      );
    }
    lines.push(`RRULE:${event.recurrence.rule}`);
  }
  lines.push('END:VEVENT');
  return lines;
}

function serializeTiming(event: CalendarEvent): string[] {
  if (event.allDay) {
    const exclusiveEnd = toDateKey(addDays(fromDateKey(event.endDate), 1));
    return [
      `DTSTART;VALUE=DATE:${compactDate(event.startDate)}`,
      `DTEND;VALUE=DATE:${compactDate(exclusiveEnd)}`,
    ];
  }
  return [
    `DTSTART;TZID=${event.timezone}:${localDateTime(event.startsAt, event.timezone)}`,
    `DTEND;TZID=${event.timezone}:${localDateTime(event.endsAt, event.timezone)}`,
  ];
}

function serializeExceptionDate(
  name: 'EXDATE' | 'RECURRENCE-ID',
  source: CalendarEvent,
  occurrence: EventOccurrence,
): string {
  if (source.allDay) {
    if (occurrence.kind !== 'all-day') {
      throw new IcsFormatError('exception shape does not match all-day source event');
    }
    return `${name};VALUE=DATE:${compactDate(occurrence.date)}`;
  }
  if (occurrence.kind !== 'timed') {
    throw new IcsFormatError('exception shape does not match timed source event');
  }
  return `${name};TZID=${source.timezone}:${localDateTime(
    occurrence.startsAt,
    source.timezone,
  )}`;
}

function parseEventComponent(
  component: IcsProperty[],
  options: {
    id: string;
    calendarId: string;
    defaultTimezone: string;
    now: string;
    ignoreRecurrence?: boolean;
  },
): CalendarEvent {
  const start = property(component, 'DTSTART');
  const end = property(component, 'DTEND');
  const summary = property(component, 'SUMMARY');
  if (!start || !end || !summary) {
    throw new IcsFormatError('VEVENT requires DTSTART, DTEND and SUMMARY');
  }
  const title = unescapeText(summary.value).trim();
  const locationValue = property(component, 'LOCATION');
  const notesValue = property(component, 'DESCRIPTION');
  const recurrenceValue = options.ignoreRecurrence ? undefined : property(component, 'RRULE');
  const common = {
    id: options.id,
    calendarId: options.calendarId,
    title,
    location: locationValue ? unescapeText(locationValue.value) : null,
    notes: notesValue ? unescapeText(notesValue.value) : null,
    reminderMinutes: [],
    recurrence: recurrenceValue ? { rule: recurrenceValue.value.trim().toUpperCase() } : null,
    sharingScope:
      property(component, 'CLASS')?.value.toUpperCase() === 'PRIVATE'
        ? ('private' as const)
        : ('inherit' as const),
    createdAt: options.now,
    updatedAt: options.now,
  };

  try {
    if (isDateProperty(start)) {
      if (!isDateProperty(end)) {
        throw new IcsFormatError('all-day DTSTART and DTEND must both use DATE');
      }
      const startDate = expandDate(start.value);
      const exclusiveEnd = expandDate(end.value);
      const endDate = toDateKey(addDays(fromDateKey(exclusiveEnd), -1));
      return parseCalendarEvent({ ...common, allDay: true, startDate, endDate });
    }
    if (isDateProperty(end)) {
      throw new IcsFormatError('timed DTSTART and DTEND must both use DATE-TIME');
    }
    const timezone = timezoneFor(start, options.defaultTimezone);
    const endTimezone = timezoneFor(end, timezone);
    if (endTimezone !== timezone) {
      throw new IcsFormatError('DTSTART and DTEND must use the same timezone');
    }
    return parseCalendarEvent({
      ...common,
      allDay: false,
      startsAt: parseDateTime(start.value, timezone),
      endsAt: parseDateTime(end.value, timezone),
      timezone,
    });
  } catch (error) {
    if (error instanceof IcsFormatError) throw error;
    if (error instanceof DomainValidationError) {
      throw new IcsFormatError(error.issues.join('; '));
    }
    throw error;
  }
}

function parseOccurrenceProperty(
  input: IcsProperty,
  source: CalendarEvent,
): EventOccurrence {
  if (source.allDay) {
    if (!isDateProperty(input)) {
      throw new IcsFormatError('all-day exception must use a DATE value');
    }
    return { kind: 'all-day', date: expandDate(input.value) };
  }
  if (isDateProperty(input)) {
    throw new IcsFormatError('timed exception must use a DATE-TIME value');
  }
  const timezone = timezoneFor(input, source.timezone);
  return { kind: 'timed', startsAt: parseDateTime(input.value, timezone) };
}

function parseEventComponents(input: string): IcsProperty[][] {
  const unfolded = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
  const components: IcsProperty[][] = [];
  let current: IcsProperty[] | null = null;
  for (const rawLine of unfolded.split('\n')) {
    if (rawLine === 'BEGIN:VEVENT') {
      if (current) throw new IcsFormatError('nested VEVENT is invalid');
      current = [];
      continue;
    }
    if (rawLine === 'END:VEVENT') {
      if (!current) throw new IcsFormatError('END:VEVENT has no matching BEGIN');
      components.push(current);
      current = null;
      continue;
    }
    if (current && rawLine) current.push(parseProperty(rawLine));
  }
  if (current) throw new IcsFormatError('VEVENT is not closed');
  return components;
}

function parseProperty(line: string): IcsProperty {
  const separator = line.indexOf(':');
  if (separator <= 0) throw new IcsFormatError('iCalendar property is missing a value separator');
  const [name = '', ...parameterParts] = line.slice(0, separator).split(';');
  const params = new Map<string, string>();
  for (const part of parameterParts) {
    const equals = part.indexOf('=');
    if (equals <= 0) throw new IcsFormatError('iCalendar property parameter is invalid');
    params.set(part.slice(0, equals).toUpperCase(), part.slice(equals + 1));
  }
  return { name: name.toUpperCase(), params, value: line.slice(separator + 1) };
}

function property(component: IcsProperty[], name: string): IcsProperty | undefined {
  return component.find((candidate) => candidate.name === name);
}

function properties(component: IcsProperty[], name: string): IcsProperty[] {
  return component.filter((candidate) => candidate.name === name);
}

function isDateProperty(input: IcsProperty): boolean {
  return input.params.get('VALUE')?.toUpperCase() === 'DATE' || DATE_VALUE.test(input.value);
}

function timezoneFor(input: IcsProperty, fallback: string): string {
  if (input.value.endsWith('Z')) return 'UTC';
  const timezone = input.params.get('TZID') ?? fallback;
  if (!isIanaTimezone(timezone)) {
    throw new IcsFormatError('VEVENT contains an unsupported IANA timezone');
  }
  return timezone;
}

function parseDateTime(value: string, timezone: string): string {
  if (!DATE_TIME_VALUE.test(value)) {
    throw new IcsFormatError('DATE-TIME must use the basic RFC 5545 form');
  }
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const time = `${value.slice(9, 11)}:${value.slice(11, 13)}`;
  if (value.endsWith('Z')) {
    return new Date(
      Date.UTC(
        Number(value.slice(0, 4)),
        Number(value.slice(4, 6)) - 1,
        Number(value.slice(6, 8)),
        Number(value.slice(9, 11)),
        Number(value.slice(11, 13)),
        Number(value.slice(13, 15)),
      ),
    ).toISOString();
  }
  return wallTimeToInstant(date, time, timezone);
}

function localDateTime(instant: string, timezone: string): string {
  return (
    compactDate(instantDateInZone(instant, timezone)) +
    'T' +
    instantTimeInZone(instant, timezone).replace(':', '') +
    '00'
  );
}

function formatUtcDateTime(instant: string): string {
  return new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function compactDate(date: string): string {
  return date.replace(/-/g, '');
}

function expandDate(value: string): string {
  if (!DATE_VALUE.test(value)) throw new IcsFormatError('DATE must use YYYYMMDD');
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/** Fold to the RFC 5545 75-octet content-line limit without splitting UTF-8. */
function foldLine(line: string): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const character of line) {
    if (new TextEncoder().encode(current + character).length > 75) {
      chunks.push(current);
      current = ' ' + character;
    } else {
      current += character;
    }
  }
  chunks.push(current);
  return chunks;
}
