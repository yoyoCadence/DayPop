import assert from 'node:assert/strict';
// A separate test worker imports the package with its diagnostic flag enabled.
Deno.env.set('ECE_KEYLOG', '1');
const { validateVapid, createPushTransport } = await import('./runtime.ts');
Deno.test('key logging environment cannot validate keys or reach encryption/fetch', async () => {
  let fetches = 0, warnings = 0;
  const previous = console.warn;
  console.warn = () => { warnings++; };
  try {
    const vapid = { publicKey: 'B' + 'A'.repeat(86), privateKey: 'A'.repeat(43), subject: 'https://example.test/contact' };
    await assert.rejects(() => validateVapid(vapid), /reminder_runtime_unavailable/);
    const transport = createPushTransport(vapid, async () => { fetches++; return new Response(null); });
    await assert.rejects(() => transport.send({ endpoint: 'https://fcm.googleapis.com/test', p256dh: '', auth: '' },
      { payload: '{}', tag: 'a'.repeat(64), ttl: 60, expiresAt: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal }), /reminder_runtime_unavailable/);
    assert.equal(fetches, 0); assert.equal(warnings, 0);
  } finally { console.warn = previous; }
});
