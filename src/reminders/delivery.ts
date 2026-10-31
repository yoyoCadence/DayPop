import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';
import { eventOccurrenceKey } from '../domain/eventOccurrenceKey';
import { parseCalendarEvent, parseEventException, parseTodo, isIsoInstant, isUuid } from '../domain/validation';
import { isCalendarReminderRule, planReminders, type ReminderJob } from './schedule';

type Issue = 'configuration' | 'planning' | 'transport' | 'capacity';
type DeliveryResult = 'sent' | 'retry' | 'failed' | 'gone';
export interface ReminderStore {
  page(after: string | null): Promise<unknown>;
  context(deviceId: string, calendarId: string): Promise<unknown>;
  claim(deviceId: string, calendarId: string, version: string, hash: string, fireAt: string): Promise<unknown>;
  finish(deviceId: string, hash: string, leaseId: string, result: DeliveryResult): Promise<void>;
  heartbeat(error: Issue | null): Promise<void>;
}
export interface ReminderSubscription { endpoint: string; p256dh: string; auth: string }
export interface ReminderTransport {
  /** Adapter MUST honor signal, prohibit redirects and recompute TTL after encryption. */
  send(subscription: ReminderSubscription, message: { payload: string; tag: string; ttl: number; expiresAt: string; signal: AbortSignal }): Promise<number>;
}
export interface ReminderTickOptions {
  store: ReminderStore;
  transport: ReminderTransport;
  clock?: () => number;
  budgetMs?: number;
  maxDevices?: number;
}
export interface ReminderTickSummary {
  devices: number; calendars: number; sent: number; retry: number; failed: number;
  gone: number; skipped: number; unconfirmed: number; issues: Issue[];
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const HASH = /^[a-f0-9]{64}$/;
const KEY = /^B[A-Za-z0-9_-]{86}$/;
const AUTH = /^[A-Za-z0-9_-]{22}$/;

export function isAllowedPushEndpoint(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 20 && value.length <= 2048 &&
    value.trim() === value && Array.from(value).every(char => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127) &&
    /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\/[^#\s]+$/.test(value);
}

export async function reminderJobHash(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Server-only adapter. This module creates no client and reads no credentials. */
export function createReminderStore(client: Pick<SupabaseClient<Database>, 'rpc'>): ReminderStore {
  async function checked(result: PromiseLike<{ data: unknown; error: unknown }>): Promise<unknown> {
    const response = await result;
    if (response.error) throw new Error('reminder_store_unavailable');
    return response.data;
  }
  const signal = () => AbortSignal.timeout(10_000);
  return {
    page: after => checked(client.rpc('reminder_sender_page', after === null ? {} : { p_after: after }).abortSignal(signal())),
    context: (deviceId, calendarId) => checked(client.rpc('reminder_sender_context', { p_device_id: deviceId, p_calendar_id: calendarId }).abortSignal(signal())),
    claim: (deviceId, calendarId, version, hash, fireAt) => checked(client.rpc('claim_reminder_delivery', {
      p_device_id: deviceId, p_calendar_id: calendarId, p_version: version, p_job_hash: hash, p_fire_at: fireAt,
    }).abortSignal(signal())),
    finish: async (deviceId, hash, leaseId, result) => { await checked(client.rpc('finish_reminder_delivery', {
      p_device_id: deviceId, p_job_hash: hash, p_lease_id: leaseId, p_result: result,
    }).abortSignal(signal())); },
    heartbeat: async error => { await checked(client.rpc('reminder_sender_heartbeat', error === null ? {} : { p_error: error }).abortSignal(signal())); },
  };
}

function readPage(value: unknown, after: string | null) {
  if (!Array.isArray(value) || value.length > 100) throw Error('invalid_page');
  let previous = after ?? '';
  return value.map(row => {
    if (!record(row) || !isUuid(row.deviceId) || row.deviceId <= previous || !Array.isArray(row.calendarIds) ||
      row.calendarIds.length > 200 || !row.calendarIds.every(isUuid) || new Set(row.calendarIds).size !== row.calendarIds.length) throw Error('invalid_page');
    previous = row.deviceId;
    return { deviceId: row.deviceId, calendarIds: row.calendarIds as string[] };
  });
}

function readContext(value: unknown, calendarId: string) {
  if (!record(value) || typeof value.version !== 'string' || value.version.length !== 64 || !HASH.test(value.version) || !isIsoInstant(value.deviceCreatedAt) ||
    !isCalendarReminderRule(value.rule) || value.rule.calendarId !== calendarId || !record(value.snapshot)) throw Error('invalid_context');
  const raw = value.snapshot;
  if (!Array.isArray(raw.events) || raw.events.length > 5000 || !Array.isArray(raw.eventExceptions) || raw.eventExceptions.length > 10000 ||
    !Array.isArray(raw.todos) || raw.todos.length > 5000) throw Error('invalid_context');
  const snapshot = { events: raw.events.map(parseCalendarEvent), eventExceptions: raw.eventExceptions.map(parseEventException), todos: raw.todos.map(parseTodo) };
  for (const rows of [snapshot.events, snapshot.eventExceptions, snapshot.todos]) {
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw Error('invalid_context');
  }
  const events = new Map(snapshot.events.map(row => [row.id, row]));
  const occurrenceKeys = new Set<string>();
  for (const exception of snapshot.eventExceptions) {
    const source = events.get(exception.eventId), replacement = exception.replacementEventId === null ? null : events.get(exception.replacementEventId);
    if (!source?.recurrence || exception.occurrence.kind !== (source.allDay ? 'all-day' : 'timed') ||
      (exception.replacementEventId !== null && (!replacement || replacement.recurrence !== null))) throw Error('invalid_context');
    const key = exception.eventId + ':' + eventOccurrenceKey(exception.occurrence);
    if (occurrenceKeys.has(key)) throw Error('invalid_context');
    occurrenceKeys.add(key);
  }
  const todos = new Map(snapshot.todos.map(row => [row.id, row]));
  const checked = new Set<string>();
  for (const todo of snapshot.todos) {
    const seen = new Set<string>(); let current = todo;
    while (!checked.has(current.id)) {
      if (seen.has(current.id)) throw Error('invalid_context');
      seen.add(current.id);
      if (current.parentId === null) break;
      const parent = todos.get(current.parentId);
      if (!parent || parent.calendarId !== current.calendarId) throw Error('invalid_context');
      current = parent;
    }
    for (const id of seen) checked.add(id);
  }
  return { snapshot, version: value.version, rule: value.rule, deviceCreatedAt: value.deviceCreatedAt };
}

function readLease(value: unknown, job: ReminderJob) {
  if (!record(value) || !isUuid(value.leaseId) || !isAllowedPushEndpoint(value.endpoint) ||
    typeof value.p256dh !== 'string' || value.p256dh.length !== 87 || !KEY.test(value.p256dh) ||
    typeof value.auth !== 'string' || value.auth.length !== 22 || !AUTH.test(value.auth) ||
    !isIsoInstant(value.expiresAt) || Date.parse(value.expiresAt) !== Date.parse(job.expiresAt)) throw Error('invalid_lease');
  return { leaseId: value.leaseId, subscription: { endpoint: value.endpoint, p256dh: value.p256dh, auth: value.auth } };
}

/** No timers/retries invent new jobs: the DB owns every lease and retry budget. */
export async function runReminderTick(options: ReminderTickOptions): Promise<ReminderTickSummary> {
  const { store, transport, clock = Date.now, budgetMs = 45_000, maxDevices = 10_000 } = options;
  if (!Number.isInteger(budgetMs) || budgetMs < 1 || budgetMs > 120_000 || !Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 10_000) throw Error('reminder_invalid_limits');
  const started = clock();
  function time() {
    const now = clock();
    if (!Number.isFinite(now) || now < started || !isIsoInstant(new Date(now).toISOString())) throw Error('reminder_clock_unavailable');
    return now;
  }
  const summary: ReminderTickSummary = { devices: 0, calendars: 0, sent: 0, retry: 0, failed: 0, gone: 0, skipped: 0, unconfirmed: 0, issues: [] };
  const issues = new Set<Issue>();
  const expiredBudget = () => time() - started >= budgetMs;
  let after: string | null = null;
  try {
    outer: for (;;) {
      if (expiredBudget()) { issues.add('capacity'); break; }
      const page = readPage(await store.page(after), after);
      for (const device of page) {
        if (expiredBudget() || summary.devices >= maxDevices) { issues.add('capacity'); break outer; }
        summary.devices++;
        for (const calendarId of device.calendarIds) {
          if (expiredBudget()) { issues.add('capacity'); break outer; }
          summary.calendars++;
          let context;
          try {
            const value = await store.context(device.deviceId, calendarId);
            if (value === null) { summary.skipped++; continue; }
            context = readContext(value, calendarId);
          } catch { issues.add('planning'); continue; }
          const plan = planReminders(context.snapshot, [context.rule], new Date(time()).toISOString());
          if (plan.issues.length) { issues.add('planning'); continue; }
          for (const job of plan.jobs) {
            if (expiredBudget()) { issues.add('capacity'); break outer; }
            if (Date.parse(job.fireAt) < Date.parse(context.deviceCreatedAt) || time() >= Date.parse(job.expiresAt)) { summary.skipped++; continue; }
            const hash = await reminderJobHash(job.key);
            const value = await store.claim(device.deviceId, calendarId, context.version, hash, job.fireAt);
            if (value === null) { summary.skipped++; continue; }
            const lease = readLease(value, job);
            // Re-read the clock AFTER claim/network latency. Never use a full
            // five-minute TTL for a job whose remaining lifetime is shorter.
            const remaining = Date.parse(job.expiresAt) - time();
            const budgetRemaining = started + budgetMs - time();
            let result: DeliveryResult = 'failed';
            if (remaining < 1000 || budgetRemaining < 1) { summary.skipped++; if (budgetRemaining < 1) issues.add('capacity'); }
            else {
              try {
                const status = await transport.send(lease.subscription, { payload: JSON.stringify({ v: 1, tag: hash }), tag: hash,
                  ttl: Math.floor(remaining / 1000), expiresAt: job.expiresAt, signal: AbortSignal.timeout(Math.min(10_000, Math.floor(remaining), Math.floor(budgetRemaining))) });
                result = !Number.isInteger(status) ? 'failed' : status >= 200 && status < 300 ? 'sent' : status === 404 || status === 410 ? 'gone' :
                  status === 408 || status === 429 || (status >= 500 && status <= 599) ? 'retry' : 'failed';
              } catch { result = 'retry'; }
              if (result === 'retry' || result === 'failed') issues.add('transport');
            }
            try { await store.finish(device.deviceId, hash, lease.leaseId, result); summary[result]++; }
            catch { summary.unconfirmed++; issues.add('transport'); }
          }
        }
      }
      if (page.length < 100) break;
      after = page[page.length - 1]!.deviceId;
    }
  } catch { issues.add('transport'); }
  summary.issues = [...issues].sort();
  try { await store.heartbeat(summary.issues[0] ?? null); }
  catch { if (!issues.has('transport')) summary.issues.push('transport'); }
  return summary;
}

/** Request authentication precedes construction of a privileged client/runner. */
export function createReminderTickHandler(secret: string | undefined, createOptions: () => Promise<ReminderTickOptions> | ReminderTickOptions) {
  const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!secret || !/^[A-Za-z0-9_-]{43,256}$/.test(secret)) return json({ error: 'reminder_unavailable' }, 503);
    const supplied = request.headers.get('Authorization');
    if (!supplied || !/^Bearer [A-Za-z0-9_-]{43,256}$/.test(supplied)) return json({ error: 'unauthorized' }, 401);
    try {
      const [expected, actual] = await Promise.all([reminderJobHash(secret), reminderJobHash(supplied.slice(7))]);
      let difference = 0;
      for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
      if (difference !== 0) return json({ error: 'unauthorized' }, 401);
      const text = await request.text();
      if (text.length > 64) return json({ error: 'invalid_request' }, 400);
      if (text.trim()) {
        let body: unknown;
        try { body = JSON.parse(text); } catch { return json({ error: 'invalid_request' }, 400); }
        if (!record(body) || Object.keys(body).length) return json({ error: 'invalid_request' }, 400);
      }
      const result = await runReminderTick(await createOptions());
      return json(result, result.issues.length ? 503 : 200);
    } catch { return json({ error: 'reminder_unavailable' }, 503); }
  };
}
