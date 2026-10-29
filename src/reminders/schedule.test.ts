import { describe, expect, it } from 'vitest';
import { timedEventFromWallTime } from '../domain/eventTime';
import type { CalendarEvent, EventException, TodoItem } from '../domain/types';
import { isCalendarReminderRule, planReminders, type CalendarReminderRule } from './schedule';

const NOW = '2026-10-29T01:00:00.000Z';
const rule: CalendarReminderRule = {
  calendarId: 'calendar', minutesBefore: [15], timezone: 'Asia/Taipei',
  dateTime: '09:00', includeTodos: false, updatedAt: '2026-01-01T00:00:00.000Z',
};
const timed = (date = '2026-10-29', start = '09:15', timezone = 'Asia/Taipei', recurrence: string | null = null): CalendarEvent =>
  timedEventFromWallTime({
    id: 'event', calendarId: 'calendar', title: 'Private title must never enter a push job',
    location: 'private location', notes: 'private notes', reminderMinutes: [60],
    recurrence: recurrence ? { rule: recurrence } : null, sharingScope: 'inherit',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }, { date, start, end: '10:00' }, timezone);
const allDay = (startDate = '2026-10-29', endDate = startDate): CalendarEvent => ({
  ...timed(), allDay: true, startDate, endDate,
});
const todo = (patch: Partial<TodoItem> = {}): TodoItem => ({
  id: 'todo', calendarId: 'calendar', parentId: null, title: 'private todo',
  dueDate: '2026-10-29', completedAt: null, priority: 'none', sortOrder: 0,
  sharingScope: 'inherit', createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z', ...patch,
});
const plan = (events: CalendarEvent[] = [timed()], rules = [rule], now = NOW, eventExceptions: EventException[] = [], todos: TodoItem[] = []) =>
  planReminders({ events, eventExceptions, todos }, rules, now);

describe('background reminder schedule (authorization must precede this pure planner)', () => {
  it('prints the effective process timezone for cross-zone evidence', () => {
    const actual = Intl.DateTimeFormat().resolvedOptions().timeZone;
    process.stdout.write('DP-219 actual timezone: ' + actual + '\n');
    if (process.env.TZ === 'UTC' || process.env.TZ === 'America/New_York') expect(actual).toBe(process.env.TZ);
    expect(actual).toBeTruthy();
  });

  it('includes due-now, excludes future and expires after exactly five minutes', () => {
    expect(plan().jobs.map(j => [j.fireAt, j.expiresAt])).toEqual([[NOW, '2026-10-29T01:05:00.000Z']]);
    expect(plan(undefined, undefined, '2026-10-29T00:59:59.999Z').jobs).toHaveLength(0);
    expect(plan(undefined, undefined, '2026-10-29T01:04:59.999Z').jobs).toHaveLength(1);
    expect(plan(undefined, undefined, '2026-10-29T01:05:00.000Z').jobs).toHaveLength(0);
  });

  it('only schedules explicitly enabled calendars, without using legacy reminder fields', () => {
    expect(plan(undefined, []).jobs).toEqual([]);
    expect(plan(undefined, [{ ...rule, minutesBefore: [] }]).jobs).toEqual([]);
    expect(plan(undefined, [{ ...rule, calendarId: 'other' }]).jobs).toEqual([]);
    expect(plan().jobs[0]?.minutesBefore).toBe(15);
  });

  it('does not backfill alarms earlier than explicit consent or edited settings', () => {
    expect(plan(undefined, [{ ...rule, updatedAt: '2026-10-29T01:00:01.000Z' }], '2026-10-29T01:00:02.000Z').jobs).toEqual([]);
    expect(plan(undefined, [{ ...rule, updatedAt: NOW }]).jobs).toHaveLength(1);
  });

  it('deduplicates offsets and equivalent transport instants; title edits never resend', () => {
    const original = plan(undefined, [{ ...rule, minutesBefore: [15, 15] }]).jobs;
    const event = timed();
    if (event.allDay) throw Error('fixture');
    const changed = plan([{ ...event, title: 'changed', startsAt: '2026-10-29T09:15:00+08:00', updatedAt: NOW }]).jobs;
    expect(original).toHaveLength(1);
    expect(changed[0]?.key).toBe(original[0]?.key);
    expect(changed[0]?.sourceUpdatedAt).not.toBe(original[0]?.sourceUpdatedAt);
    expect(JSON.stringify(original)).not.toMatch(/Private title|private location|private notes/);
  });

  it('uses the complete event start once across midnight and multi-day spans', () => {
    const event = timed('2026-10-30', '00:10');
    expect(plan([event], undefined, '2026-10-29T15:55:00.000Z').jobs[0]?.fireAt).toBe('2026-10-29T15:55:00.000Z');
    expect(plan([{ ...event, endsAt: '2026-11-01T02:00:00.000Z' } as CalendarEvent], [{ ...rule, minutesBefore: [0] }], '2026-10-31T01:00:00.000Z').jobs).toHaveLength(0);
  });

  it.each([
    ['Asia/Taipei', '2026-10-29T00:45:00.000Z'],
    ['America/New_York', '2026-10-29T12:45:00.000Z'],
    ['Pacific/Kiritimati', '2026-10-28T18:45:00.000Z'],
  ])('all-day uses the recipient rule timezone %s, and only its start date', (timezone, now) => {
    const config = { ...rule, timezone };
    expect(plan([allDay('2026-10-29', '2026-10-31')], [config], now).jobs).toHaveLength(1);
    expect(plan([allDay('2026-10-29', '2026-10-31')], [config], new Date(Date.parse(now) + 86_400_000).toISOString()).jobs).toEqual([]);
  });

  it.each([
    ['2026-03-08T12:45:00.000Z', '2026-03-08T13:00:00.000Z'],
    ['2026-11-01T13:45:00.000Z', '2026-11-01T14:00:00.000Z'],
  ])('recurrence follows event wall time across DST at %s', (now, startsAt) => {
    const result = plan([timed('2026-01-01', '09:00', 'America/New_York', 'FREQ=DAILY')], undefined, now);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.occurrence).toEqual({ kind: 'timed', startsAt });
  });

  it('a nonexistent all-day alarm clock is skipped; it is never silently shifted', () => {
    for (const now of ['2026-03-08T06:30:00.000Z', '2026-03-08T07:30:00.000Z']) {
      expect(plan([allDay('2026-03-08')], [{ ...rule, timezone: 'America/New_York', dateTime: '02:30', minutesBefore: [0] }], now).jobs).toEqual([]);
    }
  });

  it('cancelled and replaced occurrences use the canonical graph, including moves into the window', () => {
    const base = timed('2026-10-29', '09:15', 'Asia/Taipei', 'FREQ=DAILY');
    const cancellation: EventException = {
      id: 'exception', eventId: 'event', occurrence: { kind: 'timed', startsAt: '2026-10-29T09:15:00+08:00' },
      isCancelled: true, replacementEventId: null, createdAt: NOW, updatedAt: NOW,
    };
    expect(plan([base], undefined, NOW, [cancellation]).jobs).toEqual([]);
    const replacement = { ...timed(), id: 'replacement' };
    const moved: EventException = { ...cancellation, occurrence: { kind: 'timed', startsAt: '2025-01-01T01:15:00.000Z' }, isCancelled: false, replacementEventId: 'replacement' };
    const result = plan([timed('2025-01-01', '09:15', 'Asia/Taipei', 'FREQ=YEARLY'), replacement], undefined, NOW, [moved]);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({ effectiveEventId: 'replacement', sourceId: 'event' });
  });

  it('includes the full maximum offset horizon and independently scheduled offsets', () => {
    expect(plan([timed('2026-11-05', '09:00')], [{ ...rule, minutesBefore: [10080] }]).jobs).toHaveLength(1);
    expect(plan(undefined, [{ ...rule, minutesBefore: [0, 15, 60] }]).jobs).toHaveLength(1);
  });

  it('todos are optional, dated and incomplete; child completion is independent', () => {
    const todos = [todo(), todo({ id: 'done', completedAt: NOW }), todo({ id: 'undated', dueDate: null }), todo({ id: 'child', parentId: 'done' })];
    expect(plan([], undefined, '2026-10-29T00:45:00.000Z', [], todos).jobs).toEqual([]);
    const result = plan([], [{ ...rule, includeTodos: true }], '2026-10-29T00:45:00.000Z', [], todos);
    expect(result.jobs.map(j => j.sourceId)).toEqual(['child', 'todo']);
    expect(JSON.stringify(result)).not.toContain('private todo');
  });

  it('invalid settings fail closed per calendar without disabling healthy calendars', () => {
    const invalid = [{ ...rule, calendarId: 'bad', minutesBefore: [-1] }, { ...rule, calendarId: 'bad-zone', timezone: 'invalid' }];
    const result = plan(undefined, [...invalid, rule]);
    expect(result.jobs).toHaveLength(1);
    expect(result.issues).toHaveLength(2);
    expect(() => plan(undefined, undefined, 'not-an-instant')).toThrow();
    expect(() => plan(undefined, [rule, rule])).toThrow();
  });

  it('an unexpandable series does not silently suppress another calendar', () => {
    const runaway = { ...timed(), calendarId: 'bad', recurrence: { rule: 'FREQ=SECONDLY' } };
    const result = plan([timed(), runaway], [rule, { ...rule, calendarId: 'bad' }]);
    expect(result.jobs).toHaveLength(1);
    expect(result.issues).toEqual([{ calendarId: 'bad', code: 'schedule-unavailable' }]);
  });

  it.each([
    null, [], {}, { ...rule, minutesBefore: [NaN] }, { ...rule, minutesBefore: [10081] },
    { ...rule, minutesBefore: Array.from({ length: 11 }, () => 0) },
    { ...rule, dateTime: '24:00' }, { ...rule, dateTime: '9:00' },
    { ...rule, includeTodos: 'yes' }, { ...rule, updatedAt: '2026-10-29T09:00:00' },
  ])('rejects malformed or unbounded settings %#', input => {
    expect(isCalendarReminderRule(input)).toBe(false);
  });

  it('a fall-back fold has one alarm, using the canonical first wall-time instant', () => {
    const config = { ...rule, dateTime: '01:30', timezone: 'America/New_York' };
    expect(plan([allDay('2026-11-01')], [config], '2026-11-01T05:15:00.000Z').jobs).toHaveLength(1);
    expect(plan([allDay('2026-11-01')], [config], '2026-11-01T06:15:00.000Z').jobs).toHaveLength(0);
  });

  it('does not backfill newly created/imported items, and never mutates the snapshot', () => {
    const events = [{ ...timed(), createdAt: '2026-10-29T01:00:01.000Z' }];
    const saved = structuredClone({ events, rules: [rule] });
    expect(plan(events, [rule], '2026-10-29T01:00:02.000Z').jobs).toEqual([]);
    expect({ events, rules: [rule] }).toEqual(saved);
  });

  it('capacity is fail-closed for the whole calendar, without dropping another calendar', () => {
    const crowded = Array.from({ length: 1001 }, (_, id) => ({ ...timed(), id: 'crowded-' + id, calendarId: 'bad' }));
    expect(plan(crowded.slice(0, 1000), [{ ...rule, calendarId: 'bad' }]).jobs).toHaveLength(1000);
    const result = plan([timed(), ...crowded], [rule, { ...rule, calendarId: 'bad' }]);
    expect(result.jobs).toHaveLength(1);
    expect(result.issues).toEqual([{ calendarId: 'bad', code: 'schedule-unavailable' }]);
  });
});
