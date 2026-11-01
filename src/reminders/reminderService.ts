import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';
import { isIanaTimezone, isIsoInstant, isUuid, MAX_REMINDER_COUNT, MAX_REMINDER_MINUTES } from '../domain/validation';
import { isAllowedPushEndpoint } from './pushEndpoint';

export interface ReminderCapabilities { enabled: boolean; publicKey: string | null; lastTick: string | null }
export interface ReminderRuleInput { calendarId: string; minutesBefore: readonly number[]; timezone: string; dateTime: string; includeTodos: boolean }
export interface ReminderRule extends ReminderRuleInput { updatedAt: string }
export interface ReminderDevice { id: string; createdAt: string; updatedAt: string }
export interface ReminderSnapshot { capabilities: ReminderCapabilities; rules: ReminderRule[]; devices: ReminderDevice[] }
/** Capability data is transient, never part of snapshots, logs or backups. */
export interface ReminderDeviceInput { endpoint: string; p256dh: string; auth: string; publicKey: string }
export interface ReminderService {
  capabilities(): Promise<ReminderCapabilities>;
  load(): Promise<ReminderSnapshot>;
  setRule(input: ReminderRuleInput, expectedUpdatedAt: string | null): Promise<ReminderRule | null>;
  registerDevice(input: ReminderDeviceInput): Promise<string>;
  unregisterDevice(id: string): Promise<void>;
  captureDeviceRemoval(id: string): Promise<() => Promise<void>>;
}
export class ReminderError extends Error {
  constructor(readonly kind: 'invalid' | 'unavailable' | 'conflict' | 'session' | 'failed' | 'cleanup', message: string, readonly pendingDeviceId?: string) {
    super(message); this.name = 'ReminderError';
  }
}
const INVALID = '提醒資訊不完整，請重新確認後再試。';
const FAILED = '暫時無法完成提醒操作，請檢查連線後再試。';
const SESSION = '登入狀態已變更，請重新確認帳號後再試。';
const UNAVAILABLE = '背景提醒尚未啟用，請稍後再試。';
const cleanupError = (deviceId: string) => new ReminderError('cleanup', '伺服器裝置的停用尚未確認，請保持連線後再試。', deviceId);
const KEY = /^B[A-Za-z0-9_-]{86}$/;
const validKey = (value: unknown): value is string => typeof value === 'string' && value.length === 87 && KEY.test(value);
const invalid = (): never => { throw new ReminderError('invalid', INVALID); };
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
}
function id(value: unknown): string { return isUuid(value) && value.length === 36 ? value : invalid(); }
function instant(value: unknown): string { return isIsoInstant(value) ? value : invalid(); }
function list(value: unknown, max: number): unknown[] { return Array.isArray(value) && value.length <= max ? value : invalid(); }
function unique(values: string[]) { if (new Set(values).size !== values.length) invalid(); }
function ruleInput(value: unknown): ReminderRuleInput {
  const row = record(value), minutes = list(row.minutesBefore, MAX_REMINDER_COUNT);
  if (!minutes.every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_REMINDER_MINUTES) ||
      !isIanaTimezone(row.timezone) || typeof row.dateTime !== 'string' || row.dateTime.length !== 5 ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.dateTime) || typeof row.includeTodos !== 'boolean') invalid();
  return { calendarId: id(row.calendarId), minutesBefore: [...minutes] as number[], timezone: row.timezone as string,
    dateTime: row.dateTime as string, includeTodos: row.includeTodos as boolean };
}
function capabilities(value: unknown): ReminderCapabilities {
  const row = record(value);
  if (typeof row.enabled !== 'boolean' || (row.publicKey !== null && !validKey(row.publicKey)) ||
      (row.lastTick !== null && !isIsoInstant(row.lastTick)) || (row.enabled && (!row.publicKey || !row.lastTick))) invalid();
  return { enabled: row.enabled as boolean, publicKey: row.publicKey as string | null, lastTick: row.lastTick as string | null };
}
function rule(value: unknown): ReminderRule {
  const row = record(value), input = ruleInput(row);
  if (!input.minutesBefore.length) invalid();
  return { ...input, updatedAt: instant(row.updatedAt) };
}
function rules(value: unknown, userId: string): ReminderRule[] {
  const result = list(value, 200).map(value => {
    const row = record(value);
    if (row.user_id !== userId) invalid();
    return rule({ calendarId: row.calendar_id, minutesBefore: row.minutes_before, timezone: row.timezone,
      dateTime: row.date_time, includeTodos: row.include_todos, updatedAt: row.updated_at });
  });
  unique(result.map(row => row.calendarId)); return result;
}
function devices(value: unknown, userId: string): ReminderDevice[] {
  const result = list(value, 10).map(value => {
    const row = record(value);
    if (row.user_id !== userId) invalid();
    return { id: id(row.id), createdAt: instant(row.created_at), updatedAt: instant(row.updated_at) };
  });
  unique(result.map(row => row.id)); return result;
}
const ERRORS: Record<string, [ReminderError['kind'], string]> = {
  reminder_sign_in_required: ['session', SESSION],
  reminder_backend_unavailable: ['unavailable', UNAVAILABLE],
  reminder_conflict: ['conflict', '提醒設定已在其他地方變更，請重新載入後再保存。'],
  reminder_calendar_unavailable: ['failed', '已無法讀取這本日曆，請重新確認分享權限。'],
  reminder_calendar_limit: ['failed', '提醒日曆已達上限，請先關閉不需要的提醒。'],
  reminder_device_limit: ['failed', '提醒裝置已達十台，請先停用不需要的裝置。'],
  reminder_subscription_mismatch: ['failed', '這台裝置的推播資料已變更，請重新確認裝置。'],
  reminder_invalid_subscription: ['invalid', INVALID],
  reminder_invalid_settings: ['invalid', INVALID],
};
type Response = { data: unknown; error: { code?: string; message?: string } | null };
interface Query extends PromiseLike<Response> { setHeader(name: string, value: string): Query; retry(enabled: boolean): Query }
async function request(query: Query, token: string): Promise<unknown> {
  const response = await query.setHeader('Authorization', 'Bearer ' + token).retry(false);
  if (response.error) {
    if (['PGRST202', 'PGRST205', '42883', '42P01'].includes(response.error.code ?? '')) throw new ReminderError('unavailable', UNAVAILABLE);
    const [kind, message] = ERRORS[response.error.message ?? ''] ?? ['failed', FAILED];
    throw new ReminderError(kind, message);
  }
  return response.data;
}

/** Per-account, session-only adapter. RLS authorizes; local identity checks prevent stale UI requests. */
export class SupabaseReminderService implements ReminderService {
  constructor(private readonly client: SupabaseClient<Database>, private readonly userId: string) { id(userId); }
  private async token(): Promise<string> {
    const { data, error } = await this.client.auth.getSession();
    if (error || !data.session || data.session.user.id !== this.userId || typeof data.session.access_token !== 'string' ||
        !data.session.access_token.trim()) throw new ReminderError('session', SESSION);
    return data.session.access_token;
  }
  private async run<T>(operation: (token: string) => Promise<T>, compensate?: (result: T, token: string) => Promise<void>): Promise<T> {
    try {
      // Bind this operation to its account even if the shared client's Auth changes while sending.
      const token = await this.token(), result = await operation(token);
      try { await this.token(); } // Late responses must not be accepted after an account change.
      catch (cause) { if (compensate) await compensate(result, token); throw cause; }
      return result;
    } catch (cause) {
      if (cause instanceof ReminderError) throw cause;
      throw new ReminderError('failed', FAILED);
    }
  }
  capabilities() { return this.run(async token => capabilities(await request(this.client.rpc('reminder_capabilities'), token))); }
  load() {
    return this.run(async token => {
      const [rawCapabilities, rawRules, rawDevices] = await Promise.all([
        request(this.client.rpc('reminder_capabilities'), token),
        request(this.client.from('calendar_reminder_settings').select('user_id,calendar_id,minutes_before,timezone,date_time,include_todos,updated_at')
          .eq('user_id', this.userId).order('calendar_id').limit(201), token),
        request(this.client.from('reminder_push_devices').select('id,user_id,created_at,updated_at')
          .eq('user_id', this.userId).order('id').limit(11), token),
      ]);
      return { capabilities: capabilities(rawCapabilities), rules: rules(rawRules, this.userId), devices: devices(rawDevices, this.userId) };
    });
  }
  setRule(input: ReminderRuleInput, expectedUpdatedAt: string | null) {
    return this.run(async token => {
      const clean = ruleInput(input);
      if (expectedUpdatedAt !== null) instant(expectedUpdatedAt);
      const raw = record(await request(this.client.rpc('set_calendar_reminder', {
        p_calendar_id: clean.calendarId, p_minutes_before: [...clean.minutesBefore], p_timezone: clean.timezone,
        p_date_time: clean.dateTime, p_include_todos: clean.includeTodos,
        ...(expectedUpdatedAt === null ? {} : { p_expected_updated_at: expectedUpdatedAt }),
      }), token));
      if (!clean.minutesBefore.length) {
        if (raw.calendarId !== clean.calendarId || raw.updatedAt !== null) invalid();
        return null;
      }
      const saved = rule(raw);
      if (saved.calendarId !== clean.calendarId || saved.timezone !== clean.timezone || saved.dateTime !== clean.dateTime ||
          saved.includeTodos !== clean.includeTodos || JSON.stringify(saved.minutesBefore) !== JSON.stringify(clean.minutesBefore)) invalid();
      return saved;
    });
  }
  registerDevice(input: ReminderDeviceInput) {
    return this.run(async token => {
      record(input);
      if (!isAllowedPushEndpoint(input.endpoint) || !validKey(input.p256dh) || !validKey(input.publicKey) ||
          typeof input.auth !== 'string' || input.auth.length !== 22 || !/^[A-Za-z0-9_-]{22}$/.test(input.auth)) invalid();
      return id(await request(this.client.rpc('register_reminder_device', {
        p_endpoint: input.endpoint, p_p256dh: input.p256dh, p_auth: input.auth, p_public_key: input.publicKey,
      }), token));
    }, (deviceId, token) => this.removeWithToken(deviceId, token));
  }
  unregisterDevice(deviceId: string) {
    return this.run(token => this.removeWithToken(id(deviceId), token));
  }
  /** Fixed-id, memory-only cleanup capability; no Auth mutation or generic stale-session requests. */
  captureDeviceRemoval(deviceId: string): Promise<() => Promise<void>> {
    return this.run(async token => {
      const target = id(deviceId);
      return () => this.removeWithToken(target, token);
    });
  }
  private async removeWithToken(deviceId: string, token: string): Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(cleanupError(deviceId)); }, 5000);
    });
    const remove = async () => {
      const raw = await request(this.client.rpc('unregister_reminder_device', { p_device_id: deviceId }).abortSignal(controller.signal), token);
      if (raw !== null && raw !== undefined) throw cleanupError(deviceId);
      const remaining = await request(this.client.from('reminder_push_devices').select('id,user_id')
        .eq('user_id', this.userId).eq('id', deviceId).limit(1).abortSignal(controller.signal), token);
      if (!Array.isArray(remaining) || remaining.length !== 0) throw cleanupError(deviceId);
    };
    try { await Promise.race([remove(), expired]); }
    catch { throw cleanupError(deviceId); }
    finally { clearTimeout(timer); controller.abort(); }
  }
}
