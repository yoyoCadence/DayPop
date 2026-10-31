import assert from 'node:assert/strict';
import { createReminderRuntime, createPushTransport, validateVapid, type ServiceClient } from './runtime.ts';
import { createReminderTickHandler } from './core.generated.js';

const text = new TextEncoder();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
const concat = (...values: Uint8Array[]) => {
  const bytes = new Uint8Array(values.reduce((sum, value) => sum + value.length, 0));
  let offset = 0; for (const value of values) { bytes.set(value, offset); offset += value.length; } return bytes;
};
async function fixture() {
  const vapidKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateJwk = await crypto.subtle.exportKey('jwk', vapidKeys.privateKey);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', vapidKeys.publicKey));
  const userKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const userRaw = new Uint8Array(await crypto.subtle.exportKey('raw', userKeys.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const vapid = { publicKey: encode(publicRaw), privateKey: privateJwk.d!, subject: 'https://example.test/contact' };
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/local-fixture', p256dh: encode(userRaw), auth: encode(auth) };
  const message = () => ({ payload: JSON.stringify({ v: 1, tag: 'a'.repeat(64) }), tag: 'a'.repeat(64), ttl: 240,
    expiresAt: new Date(Date.now() + 240_000).toISOString(), signal: new AbortController().signal });
  return { vapid, subscription, message, vapidKeys, userKeys, userRaw, auth };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

// Independent WebCrypto recipient, following RFC 8291 §3.4 / RFC 8188.
// Production encryption stays in the pinned library, not in this verifier.
async function decrypt(body: Uint8Array, f: Fixture) {
  const salt = body.slice(0, 16), keyLength = body[20]!;
  assert.equal(keyLength, 65);
  const serverRaw = body.slice(21, 21 + keyLength);
  const serverKey = await crypto.subtle.importKey('raw', serverRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: serverKey }, f.userKeys.privateKey, 256));
  async function hkdf(input: Uint8Array, saltBytes: Uint8Array, info: Uint8Array, length: number) {
    const key = await crypto.subtle.importKey('raw', new Uint8Array(input), 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(saltBytes), info: new Uint8Array(info) }, key, length * 8));
  }
  const ikm = await hkdf(shared, f.auth, concat(text.encode('WebPush: info\0'), f.userRaw, serverRaw), 32);
  const cek = await hkdf(ikm, salt, text.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, text.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + keyLength)));
  let end = plain.length - 1; while (plain[end] === 0) end--;
  assert.equal(plain[end], 2, 'single final record has the authenticated delimiter');
  return JSON.parse(new TextDecoder().decode(plain.slice(0, end)));
}

function fakeClient(configuration: unknown) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client: ServiceClient = { rpc(name, args = {}) {
    calls.push({ name, args });
    const result = Promise.resolve({ data: name === 'reminder_sender_configuration' ? configuration : name === 'reminder_sender_page' ? [] : null, error: null });
    const call: ReturnType<ServiceClient['rpc']> = Object.assign(result, { abortSignal: () => call });
    return call;
  } };
  return { client, calls };
}

Deno.test('prints actual Deno timezone and runtime', () => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(`DP-222 Deno ${Deno.version.deno}; actual timezone: ${zone}`);
  const requested = Deno.env.get('TZ');
  if (requested === 'UTC' || requested === 'America/New_York') assert.equal(zone, requested);
});

Deno.test('real library encryption decrypts with independent recipient WebCrypto; VAPID signature verifies', async () => {
  const f = await fixture(); await validateVapid(f.vapid);
  let captured: Request | undefined;
  const fetcher: typeof fetch = async (input, init) => { captured = new Request(input, init); return new Response(null, { status: 201 }); };
  const transport = createPushTransport(f.vapid, fetcher);
  const message = f.message();
  assert.equal(await transport.send(f.subscription, message), 201);
  const request = captured!;
  assert.equal(request.url, f.subscription.endpoint); assert.equal(request.method, 'POST');
  assert.equal(request.redirect, 'manual'); assert.equal(request.headers.get('Content-Encoding'), 'aes128gcm');
  assert.equal(request.headers.get('Topic'), message.tag.slice(0, 32));
  assert.ok(Number(request.headers.get('TTL')) <= 240 && Number(request.headers.get('TTL')) > 0);
  const body = new Uint8Array(await request.arrayBuffer());
  assert.deepEqual(await decrypt(body, f), { v: 1, tag: message.tag });
  const authorization = request.headers.get('Authorization')!;
  const jwt = /t=([^,\s]+)/.exec(authorization)![1]!;
  assert.equal(/k=([^,\s]+)/.exec(authorization)![1], f.vapid.publicKey);
  const [header, payload, signature] = jwt.split('.');
  assert.equal(JSON.parse(new TextDecoder().decode(decode(header!))).alg, 'ES256');
  const claims = JSON.parse(new TextDecoder().decode(decode(payload!)));
  assert.equal(claims.aud, 'https://fcm.googleapis.com'); assert.equal(claims.sub, f.vapid.subject);
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 86400);
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, f.vapidKeys.publicKey, decode(signature!), text.encode(header + '.' + payload)), true);
  body[body.length - 1] ^= 1;
  await assert.rejects(() => decrypt(body, f), 'corrupted ciphertext must fail authentication');
});

Deno.test('malformed or mismatched VAPID pair cannot create a service client', async () => {
  const f = await fixture(), other = await fixture();
  await assert.rejects(() => validateVapid({ ...f.vapid, privateKey: other.vapid.privateKey }), /reminder_runtime_unavailable/);
  await assert.rejects(() => validateVapid({ ...f.vapid, publicKey: 'bad' }), /reminder_runtime_unavailable/);
  await assert.rejects(() => validateVapid({ ...f.vapid, subject: 'https://localhost' }), /reminder_runtime_unavailable/);
  let calls = 0;
  const env = (name: string) => ({ SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_synthetic_fixture',
    DAYPOP_VAPID_PUBLIC_KEY: f.vapid.publicKey, DAYPOP_VAPID_PRIVATE_KEY: other.vapid.privateKey, DAYPOP_VAPID_SUBJECT: f.vapid.subject } as Record<string, string>)[name];
  await assert.rejects(() => createReminderRuntime(env, () => { calls++; throw Error('must not create'); }), /reminder_runtime_unavailable/);
  assert.equal(calls, 0);
});

Deno.test('disabled/mismatched DB key stays unavailable; matching runtime binds heartbeat to its key', async () => {
  const f = await fixture();
  const values: Record<string, string> = { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_synthetic_fixture',
    DAYPOP_VAPID_PUBLIC_KEY: f.vapid.publicKey, DAYPOP_VAPID_PRIVATE_KEY: f.vapid.privateKey, DAYPOP_VAPID_SUBJECT: f.vapid.subject };
  const env = (name: string) => values[name];
  for (const configuration of [{ enabled: false, publicKey: f.vapid.publicKey }, { enabled: true, publicKey: 'wrong' }]) {
    const db = fakeClient(configuration);
    await assert.rejects(() => createReminderRuntime(env, () => db.client), /reminder_runtime_unavailable/);
    assert.equal(db.calls.length, 1); assert.equal(db.calls[0]!.name, 'reminder_sender_configuration');
  }
  const db = fakeClient({ enabled: true, publicKey: f.vapid.publicKey });
  const runtime = await createReminderRuntime(env, () => db.client);
  await runtime.store.heartbeat(null);
  assert.deepEqual(db.calls.at(-1), { name: 'reminder_sender_heartbeat', args: { p_public_key: f.vapid.publicKey } });
  const token = crypto.randomUUID() + crypto.randomUUID(); let factories = 0;
  const handler = createReminderTickHandler(token, () => { factories++; return runtime; });
  assert.equal((await handler(new Request('https://fixture.test/tick', { method: 'POST' }))).status, 401);
  assert.equal(factories, 0);
  const response = await handler(new Request('https://fixture.test/tick', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: '{}' }));
  assert.equal(response.status, 200); assert.equal((await response.json()).sent, 0); assert.equal(factories, 1);
});

Deno.test('public key and unapproved service URL cannot construct a runtime', async () => {
  const f = await fixture(); let calls = 0;
  const values: Record<string, string> = { SUPABASE_URL: 'https://evil.example.test', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fixture',
    DAYPOP_VAPID_PUBLIC_KEY: f.vapid.publicKey, DAYPOP_VAPID_PRIVATE_KEY: f.vapid.privateKey, DAYPOP_VAPID_SUBJECT: f.vapid.subject };
  const env = (name: string) => values[name];
  const clients = () => { calls++; throw Error('must not create'); };
  await assert.rejects(() => createReminderRuntime(env, clients), /reminder_runtime_unavailable/);
  values.SUPABASE_URL = 'https://fixture.supabase.co'; values.SUPABASE_SERVICE_ROLE_KEY = 'sb_publishable_fixture';
  await assert.rejects(() => createReminderRuntime(env, clients), /reminder_runtime_unavailable/);
  values.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_fixture'; values.SUPABASE_URL = 'http://127.0.0.1:56321';
  await assert.rejects(() => createReminderRuntime(env, clients), /reminder_runtime_unavailable/);
  assert.equal(calls, 0);
});

Deno.test('unsafe destination, extra payload or expired TTL never reaches fetch', async () => {
  const f = await fixture(); let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw Error('must not fetch'); };
  const transport = createPushTransport(f.vapid, fetcher);
  assert.equal(await transport.send({ ...f.subscription, endpoint: 'https://fcm.googleapis.com.evil.test/push' }, f.message()), 400);
  assert.equal(await transport.send(f.subscription, { ...f.message(), payload: '{"v":1,"title":"PRIVATE"}' }), 400);
  assert.equal(await transport.send(f.subscription, { ...f.message(), expiresAt: new Date(Date.now() - 1).toISOString() }), 400);
  assert.equal(await transport.send(f.subscription, { ...f.message(), ttl: 0 }), 400);
  assert.equal(await transport.send({ ...f.subscription, p256dh: 'invalid' }, f.message()), 400);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => transport.send(f.subscription, { ...f.message(), signal: controller.signal }));
  assert.equal(calls, 0);
});

Deno.test('clock is re-read after encryption; hidden duplicate JSON fields are not encrypted', async () => {
  const f = await fixture(); const now = Date.now(); let reads = 0; let request: Request | undefined;
  const transport = createPushTransport(f.vapid, async (input, init) => { request = new Request(input, init); return new Response(null, { status: 202 }); }, () => now + (reads++ ? 2500 : 0));
  const message = { ...f.message(), ttl: 240, expiresAt: new Date(now + 240_000).toISOString(), payload: '{"v":"PRIVATE","v":1,"tag":"' + 'a'.repeat(64) + '"}' };
  assert.equal(await transport.send(f.subscription, message), 202);
  assert.equal(request!.headers.get('TTL'), '237');
  assert.deepEqual(await decrypt(new Uint8Array(await request!.arrayBuffer()), f), { v: 1, tag: 'a'.repeat(64) });
});

Deno.test('manual redirect response is terminal and provider body is discarded', async () => {
  const f = await fixture(); let calls = 0;
  const transport = createPushTransport(f.vapid, async (_input, init) => {
    calls++; assert.equal(init!.redirect, 'manual');
    return new Response('PRIVATE_PROVIDER_ERROR', { status: 302, headers: { Location: 'https://evil.example.test' } });
  });
  assert.equal(await transport.send(f.subscription, f.message()), 302); assert.equal(calls, 1);
});
