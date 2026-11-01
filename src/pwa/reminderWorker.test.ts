import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runReminderTick, type ReminderStore } from '../reminders/delivery';

const template = readFileSync(resolve('pwa/sw-template.js'), 'utf8');
const generated = readFileSync(resolve('public/sw.js'), 'utf8');
const version = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version as string;
const HASH = 'a'.repeat(64), TAG = 'daypop-reminder-' + HASH;
type Client = { url: string; focus: ReturnType<typeof vi.fn<() => Promise<unknown>>>; navigate: ReturnType<typeof vi.fn> };
const client = (url: string): Client => ({ url, focus: vi.fn(async () => undefined), navigate: vi.fn() });

function harness(scope = 'https://app.example/DayPop/', windows: Client[] = []) {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const show = vi.fn<(title: string, options: NotificationOptions) => Promise<void>>(async () => {});
  const open = vi.fn(async () => undefined), match = vi.fn(async () => windows), skip = vi.fn();
  const forbidden = vi.fn(() => { throw new Error('Worker accessed unrelated data or network'); });
  const logs = vi.fn();
  const context = { self: { addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => listeners.set(name, handler),
    registration: { scope, showNotification: show }, location: { origin: 'https://app.example' },
    clients: { matchAll: match, openWindow: open }, skipWaiting: skip }, URL,
    caches: { open: forbidden, keys: forbidden, delete: forbidden, match: forbidden }, fetch: forbidden,
    console: { log: logs, warn: logs, error: logs } };
  for (const key of ['localStorage', 'indexedDB']) Object.defineProperty(context, key, { get: forbidden });
  runInNewContext(generated, context, { filename: 'actual-public-sw.js' });
  function dispatch(name: string, props: Record<string, unknown>) {
    const handler = listeners.get(name);
    if (!handler) throw new Error('Worker did not register ' + name);
    const promises: Promise<unknown>[] = [];
    handler({ ...props, waitUntil: (promise: Promise<unknown>) => promises.push(promise) });
    return { pending: Promise.all(promises), waits: promises.length };
  }
  return { show, open, match, skip, forbidden, logs, dispatch,
    push: (value: unknown) => dispatch('push', { data: { json: () => value } }),
    click: (extra: Record<string, unknown> = {}) => {
      const close = vi.fn();
      const result = dispatch('notificationclick', { notification: { tag: TAG, data: { type: 'daypop-reminder', v: 1 }, close, ...extra } });
      return { ...result, close };
    },
    expectPrivateDataUntouched: () => { expect(forbidden).not.toHaveBeenCalled(); expect(logs).not.toHaveBeenCalled(); },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('actual reminder worker (DP-226)', () => {
  it('reports only the supported reminder protocol without activating or touching data (DP-228)', async () => {
    const h = harness(), reply = vi.fn();
    await h.dispatch('message', { data: { type: 'GET_REMINDER_CAPABILITIES', v: 1 }, ports: [{ postMessage: reply }] }).pending;
    expect(reply).toHaveBeenCalledExactlyOnceWith({ type: 'REMINDER_CAPABILITIES', v: 1 });
    expect(h.skip).not.toHaveBeenCalled(); expect(h.show).not.toHaveBeenCalled(); h.expectPrivateDataUntouched();
    reply.mockClear();
    await h.dispatch('message', { data: { type: 'GET_REMINDER_CAPABILITIES', v: 2 }, ports: [{ postMessage: reply }] }).pending;
    await h.dispatch('message', { data: { type: 'GET_REMINDER_CAPABILITIES', v: 1 }, ports: [] }).pending;
    expect(reply).not.toHaveBeenCalled();
    await h.dispatch('message', { data: { type: 'SKIP_WAITING' } }).pending;
    expect(h.skip).toHaveBeenCalledOnce(); h.expectPrivateDataUntouched();
  });
  it('executes the exact generated template and prints the effective timezone', () => {
    expect(generated).toBe(template.replaceAll('__DAYPOP_VERSION__', version));
    process.stdout.write('DP-226 actual timezone: ' + Intl.DateTimeFormat().resolvedOptions().timeZone + '\n');
  });

  it('shows only fixed anonymous text and uses a stable tag across repeated messages', async () => {
    const h = harness();
    await h.push({ v: 1, tag: HASH }).pending; await h.push({ tag: HASH, v: 1 }).pending;
    expect(h.show).toHaveBeenCalledTimes(2);
    expect(h.show.mock.calls[0]).toEqual(['日蹦 DayPop', {
      body: '有日曆提醒，開啟日蹦查看。', icon: 'https://app.example/DayPop/icons/daypop.svg', tag: TAG,
      renotify: false, data: { type: 'daypop-reminder', v: 1 },
    }]);
    expect(h.show.mock.calls[1]).toEqual(h.show.mock.calls[0]);
    await h.push({ v: 1, tag: 'b'.repeat(64) }).pending;
    expect(h.show.mock.calls[2]?.[1].tag).not.toBe(TAG);
    expect(h.open).not.toHaveBeenCalled(); h.expectPrivateDataUntouched();
  });

  it.each([
    undefined, null, [], {}, { v: 2, tag: HASH }, { v: '1', tag: HASH }, { v: true, tag: HASH },
    { v: 1, tag: 42 }, { v: 1, tag: 'A'.repeat(64) }, { v: 1, tag: 'a'.repeat(63) },
    { v: 1, tag: 'a'.repeat(65) }, { v: 1, tag: HASH + '\n' },
    { v: 1, tag: HASH, title: 'PRIVATE' }, { v: 1, tag: HASH, url: 'https://external.example/' },
  ].map(value => [value]))('refuses malformed or extended wire %j', async value => {
    const h = harness(), event = h.push(value);
    await event.pending; expect(event.waits).toBe(0); expect(h.show).not.toHaveBeenCalled(); h.expectPrivateDataUntouched();
  });

  it('refuses missing or unparsable PushMessageData without logging its bytes', async () => {
    const h = harness();
    await h.dispatch('push', { data: null }).pending;
    await h.dispatch('push', { data: { json: () => { throw new Error('PRIVATE parse text'); } } }).pending;
    expect(h.show).not.toHaveBeenCalled(); h.expectPrivateDataUntouched();
  });

  it('propagates notification permission failure through the event lifetime', async () => {
    const h = harness(); h.show.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'));
    const event = h.push({ v: 1, tag: HASH }); expect(event.waits).toBe(1);
    await expect(event.pending).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(h.open).not.toHaveBeenCalled(); h.expectPrivateDataUntouched();
  });

  it('focuses an existing App without navigating or losing an unsaved route', async () => {
    const app = client('https://app.example/DayPop/?draft=unsaved#sheet');
    const h = harness(undefined, [client('https://app.example/outside.html'), app]);
    const event = h.click({ data: { type: 'daypop-reminder', v: 1, url: 'https://external.example/' } });
    await event.pending; expect(event.close).toHaveBeenCalledOnce(); expect(app.focus).toHaveBeenCalledOnce();
    expect(app.navigate).not.toHaveBeenCalled(); expect(h.open).not.toHaveBeenCalled();
    expect(h.match).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true }); h.expectPrivateDataUntouched();
  });

  it.each(['https://app.example/DayPop/', 'https://app.example/'])('opens only its fixed scope %s when no App is open', async scope => {
    const candidates = [client('https://external.example/DayPop/'), client('https://app.example.evil/DayPop/'),
      client('https://app.example@external.example/DayPop/'), client('not a URL')];
    if (scope.endsWith('/DayPop/')) candidates.push(client('https://app.example/DayPop-evil/'));
    const h = harness(scope, candidates);
    await h.click({ data: { type: 'daypop-reminder', v: 1, url: 'https://external.example/' } }).pending;
    expect(h.open).toHaveBeenCalledExactlyOnceWith(scope);
    for (const candidate of candidates) expect(candidate.focus).not.toHaveBeenCalled();
    h.expectPrivateDataUntouched();
  });

  it('tries another client when the first closes, then falls back to the App scope', async () => {
    const first = client('https://app.example/DayPop/'), second = client('https://app.example/DayPop/?draft=keep');
    first.focus.mockRejectedValue(new Error('closed')); const h = harness(undefined, [first, second]);
    await h.click().pending; expect(second.focus).toHaveBeenCalledOnce(); expect(h.open).not.toHaveBeenCalled();
    second.focus.mockRejectedValue(new Error('also closed')); await h.click().pending;
    expect(h.open).toHaveBeenCalledExactlyOnceWith('https://app.example/DayPop/'); h.expectPrivateDataUntouched();
  });

  it('can open the App if listing clients fails', async () => {
    const h = harness(); h.match.mockRejectedValueOnce(new Error('unavailable'));
    await h.click().pending; expect(h.open).toHaveBeenCalledExactlyOnceWith('https://app.example/DayPop/'); h.expectPrivateDataUntouched();
  });

  it.each([
    { data: null }, { data: { type: 'another-app', v: 1 } }, { data: { type: 'daypop-reminder', v: 2 } },
    { tag: HASH }, { tag: TAG + '\n' }, { tag: 'daypop-reminder-' + 'A'.repeat(64) },
  ])('ignores a notification it does not own: %j', async extra => {
    const h = harness(), event = h.click(extra); await event.pending;
    expect(event.close).not.toHaveBeenCalled(); expect(event.waits).toBe(0); expect(h.open).not.toHaveBeenCalled(); expect(h.match).not.toHaveBeenCalled();
    h.expectPrivateDataUntouched();
  });

  it.each(['https://external.example/DayPop/', 'invalid scope', 'https://app.example/DayPop'])('refuses unsafe or ambiguous scope %s', async scope => {
    const h = harness(scope); await h.click().pending;
    expect(h.open).not.toHaveBeenCalled(); expect(h.match).not.toHaveBeenCalled(); h.expectPrivateDataUntouched();
  });

  it('consumes the real dispatcher wire without exposing its private event fields', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const h = harness(), earlier = '2026-01-01T00:00:00.000Z', now = Date.parse('2026-11-01T01:00:00.000Z');
    const calendarId = '50000000-0000-4000-8000-000000000001';
    const store: ReminderStore = {
      page: async () => [{ deviceId: '60000000-0000-4000-8000-000000000001', calendarIds: [calendarId] }],
      context: async () => ({ version: 'c'.repeat(64), deviceCreatedAt: earlier,
        rule: { calendarId, minutesBefore: [0], timezone: 'UTC', dateTime: '01:00', includeTodos: false, updatedAt: earlier },
        snapshot: { events: [{ id: '10000000-0000-4000-8000-000000000001', calendarId, title: 'PRIVATE event', location: 'PRIVATE place', notes: 'PRIVATE notes',
          allDay: true, startDate: '2026-11-01', endDate: '2026-11-01', recurrence: null, reminderMinutes: [], sharingScope: 'inherit', createdAt: earlier, updatedAt: earlier }], eventExceptions: [], todos: [] } }),
      claim: async () => ({ leaseId: '70000000-0000-4000-8000-000000000001', endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic', p256dh: 'B' + 'C'.repeat(86), auth: 'D'.repeat(22), expiresAt: '2026-11-01T01:05:00.000Z' }),
      finish: async () => {}, heartbeat: async () => {},
    };
    const result = await runReminderTick({ store, clock: () => now, transport: { send: async (_subscription, message) => {
      await h.dispatch('push', { data: { json: () => JSON.parse(message.payload) } }).pending; return 201;
    } } });
    expect(result.sent).toBe(1); expect(h.show).toHaveBeenCalledOnce();
    expect(JSON.stringify(h.show.mock.calls)).not.toContain('PRIVATE'); h.expectPrivateDataUntouched();
  });
});
