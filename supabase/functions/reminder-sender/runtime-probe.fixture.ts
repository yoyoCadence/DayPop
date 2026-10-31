// Local-only fixture copied to a separate, temporary function by the test.
// Not imported by the production index; never deploy this fixture endpoint.
import { createPushTransport, validateVapid } from '../reminder-sender/runtime.ts';

Deno.serve(async request => {
  if (request.method !== 'POST' || request.headers.get('Authorization') !== 'Bearer ' + Deno.env.get('DAYPOP_REMINDER_TOKEN')) return new Response(null, { status: 401 });
  try {
    const vapid = { publicKey: Deno.env.get('DAYPOP_VAPID_PUBLIC_KEY') ?? '', privateKey: Deno.env.get('DAYPOP_VAPID_PRIVATE_KEY') ?? '', subject: Deno.env.get('DAYPOP_VAPID_SUBJECT') ?? '' };
    await validateVapid(vapid);
    const subscription = await request.json();
    let captured: Request | undefined;
    // No network: capture the real library output INSIDE the Edge container.
    const transport = createPushTransport(vapid, async (input, init) => {
      captured = new Request(input, init); return new Response(null, { status: 201 });
    });
    const tag = 'f'.repeat(64);
    const status = await transport.send(subscription, { payload: JSON.stringify({ v: 1, tag }), tag, ttl: 240,
      expiresAt: new Date(Date.now() + 240_000).toISOString(), signal: new AbortController().signal });
    if (status !== 201 || !captured) throw Error('probe_failed');
    return Response.json({ ciphertext: btoa(String.fromCharCode(...new Uint8Array(await captured.arrayBuffer()))),
      authorization: captured.headers.get('Authorization'), encoding: captured.headers.get('Content-Encoding'),
      ttl: captured.headers.get('TTL'), zone: Intl.DateTimeFormat().resolvedOptions().timeZone, deno: Deno.version.deno });
  } catch { return Response.json({ error: 'probe_failed' }, { status: 503 }); }
});
