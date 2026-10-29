import { eventOccurrenceKey } from '../domain/eventOccurrenceKey';
import { instantDateInZone, instantTimeInZone, wallTimeToInstant } from '../domain/eventTime';
import { resolveEventOccurrences } from '../domain/recurrence';
import type { DayPopUserData, EventOccurrence } from '../domain/types';
import { isDateKey, isIanaTimezone, isIsoInstant, MAX_REMINDER_COUNT, MAX_REMINDER_MINUTES } from '../domain/validation';

/** Account notification preferences, separate from the v4 personal document. */
export interface CalendarReminderRule {
  calendarId: string;
  minutesBefore: number[];
  timezone: string;
  dateTime: string;
  includeTodos: boolean;
  updatedAt: string;
}

export interface ReminderJob {
  /** Stable logical delivery identity; the sender hashes it for its unique ledger/tag. */
  key: string;
  calendarId: string;
  sourceKind: 'event' | 'todo';
  sourceId: string;
  effectiveEventId: string | null;
  occurrence: EventOccurrence;
  minutesBefore: number;
  fireAt: string;
  expiresAt: string;
  sourceUpdatedAt: string;
  effectiveUpdatedAt: string;
  ruleUpdatedAt: string;
}

export interface ReminderPlan {
  jobs: ReminderJob[];
  issues: { calendarId: string; code: 'invalid-rule' | 'schedule-unavailable' }[];
}

export const REMINDER_LIFETIME_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
const MAX_JOBS_PER_CALENDAR = 1_000;
const MAX_DATE = Date.parse('9999-12-31T23:59:59.999Z');
const MIN_DATE = Date.parse('0100-01-01T00:00:00.000Z');

export function isCalendarReminderRule(value: unknown): value is CalendarReminderRule {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const rule = value as Record<string, unknown>;
  return typeof rule.calendarId === 'string' && rule.calendarId.length > 0 &&
    Array.isArray(rule.minutesBefore) && rule.minutesBefore.length <= MAX_REMINDER_COUNT &&
    rule.minutesBefore.every(offset => typeof offset === 'number' && Number.isInteger(offset) && offset >= 0 && offset <= MAX_REMINDER_MINUTES) &&
    isIanaTimezone(rule.timezone) && typeof rule.dateTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(rule.dateTime) &&
    typeof rule.includeTodos === 'boolean' && isIsoInstant(rule.updatedAt);
}

/**
 * Server-side pure planning. The caller MUST supply a freshly authorized
 * recipient snapshot, then revalidate permissions/versions before sending.
 * No titles, locations, notes, account data or push endpoints leave this seam.
 * Legacy event.reminderMinutes is preserved but does not silently opt in users.
 */
export function planReminders(
  snapshot: Pick<DayPopUserData, 'events' | 'eventExceptions' | 'todos'>,
  rules: readonly CalendarReminderRule[],
  now: string,
): ReminderPlan {
  if (!isIsoInstant(now)) throw new RangeError('reminder clock must be an explicit instant');
  if (new Set(rules.map(rule => rule.calendarId)).size !== rules.length) {
    throw new RangeError('duplicate calendar reminder rules');
  }
  const clock = Date.parse(now);
  if (clock < MIN_DATE || clock > MAX_DATE) throw new RangeError('reminder clock outside supported dates');
  // UTC bounds with two days of timezone margin. Resolve actual alarm instants
  // afterwards: all-day recipient zones can differ from timed event zones.
  const window = {
    startDate: new Date(Math.max(MIN_DATE, clock - 2 * DAY_MS)).toISOString().slice(0, 10),
    endDate: new Date(Math.min(MAX_DATE, clock + 9 * DAY_MS)).toISOString().slice(0, 10),
  };
  const result: ReminderPlan = { jobs: [], issues: [] };

  for (const rule of rules) {
    const calendarId = rule.calendarId;
    if (!isCalendarReminderRule(rule)) {
      result.issues.push({ calendarId, code: 'invalid-rule' });
      continue;
    }
    if (rule.minutesBefore.length === 0) continue;
    const offsets = [...new Set(rule.minutesBefore)];
    const calendarJobs = new Map<string, ReminderJob>();
    const consentAt = Date.parse(rule.updatedAt);

    function add(
      kind: ReminderJob['sourceKind'], sourceId: string, effectiveEventId: string | null,
      occurrence: EventOccurrence, startsAt: string | null,
      sourceUpdatedAt: string, effectiveUpdatedAt: string, createdAt: string,
    ) {
      if (startsAt === null) return;
      const start = Date.parse(startsAt);
      for (const minutesBefore of offsets) {
        const fire = start - minutesBefore * 60_000;
        // No future delivery, late spam, or backfill before explicit consent or
        // item creation. Each device applies its own registration boundary too.
        if (fire > clock || clock >= fire + REMINDER_LIFETIME_MS || fire < consentAt || fire < Date.parse(createdAt)) continue;
        const fireAt = new Date(fire).toISOString();
        const key = JSON.stringify([kind, rule.calendarId, sourceId, eventOccurrenceKey(occurrence), fireAt, minutesBefore]);
        calendarJobs.set(key, {
          key, calendarId: rule.calendarId, sourceKind: kind, sourceId, effectiveEventId,
          occurrence, minutesBefore, fireAt, expiresAt: new Date(fire + REMINDER_LIFETIME_MS).toISOString(),
          sourceUpdatedAt, effectiveUpdatedAt, ruleUpdatedAt: rule.updatedAt,
        });
        if (calendarJobs.size > MAX_JOBS_PER_CALENDAR) throw new RangeError('reminder capacity exceeded');
      }
    }

    try {
      const events = snapshot.events.filter(event => event.calendarId === rule.calendarId);
      const byId = new Map(events.map(event => [event.id, event]));
      // Keep the complete visible exception graph. The canonical resolver also
      // includes replacements moved in from source occurrences outside window.
      const occurrences = resolveEventOccurrences({ events, eventExceptions: snapshot.eventExceptions }, window);
      for (const resolved of occurrences) {
        const source = byId.get(resolved.sourceEventId);
        if (!source) throw new RangeError('missing reminder series');
        const event = resolved.event;
        const start = event.allDay ? dateAlarm(event.startDate, rule) : event.startsAt;
        add('event', source.id, event.id, resolved.occurrence, start,
          source.updatedAt, event.updatedAt, event.createdAt);
      }
      if (rule.includeTodos) {
        for (const item of snapshot.todos) {
          if (item.calendarId !== rule.calendarId || item.completedAt !== null || item.dueDate === null) continue;
          add('todo', item.id, null, { kind: 'all-day', date: item.dueDate }, dateAlarm(item.dueDate, rule),
            item.updatedAt, item.updatedAt, item.createdAt);
        }
      }
      result.jobs.push(...calendarJobs.values());
    } catch {
      // A malformed/dense calendar must not send a partially planned batch or
      // stop unrelated calendars. The dispatcher records this issue as failure.
      result.issues.push({ calendarId: rule.calendarId, code: 'schedule-unavailable' });
    }
  }
  result.jobs.sort((a, b) => a.fireAt.localeCompare(b.fireAt) || a.key.localeCompare(b.key));
  return result;
}

function dateAlarm(date: string, rule: CalendarReminderRule): string | null {
  if (!isDateKey(date)) throw new RangeError('invalid reminder date');
  const instant = wallTimeToInstant(date, rule.dateTime, rule.timezone);
  // A spring-forward gap cannot be moved to an invented alarm clock. The
  // canonical wall-time choice also gives one alarm during a fall-back fold.
  return instantDateInZone(instant, rule.timezone) === date &&
    instantTimeInZone(instant, rule.timezone) === rule.dateTime ? instant : null;
}
