import assert from 'node:assert/strict';
import { createPushTransport } from './runtime.ts';

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
async function fixture() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const user = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    vapid: { publicKey: encode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))), privateKey: privateJwk.d!, subject: 'https://example.test/contact' },
    subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/local-only', p256dh: encode(new Uint8Array(await crypto.subtle.exportKey('raw', user.publicKey))), auth: encode(crypto.getRandomValues(new Uint8Array(16))) },
    message: { payload: JSON.stringify({ v: 1, tag: 'a'.repeat(64) }), tag: 'a'.repeat(64), ttl: 240, expiresAt: new Date(Date.now() + 240_000).toISOString() },
  };
}

Deno.test('native fetch never follows provider redirects, including redirects back to a local server', async () => {
  const f = await fixture(); let arrivals = 0;
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async (request): Promise<Response> => {
    arrivals++; await request.arrayBuffer();
    return new Response('discarded provider text', { status: 307, headers: { Location: `http://127.0.0.1:${server.addr.port}/redirected` } });
  });
  try {
    // Test-only mapping, with --allow-net=127.0.0.1. Production has no rewrite.
    const fetcher: typeof fetch = (_input, init) => fetch(`http://127.0.0.1:${server.addr.port}/push`, init);
    const transport = createPushTransport(f.vapid, fetcher);
    assert.equal(await transport.send(f.subscription, { ...f.message, signal: new AbortController().signal }), 307);
    assert.equal(arrivals, 1);
  } finally { await server.shutdown(); }
});

Deno.test('native fetch aborts an outstanding provider request at the supplied deadline', async () => {
  const f = await fixture(); const controller = new AbortController(); let arrivals = 0;
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async request => {
    arrivals++; await request.arrayBuffer();
    controller.abort();
    return new Response(null, { status: 201 });
  });
  try {
    const fetcher: typeof fetch = (_input, init) => fetch(`http://127.0.0.1:${server.addr.port}/push`, init);
    await assert.rejects(() => createPushTransport(f.vapid, fetcher).send(f.subscription, { ...f.message, signal: controller.signal }), { name: 'AbortError' });
    assert.equal(arrivals, 1);
  } finally { await server.shutdown(); }
});
