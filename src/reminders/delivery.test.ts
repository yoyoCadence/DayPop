import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createReminderTickHandler, isAllowedPushEndpoint, reminderJobHash, runReminderTick, type ReminderStore, type ReminderTransport } from './delivery';

const NOW = Date.parse('2026-10-31T01:00:00.000Z');
const EARLIER = '2026-01-01T00:00:00.000Z';
const calendar = '50000000-0000-4000-8000-000000000001';
const otherCalendar = '50000000-0000-4000-8000-000000000002';
const eventId = '10000000-0000-4000-8000-000000000001';
const device = '60000000-0000-4000-8000-000000000001';
const leaseId = '70000000-0000-4000-8000-000000000001';
const secret = 'synthetic_sender_token_'.padEnd(43, 'X');
const context = () => ({
  version: 'c'.repeat(64), deviceCreatedAt: EARLIER,
  rule: { calendarId: calendar, minutesBefore: [0], timezone: 'UTC', dateTime: '01:00', includeTodos: true, updatedAt: EARLIER },
  snapshot: { events: [{ id: eventId, calendarId: calendar, title: 'DayPop', location: null, notes: null,
    reminderMinutes: [], recurrence: null, sharingScope: 'inherit', allDay: true, startDate: '2026-10-31', endDate: '2026-10-31',
    createdAt: EARLIER, updatedAt: EARLIER }], eventExceptions: [], todos: [] },
});
const lease = () => ({ leaseId, endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-test', p256dh: 'B' + 'C'.repeat(86), auth: 'D'.repeat(22), expiresAt: '2026-10-31T01:05:00.000Z' });
function fixture() {
  const store = {
    page: vi.fn<ReminderStore['page']>(async () => [{ deviceId: device, calendarIds: [calendar] }]),
    context: vi.fn<ReminderStore['context']>(async () => context()),
    claim: vi.fn<ReminderStore['claim']>(async () => lease()),
    finish: vi.fn<ReminderStore['finish']>(async () => {}), heartbeat: vi.fn<ReminderStore['heartbeat']>(async () => {}),
  };
  const transport = { send: vi.fn<ReminderTransport['send']>(async () => 201) };
  let now = NOW;
  const options = { store, transport, clock: () => now };
  return { store, transport, options, advance: (ms: number) => { now += ms; }, run: () => runReminderTick(options) };
}
beforeAll(() => vi.stubGlobal('crypto', webcrypto));
afterAll(() => vi.unstubAllGlobals());

describe('server reminder delivery core', () => {
  it('prints the actual process timezone', () => {
    process.stdout.write('DP-221 actual timezone: ' + Intl.DateTimeFormat().resolvedOptions().timeZone + '\n');
  });
  it('hashes stable logical jobs with standard SHA-256', async () => {
    expect(await reminderJobHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('claims before sending and emits only a version and opaque stable tag', async () => {
    const f = fixture(); const result = await f.run();
    const hash = f.store.claim.mock.calls[0]?.[3];
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(f.store.claim.mock.calls[0]).toEqual([device, calendar, 'c'.repeat(64), hash, '2026-10-31T01:00:00.000Z']);
    const message = f.transport.send.mock.calls[0]?.[1];
    expect(JSON.parse(message!.payload)).toEqual({ v: 1, tag: hash });
    expect(message).toMatchObject({ tag: hash, ttl: 300, expiresAt: '2026-10-31T01:05:00.000Z' });
    expect(message!.signal).toBeInstanceOf(AbortSignal);
    expect(f.store.claim.mock.invocationCallOrder[0]).toBeLessThan(f.transport.send.mock.invocationCallOrder[0]!);
    expect(f.store.finish).toHaveBeenCalledWith(device, hash, leaseId, 'sent');
    expect(result).toMatchObject({ devices: 1, calendars: 1, sent: 1, issues: [] });
    expect(JSON.stringify(result)).not.toMatch(/googleapis|p256dh|auth|60000000|10000000/);
    expect(f.store.heartbeat).toHaveBeenCalledWith(null);
  });
  it.each([200, 202, 204])('accepts successful provider status %s', async status => {
    const f = fixture(); f.transport.send.mockResolvedValue(status);
    expect((await f.run()).sent).toBe(1);
  });
  it.each([404, 410])('removes expired subscription only on status %s', async status => {
    const f = fixture(); f.transport.send.mockResolvedValue(status);
    expect(await f.run()).toMatchObject({ gone: 1, issues: [] });
    expect(f.store.finish.mock.calls[0]?.[3]).toBe('gone');
  });
  it.each([408, 429, 500, 503, 599])('uses durable retry for transient status %s', async status => {
    const f = fixture(); f.transport.send.mockResolvedValue(status);
    expect(await f.run()).toMatchObject({ retry: 1, issues: ['transport'] });
    expect(f.transport.send).toHaveBeenCalledTimes(1);
    expect(f.store.finish.mock.calls[0]?.[3]).toBe('retry');
  });
  it.each([0, 300, 302, 400, 401, 403, 422, 999, NaN, Infinity, 204.5, 503.5])('does not retry or follow terminal/invalid status %s', async status => {
    const f = fixture(); f.transport.send.mockResolvedValue(status);
    expect(await f.run()).toMatchObject({ failed: 1, issues: ['transport'] });
    expect(f.transport.send).toHaveBeenCalledTimes(1);
    expect(f.store.finish.mock.calls[0]?.[3]).toBe('failed');
  });
  it('treats network ambiguity as one retry with the same hash, without leaking error text', async () => {
    const f = fixture(); f.transport.send.mockRejectedValue(Error('PRIVATE_ENDPOINT_AND_KEY'));
    const result = await f.run();
    expect(result).toMatchObject({ retry: 1, issues: ['transport'] });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(f.store.claim).toHaveBeenCalledTimes(1);
  });
  it('never sends when a fresh DB claim rejects a stale or already leased job', async () => {
    const f = fixture(); f.store.claim.mockResolvedValue(null);
    expect(await f.run()).toMatchObject({ skipped: 1, sent: 0, issues: [] });
    expect(f.transport.send).not.toHaveBeenCalled(); expect(f.store.finish).not.toHaveBeenCalled();
  });
  it('skips a revoked/disabled context without inventing a fallback snapshot', async () => {
    const f = fixture(); f.store.context.mockResolvedValue(null);
    expect(await f.run()).toMatchObject({ skipped: 1, issues: [] });
    expect(f.store.claim).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('re-reads time after claim, preserving remaining job TTL independently of tick budget', async () => {
    const f = fixture(); f.advance(120_000);
    f.store.claim.mockImplementation(async () => { f.advance(2500); return lease(); });
    expect((await f.run()).sent).toBe(1);
    expect(f.transport.send.mock.calls[0]?.[1].ttl).toBe(177);
  });
  it('does not deliver when the claim response arrives after expiry', async () => {
    const f = fixture(); f.advance(240_000);
    f.store.claim.mockImplementation(async () => { f.advance(61_000); return lease(); });
    expect(await runReminderTick({ ...f.options, budgetMs: 120_000 })).toMatchObject({ sent: 0, skipped: 1, failed: 1 });
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(f.store.finish.mock.calls[0]?.[3]).toBe('failed');
  });
  it('does not deliver when claim exhausts the invocation budget', async () => {
    const f = fixture(); f.store.claim.mockImplementation(async () => { f.advance(50_000); return lease(); });
    expect(await f.run()).toMatchObject({ skipped: 1, retry: 1, failed: 0, issues: ['capacity'] });
    expect(f.transport.send).not.toHaveBeenCalled(); expect(f.store.finish.mock.calls[0]?.[3]).toBe('retry');
  });
  it('never backfills before this device registered', async () => {
    const f = fixture(); f.store.context.mockResolvedValue({ ...context(), deviceCreatedAt: '2026-10-31T01:00:01.000Z' });
    expect((await f.run()).skipped).toBe(1); expect(f.store.claim).not.toHaveBeenCalled();
  });
  it('marks accepted transport with lost finish acknowledgement as unconfirmed', async () => {
    const f = fixture(); f.store.finish.mockRejectedValue(Error('PRIVATE_FINISH_RESPONSE'));
    expect(await f.run()).toMatchObject({ sent: 0, unconfirmed: 1, issues: ['transport'] });
    expect(f.transport.send).toHaveBeenCalledTimes(1);
  });
  it('fails closed on a malformed lease, before handing capabilities to transport', async () => {
    const f = fixture(); f.store.claim.mockResolvedValue({ ...lease(), endpoint: 'https://fcm.googleapis.com.evil.test/push' });
    expect((await f.run()).issues).toContain('transport'); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('rejects a lease with a changed expiry', async () => {
    const f = fixture(); f.store.claim.mockResolvedValue({ ...lease(), expiresAt: '2026-10-31T02:00:00Z' });
    expect((await f.run()).issues).toContain('transport'); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each([
    { ...context(), version: 'invalid' }, { ...context(), rule: { ...context().rule, calendarId: otherCalendar } },
    { ...context(), snapshot: { ...context().snapshot, events: null } },
    { ...context(), snapshot: { ...context().snapshot, events: Array.from({ length: 5001 }, () => context().snapshot.events[0]) } },
    { ...context(), snapshot: { ...context().snapshot, events: [...context().snapshot.events, ...context().snapshot.events] } },
  ])('rejects malformed or over-capacity calendar responses %#', async value => {
    const f = fixture(); f.store.context.mockResolvedValue(value);
    expect((await f.run()).issues).toEqual(['planning']); expect(f.store.claim).not.toHaveBeenCalled();
  });
  it('isolates an unavailable calendar and continues a healthy one', async () => {
    const f = fixture(); f.store.page.mockResolvedValue([{ deviceId: device, calendarIds: [otherCalendar, calendar] }]);
    f.store.context.mockImplementation(async (_device, id) => { if (id === otherCalendar) throw Error('PRIVATE_RECORD'); return context(); });
    expect(await f.run()).toMatchObject({ calendars: 2, sent: 1, issues: ['planning'] });
  });
  it('rejects missing exception sources and cycles in todo ancestry', async () => {
    const f = fixture();
    f.store.context.mockResolvedValue({ ...context(), snapshot: { ...context().snapshot, eventExceptions: [{
      id: '30000000-0000-4000-8000-000000000001', eventId, occurrence: { kind: 'all-day', date: '2026-10-31' },
      isCancelled: true, replacementEventId: null, createdAt: EARLIER, updatedAt: EARLIER,
    }] } }); // The source is non-recurring, so this is an invalid exception graph.
    expect((await f.run()).issues).toEqual(['planning']); expect(f.store.claim).not.toHaveBeenCalled();
    const todo = { id: eventId, calendarId: calendar, parentId: eventId, title: 'DayPop', dueDate: '2026-10-31',
      priority: 'none', sortOrder: 0, completedAt: null, sharingScope: 'inherit', createdAt: EARLIER, updatedAt: EARLIER };
    f.store.context.mockResolvedValue({ ...context(), snapshot: { ...context().snapshot, todos: [todo] } });
    expect((await f.run()).issues).toEqual(['planning']); expect(f.store.claim).not.toHaveBeenCalled();
  });
  it('paginates using the DB cursor without repeating previous devices', async () => {
    const f = fixture(), id = (value: number) => '60000000-0000-4000-8000-' + String(value).padStart(12, '0');
    const page = Array.from({ length: 100 }, (_, index) => ({ deviceId: id(index + 1), calendarIds: [] }));
    f.store.page.mockImplementation(async after => after === null ? page : [{ deviceId: id(101), calendarIds: [] }]);
    expect(await f.run()).toMatchObject({ devices: 101, issues: [] });
    expect(f.store.page.mock.calls).toEqual([[null], [id(100)]]);
  });
  it('stops repeated cursors instead of looping indefinitely', async () => {
    const f = fixture();
    f.store.page.mockResolvedValue(Array.from({ length: 100 }, (_, index) => ({ deviceId: '60000000-0000-4000-8000-' + String(index).padStart(12, '0'), calendarIds: [] })));
    expect((await f.run()).issues).toContain('transport'); expect(f.store.page).toHaveBeenCalledTimes(2);
  });
  it('reports a capacity issue when device or time budget leaves work incomplete', async () => {
    const f = fixture(); f.store.page.mockResolvedValue([
      { deviceId: device, calendarIds: [] }, { deviceId: '60000000-0000-4000-8000-000000000002', calendarIds: [] },
    ]);
    expect(await runReminderTick({ ...f.options, maxDevices: 1 })).toMatchObject({ devices: 1, issues: ['capacity'] });
    f.store.page.mockImplementation(async () => { f.advance(100); return [{ deviceId: device, calendarIds: [calendar] }]; });
    expect(await runReminderTick({ ...f.options, budgetMs: 50 })).toMatchObject({ devices: 0, issues: ['capacity'] });
  });
  it('reports store and heartbeat outages without raw backend errors', async () => {
    const f = fixture(); f.store.page.mockRejectedValue(Error('PRIVATE_DATABASE_ERROR'));
    expect(await f.run()).toMatchObject({ sent: 0, issues: ['transport'] });
    f.store.page.mockResolvedValue([]); f.store.heartbeat.mockRejectedValue(Error('PRIVATE_HEARTBEAT_ERROR'));
    expect(await f.run()).toMatchObject({ sent: 0, issues: ['transport'] });
  });
});

describe('server reminder endpoint boundary', () => {
  it.each([undefined, '', 'short'])('keeps missing/invalid server configuration disabled %#', async token => {
    const f = fixture(), factory = vi.fn(() => f.options);
    const response = await createReminderTickHandler(token, factory)(new Request('https://local.test/tick', { method: 'POST' }));
    expect(response.status).toBe(503); expect(factory).not.toHaveBeenCalled();
  });
  it.each([undefined, 'Bearer public_publishable_key', 'Bearer ' + 'X'.repeat(43), 'Basic ' + secret])('rejects public or wrong caller before creating a privileged client %#', async authorization => {
    const f = fixture(), factory = vi.fn(() => f.options);
    const response = await createReminderTickHandler(secret, factory)(new Request('https://local.test/tick', { method: 'POST', headers: authorization ? { Authorization: authorization } : {} }));
    expect(response.status).toBe(401); expect(factory).not.toHaveBeenCalled(); expect(f.store.page).not.toHaveBeenCalled();
  });
  it.each(['GET', 'OPTIONS', 'PUT'])('does not start work for method %s', async method => {
    const f = fixture(), factory = vi.fn(() => f.options);
    const response = await createReminderTickHandler(secret, factory)(new Request('https://local.test/tick', { method, headers: { Authorization: 'Bearer ' + secret } }));
    expect(response.status).toBe(405); expect(factory).not.toHaveBeenCalled();
  });
  it.each(['[]', 'null', 'not-json', '{"userId":"override"}', 'X'.repeat(65)])('does not accept caller-selected jobs or recipients %#', async body => {
    const f = fixture(), factory = vi.fn(() => f.options);
    const response = await createReminderTickHandler(secret, factory)(new Request('https://local.test/tick', { method: 'POST', headers: { Authorization: 'Bearer ' + secret }, body }));
    expect(response.status).toBe(400); expect(factory).not.toHaveBeenCalled();
  });
  it('returns only aggregate confirmation and disables caching', async () => {
    const f = fixture(), factory = vi.fn(() => f.options);
    const response = await createReminderTickHandler(secret, factory)(new Request('https://local.test/tick', { method: 'POST', headers: { Authorization: 'Bearer ' + secret }, body: '{}' }));
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ sent: 1, issues: [] }); expect(factory).toHaveBeenCalledTimes(1);
  });
  it('reports partial/failed dispatch as unavailable, with no sensitive error detail', async () => {
    const f = fixture(); f.transport.send.mockRejectedValue(Error('PRIVATE_ENDPOINT'));
    const request = () => new Request('https://local.test/tick', { method: 'POST', headers: { Authorization: 'Bearer ' + secret } });
    const response = await createReminderTickHandler(secret, () => f.options)(request());
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('PRIVATE');
    const broken = await createReminderTickHandler(secret, () => { throw Error('PRIVATE_SERVICE_KEY'); })(request());
    expect(broken.status).toBe(503); expect(await broken.text()).not.toContain('PRIVATE');
  });
});

describe('server push destination allowlist', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/test', 'https://updates.push.services.mozilla.com/wpush/v2/test',
    'https://web.push.apple.com/test', 'https://db5p.notify.windows.com/test',
  ])('accepts expected browser service %s', endpoint => expect(isAllowedPushEndpoint(endpoint)).toBe(true));
  it.each([
    'http://fcm.googleapis.com/test', 'https://fcm.googleapis.com.evil.test/push', 'https://fcm.googleapis.com@evil.test/push',
    'https://fcm.googleapis.com:443/test', 'https://fcm.googleapis.com/test#fragment', 'https://127.0.0.1/push',
    ' https://fcm.googleapis.com/test', 'https://fcm.googleapis.com/test\n', 'https://fcm.googleapis.com/' + 'x'.repeat(2048),
  ])('rejects malformed, local or lookalike destination %#', endpoint => expect(isAllowedPushEndpoint(endpoint)).toBe(false));
});
