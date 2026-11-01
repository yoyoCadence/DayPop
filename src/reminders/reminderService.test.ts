import { createClient, type Session } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../lib/database.types';
import { ReminderError, SupabaseReminderService, type ReminderRuleInput } from './reminderService';

const A = '00000000-0000-4000-8000-000000000227', B = '00000000-0000-4000-8000-000000000228';
const CALENDAR = '00000000-0000-4000-8000-000000000229', DEVICE = '00000000-0000-4000-8000-000000000230';
const NOW = '2026-11-01T01:00:00.123456+00:00';
const KEY = 'B' + 'C'.repeat(86), AUTH = 'D'.repeat(22);
const enabled = { enabled: true, publicKey: KEY, lastTick: NOW };
const input: ReminderRuleInput = { calendarId: CALENDAR, minutesBefore: [0, 15], timezone: 'America/New_York', dateTime: '09:00', includeTodos: true };
const rule = { ...input, updatedAt: NOW };
const row = { user_id: A, calendar_id: CALENDAR, minutes_before: [0, 15], timezone: input.timezone, date_time: input.dateTime, include_todos: true, updated_at: NOW };
const device = { id: DEVICE, user_id: A, created_at: NOW, updated_at: NOW };
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic', p256dh: KEY, auth: AUTH, publicKey: KEY };
let clientSequence = 0;
function session(userId = A): Session {
  return { access_token: 'synthetic-token-' + userId, token_type: 'bearer', refresh_token: 'synthetic-refresh', expires_in: 3600,
    user: { id: userId, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: NOW } };
}
function remote(replies: Record<string, unknown> = {}) {
  const responses: Record<string, unknown> = { reminder_capabilities: enabled, calendar_reminder_settings: [row], reminder_push_devices: [device],
    set_calendar_reminder: rule, register_reminder_device: DEVICE, unregister_reminder_device: null, ...replies };
  const fetcher = vi.fn<typeof fetch>(async target => {
    const name = new URL(String(target)).pathname.split('/').at(-1)!;
    return new Response(JSON.stringify(responses[name]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const client = createClient<Database>('https://reminder-test.example.invalid', 'synthetic-publishable-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'reminder-fixture-' + ++clientSequence }, global: { fetch: fetcher },
  });
  const auth = vi.spyOn(client.auth, 'getSession').mockResolvedValue({ data: { session: session() }, error: null });
  return { service: new SupabaseReminderService(client, A), fetcher, client, auth };
}
function fail(h: ReturnType<typeof remote>, code: string, message: string) {
  h.fetcher.mockImplementation(async () => new Response(JSON.stringify({ code, message, details: 'PRIVATE detail ' + subscription.endpoint }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  }));
}
afterEach(() => vi.restoreAllMocks());

describe('reminder client boundary (DP-227)', () => {
  it('loads exact safe projections with owner filters through the actual SDK, without persisting secrets', async () => {
    process.stdout.write('DP-227 actual timezone: ' + Intl.DateTimeFormat().resolvedOptions().timeZone + '\n');
    const h = remote({ reminder_push_devices: [{ ...device, endpoint: subscription.endpoint, auth_key: AUTH }],
      calendar_reminder_settings: [{ ...row, private_text: 'PRIVATE' }], reminder_capabilities: { ...enabled, secret: 'PRIVATE' } });
    const write = vi.spyOn(Storage.prototype, 'setItem');
    expect(await h.service.load()).toEqual({ capabilities: enabled, rules: [rule], devices: [{ id: DEVICE, createdAt: NOW, updatedAt: NOW }] });
    expect(h.fetcher).toHaveBeenCalledTimes(3); expect(write).not.toHaveBeenCalled();
    const requests = h.fetcher.mock.calls.map(([target, init]) => ({ url: new URL(String(target)), init }));
    const rules = requests.find(r => r.url.pathname.endsWith('/calendar_reminder_settings'))!.url;
    const devices = requests.find(r => r.url.pathname.endsWith('/reminder_push_devices'))!.url;
    expect(rules.searchParams.get('select')).toBe('user_id,calendar_id,minutes_before,timezone,date_time,include_todos,updated_at');
    expect(devices.searchParams.get('select')).toBe('id,user_id,created_at,updated_at');
    expect(rules.searchParams.get('limit')).toBe('201'); expect(devices.searchParams.get('limit')).toBe('11');
    for (const url of [rules, devices]) expect(url.searchParams.get('user_id')).toBe('eq.' + A);
    for (const { init } of requests) expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ' + session().access_token);
    expect(requests.every(r => !r.url.pathname.includes('sender'))).toBe(true);
  });
  it('preserves disabled backend state, including a stale public key, without inventing readiness', async () => {
    const stale = { enabled: false, publicKey: KEY, lastTick: NOW };
    expect(await remote({ reminder_capabilities: stale }).service.capabilities()).toEqual(stale);
    const disabled = { enabled: false, publicKey: null, lastTick: null };
    expect(await remote({ reminder_capabilities: disabled, calendar_reminder_settings: [], reminder_push_devices: [] }).service.load())
      .toEqual({ capabilities: disabled, rules: [], devices: [] });
  });
  it.each([null, [], {}, { ...enabled, enabled: 'true' }, { ...enabled, publicKey: null }, { ...enabled, lastTick: null },
    { ...enabled, publicKey: KEY + '\n' }, { ...enabled, lastTick: '2026-11-01T01:00:00' }, { ...enabled, lastTick: 'not-time' }].map(value => [value]))('rejects malformed capabilities %j', async value => {
    await expect(remote({ reminder_capabilities: value }).service.capabilities()).rejects.toMatchObject({ kind: 'invalid' });
  });
  it.each([
    { calendar_reminder_settings: null }, { calendar_reminder_settings: [{ ...row, user_id: B }] },
    { calendar_reminder_settings: [row, row] }, { calendar_reminder_settings: Array(201).fill(row) },
    { calendar_reminder_settings: [{ ...row, minutes_before: [] }] }, { calendar_reminder_settings: [{ ...row, updated_at: 'bad' }] },
    { reminder_push_devices: null }, { reminder_push_devices: [{ ...device, user_id: B }] },
    { reminder_push_devices: [device, device] }, { reminder_push_devices: Array(11).fill(device) },
    { reminder_push_devices: [{ ...device, id: 'bad' }] }, { reminder_push_devices: [{ ...device, created_at: 'bad' }] },
  ])('rejects partial, foreign, duplicated or oversized projections %#', async replies => {
    await expect(remote(replies).service.load()).rejects.toMatchObject({ kind: 'invalid' });
  });
  it('sends exact CAS microseconds and allowlisted rule fields, leaving the input unchanged', async () => {
    const h = remote(); const frozen = Object.freeze({ ...input, minutesBefore: Object.freeze([...input.minutesBefore]), private: 'PRIVATE' });
    expect(await h.service.setRule(frozen, NOW)).toEqual(rule);
    expect(JSON.parse(String(h.fetcher.mock.calls[0]![1]?.body))).toEqual({ p_calendar_id: CALENDAR, p_minutes_before: [0, 15],
      p_timezone: input.timezone, p_date_time: input.dateTime, p_include_todos: true, p_expected_updated_at: NOW });
    expect(frozen.minutesBefore).toEqual([0, 15]);
    const first = remote(); await first.service.setRule(input, null);
    expect(JSON.parse(String(first.fetcher.mock.calls[0]![1]?.body))).not.toHaveProperty('p_expected_updated_at');
  });
  it('requires the exact calendar and null version to confirm turning off an inaccessible rule', async () => {
    const off = { ...input, minutesBefore: [] };
    expect(await remote({ set_calendar_reminder: { calendarId: CALENDAR, updatedAt: null } }).service.setRule(off, NOW)).toBeNull();
    for (const value of [null, {}, { calendarId: CALENDAR, updatedAt: NOW }, { calendarId: DEVICE, updatedAt: null }])
      await expect(remote({ set_calendar_reminder: value }).service.setRule(off, NOW)).rejects.toThrow(ReminderError);
  });
  it.each([{ ...rule, calendarId: DEVICE }, { ...rule, minutesBefore: [30] }, { ...rule, timezone: 'UTC' },
    { ...rule, dateTime: '10:00' }, { ...rule, includeTodos: false }, { ...rule, updatedAt: null }])('does not accept a changed or incomplete save acknowledgment %#', async value => {
    await expect(remote({ set_calendar_reminder: value }).service.setRule(input, NOW)).rejects.toMatchObject({ kind: 'invalid' });
  });
  it.each([{ ...input, calendarId: 'bad' }, { ...input, minutesBefore: [NaN] }, { ...input, minutesBefore: [-1] },
    { ...input, minutesBefore: [0.5] }, { ...input, minutesBefore: [10081] }, { ...input, minutesBefore: Array(11).fill(0) },
    { ...input, timezone: 'Mars/Olympus' }, { ...input, dateTime: '24:00' }, { ...input, dateTime: '09:00\n' },
    { ...input, includeTodos: null }, { ...input, minutesBefore: null }])('refuses invalid rule input before any database call %#', async value => {
    const h = remote(); await expect(h.service.setRule(value as ReminderRuleInput, null)).rejects.toMatchObject({ kind: 'invalid' });
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('refuses invalid expected versions before sending', async () => {
    const h = remote(); await expect(h.service.setRule(input, 'local-time')).rejects.toMatchObject({ kind: 'invalid' });
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('registers only capability fields and confirms the returned device id', async () => {
    const h = remote(); expect(await h.service.registerDevice({ ...subscription, private: 'PRIVATE' } as typeof subscription)).toBe(DEVICE);
    expect(JSON.parse(String(h.fetcher.mock.calls[0]![1]?.body))).toEqual({ p_endpoint: subscription.endpoint, p_p256dh: KEY, p_auth: AUTH, p_public_key: KEY });
    await expect(remote({ register_reminder_device: { id: DEVICE } }).service.registerDevice(subscription)).rejects.toMatchObject({ kind: 'invalid' });
  });
  it.each([{ ...subscription, endpoint: 'https://fcm.googleapis.com.evil.test/push' }, { ...subscription, endpoint: 'http://127.0.0.1/push' },
    { ...subscription, p256dh: KEY + '\n' }, { ...subscription, publicKey: 'broken' }, { ...subscription, auth: AUTH + '\n' }])('does not send malformed device capabilities %#', async value => {
    const h = remote(); await expect(h.service.registerDevice(value)).rejects.toMatchObject({ kind: 'invalid' }); expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('unregisters only the requested id and requires a void acknowledgment', async () => {
    const h = remote(); await h.service.unregisterDevice(DEVICE);
    expect(JSON.parse(String(h.fetcher.mock.calls[0]![1]?.body))).toEqual({ p_device_id: DEVICE });
    await expect(remote({ unregister_reminder_device: false }).service.unregisterDevice(DEVICE)).rejects.toMatchObject({ kind: 'invalid' });
    const invalid = remote(); await expect(invalid.service.unregisterDevice('bad')).rejects.toMatchObject({ kind: 'invalid' }); expect(invalid.fetcher).not.toHaveBeenCalled();
  });
  it.each(['PGRST202', 'PGRST205', '42883', '42P01'])('reports missing schema %s as unavailable', async code => {
    const h = remote(); fail(h, code, 'PRIVATE SQL'); await expect(h.service.load()).rejects.toMatchObject({ kind: 'unavailable' });
  });
  it('reports known conflicts safely and never retries a mutation', async () => {
    const h = remote(); fail(h, 'P0001', 'reminder_conflict');
    await expect(h.service.setRule(input, NOW)).rejects.toMatchObject({ kind: 'conflict', message: expect.stringContaining('重新載入') });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    fail(h, '55000', 'reminder_backend_unavailable'); await expect(h.service.registerDevice(subscription)).rejects.toMatchObject({ kind: 'unavailable' });
  });
  it('discards arbitrary server/network details and capability values without logging', async () => {
    const h = remote(), logs = vi.spyOn(console, 'error'); fail(h, '42501', subscription.endpoint + AUTH);
    const error = await h.service.registerDevice(subscription).catch(error => error);
    expect(error).toBeInstanceOf(ReminderError); expect(error.message).not.toContain(subscription.endpoint); expect(error.message).not.toContain(AUTH); expect(error.cause).toBeUndefined();
    h.fetcher.mockRejectedValueOnce(new Error('PRIVATE ' + AUTH));
    await expect(h.service.unregisterDevice(DEVICE)).rejects.toMatchObject({ kind: 'failed', message: '暫時無法完成提醒操作，請檢查連線後再試。' });
    expect(logs).not.toHaveBeenCalled();
  });
  it('rejects missing or changed sessions before any database request', async () => {
    const h = remote(); h.auth.mockResolvedValue({ data: { session: null }, error: null });
    await expect(h.service.registerDevice(subscription)).rejects.toMatchObject({ kind: 'session' });
    h.auth.mockResolvedValue({ data: { session: session(B) }, error: null });
    await expect(h.service.setRule(input, NOW)).rejects.toMatchObject({ kind: 'session' }); expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('refuses empty access tokens and null capability input without leaking implementation errors', async () => {
    const h = remote(); h.auth.mockResolvedValue({ data: { session: { ...session(), access_token: ' ' } }, error: null });
    await expect(h.service.load()).rejects.toMatchObject({ kind: 'session' }); expect(h.fetcher).not.toHaveBeenCalled();
    h.auth.mockResolvedValue({ data: { session: session() }, error: null });
    await expect(h.service.registerDevice(null as unknown as typeof subscription)).rejects.toMatchObject({ kind: 'invalid' });
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('pins a sending operation to A even when the shared client switches to B, then rejects the late result', async () => {
    const h = remote(); h.auth.mockResolvedValue({ data: { session: session(B) }, error: null })
      .mockResolvedValueOnce({ data: { session: session() }, error: null });
    await expect(h.service.registerDevice(subscription)).rejects.toMatchObject({ kind: 'session' });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(new Headers(h.fetcher.mock.calls[0]![1]?.headers).get('Authorization')).toBe('Bearer ' + session().access_token);
    await expect(h.service.unregisterDevice(DEVICE)).rejects.toMatchObject({ kind: 'session' }); expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not accept a late load under another account, while pinning all three requests to A', async () => {
    const h = remote(); h.auth.mockResolvedValue({ data: { session: session(B) }, error: null })
      .mockResolvedValueOnce({ data: { session: session() }, error: null });
    await expect(h.service.load()).rejects.toMatchObject({ kind: 'session' }); expect(h.fetcher).toHaveBeenCalledTimes(3);
    for (const [, init] of h.fetcher.mock.calls) expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ' + session().access_token);
  });
});
