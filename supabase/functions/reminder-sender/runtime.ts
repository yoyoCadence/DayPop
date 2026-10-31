import { createClient } from '@supabase/supabase-js';
// Published package + declarations are pinned; do not import moving GitHub code.
// @deno-types="npm:@types/web-push@3.6.4"
import webPush from 'web-push';
import { classifySupabaseKey, createReminderStore, isAllowedPushEndpoint } from './core.generated.js';

interface Vapid { publicKey: string; privateKey: string; subject: string }
interface Subscription { endpoint: string; p256dh: string; auth: string }
interface Message { payload: string; tag: string; ttl: number; expiresAt: string; signal: AbortSignal }
interface RpcResult { data: unknown; error: unknown }
interface RpcCall extends PromiseLike<RpcResult> { abortSignal(signal: AbortSignal): RpcCall }
export interface ServiceClient { rpc(name: string, args?: Record<string, unknown>): RpcCall }
type ClientFactory = (url: string, key: string) => ServiceClient;
type Environment = (name: string) => string | undefined;
const keyPattern = /^B[A-Za-z0-9_-]{86}$/;
const privatePattern = /^[A-Za-z0-9_-]{43}$/;
const hashPattern = /^[a-f0-9]{64}$/;
// http_ece captures this debug flag at module load. Refuse all encryption if
// it was set; never allow derived encryption keys to reach runtime logs.
const keyLoggingEnabled = Deno.env.get('ECE_KEYLOG') === '1';
const unavailable = () => new Error('reminder_runtime_unavailable');
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

export async function validateVapid(vapid: Vapid): Promise<void> {
  if (keyLoggingEnabled) throw unavailable();
  if (vapid.publicKey.length !== 87 || !keyPattern.test(vapid.publicKey) || vapid.privateKey.length !== 43 || !privatePattern.test(vapid.privateKey)) throw unavailable();
  let subject: URL;
  try { subject = new URL(vapid.subject); } catch { throw unavailable(); }
  if (vapid.subject.length > 300 || /\s/.test(vapid.subject) || subject.username || subject.password ||
    !((subject.protocol === 'https:' && subject.hostname !== 'localhost') || (subject.protocol === 'mailto:' && /^[^@\s]+@[^@\s]+$/.test(subject.pathname)))) throw unavailable();
  try {
    const raw = decode(vapid.publicKey);
    const coordinates = { kty: 'EC', crv: 'P-256', x: encode(raw.slice(1, 33)), y: encode(raw.slice(33, 65)) };
    const algorithm = { name: 'ECDSA', namedCurve: 'P-256' };
    const privateKey = await crypto.subtle.importKey('jwk', { ...coordinates, d: vapid.privateKey }, algorithm, false, ['sign']);
    const publicKey = await crypto.subtle.importKey('jwk', coordinates, algorithm, false, ['verify']);
    const challenge = new TextEncoder().encode('DayPop reminder VAPID pair check');
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, challenge);
    if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, challenge)) throw unavailable();
  } catch { throw unavailable(); }
}

/** Library encrypts/signs; only this adapter performs network I/O. */
export function createPushTransport(vapid: Vapid, fetcher: typeof fetch = fetch, clock: () => number = Date.now) {
  return { async send(subscription: Subscription, message: Message): Promise<number> {
    if (keyLoggingEnabled) throw unavailable();
    if (!isAllowedPushEndpoint(subscription.endpoint) || !hashPattern.test(message.tag) || message.tag.length !== 64 ||
      !Number.isInteger(message.ttl) || message.ttl < 1 || message.ttl > 300) return 400;
    let payload: unknown;
    try { payload = JSON.parse(message.payload); } catch { return 400; }
    if (!record(payload) || payload.v !== 1 || payload.tag !== message.tag || Object.keys(payload).length !== 2) return 400;
    const expires = Date.parse(message.expiresAt);
    let ttl = Math.min(message.ttl, Math.floor((expires - clock()) / 1000));
    if (!Number.isFinite(ttl) || ttl < 1) return 400;
    message.signal.throwIfAborted();
    let details;
    try {
      // Re-encode the only permitted fields; duplicate JSON keys cannot hide
      // private text in the original byte string supplied by a caller.
      details = webPush.generateRequestDetails({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify({ v: 1, tag: message.tag }), { vapidDetails: vapid, TTL: ttl, contentEncoding: 'aes128gcm', topic: message.tag.slice(0, 32), urgency: 'normal' });
    } catch { return 400; }
    if (details.endpoint !== subscription.endpoint || details.method !== 'POST') return 400;
    ttl = Math.min(ttl, Math.floor((expires - clock()) / 1000));
    if (!Number.isFinite(ttl) || ttl < 1) return 400;
    message.signal.throwIfAborted();
    const headers = new Headers();
    for (const [name, value] of Object.entries(details.headers)) {
      if (value !== undefined && name.toLowerCase() !== 'content-length') headers.set(name, Array.isArray(value) ? value.join(',') : String(value));
    }
    headers.set('TTL', String(ttl));
    const response = await fetcher(details.endpoint, { method: 'POST', headers, body: new Uint8Array(details.body),
      redirect: 'manual', signal: message.signal });
    // Never follow a 3xx or parse/log provider error bodies. Preserve a known
    // accepted status even if cancellation of its unused body fails.
    try { await response.body?.cancel(); } catch { /* status remains known */ }
    return response.status;
  } };
}

function databaseUrl(raw: string | undefined, allowLocal: boolean): string {
  let url: URL;
  try { url = new URL(raw ?? ''); } catch { throw unavailable(); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw unavailable();
  const hosted = url.protocol === 'https:' && /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) && !url.port;
  const local = allowLocal && url.protocol === 'http:' && ['127.0.0.1', 'localhost', 'kong'].includes(url.hostname) && ['8000', '54321', '56321'].includes(url.port);
  if (!hosted && !local) throw unavailable();
  return url.href;
}

const defaultClient: ClientFactory = (url, key) => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

/** Called only AFTER core request authentication. All failures are sanitized. */
export async function createReminderRuntime(env: Environment, clients: ClientFactory = defaultClient, fetcher: typeof fetch = fetch, clock: () => number = Date.now) {
  const api = databaseUrl(env('SUPABASE_URL'), env('DAYPOP_REMINDER_ALLOW_LOCAL') === 'true');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const kind = classifySupabaseKey(serviceKey);
  if (!serviceKey || (kind !== 'secret' && kind !== 'service-role-jwt')) throw unavailable();
  const vapid = { publicKey: env('DAYPOP_VAPID_PUBLIC_KEY') ?? '', privateKey: env('DAYPOP_VAPID_PRIVATE_KEY') ?? '', subject: env('DAYPOP_VAPID_SUBJECT') ?? '' };
  await validateVapid(vapid);
  const client = clients(api, serviceKey);
  const configuration = await client.rpc('reminder_sender_configuration').abortSignal(AbortSignal.timeout(10_000));
  if (configuration.error || !record(configuration.data) || configuration.data.enabled !== true || configuration.data.publicKey !== vapid.publicKey) throw unavailable();
  return { store: createReminderStore(client, vapid.publicKey), transport: createPushTransport(vapid, fetcher, clock), clock };
}
