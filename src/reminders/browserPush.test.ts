import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserReminderDevice, BrowserReminderError, type ReminderBrowser, type ReminderRegistration } from './browserPush';

const publicBytes = new Uint8Array(65); publicBytes[0] = 4;
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const KEY = encode(publicBytes), READY = { enabled: true, publicKey: KEY };
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/synthetic-browser';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function harness(options: Partial<Pick<ReminderBrowser, 'secure' | 'supported' | 'ios' | 'standalone' | 'scope'>> = {}) {
  let current: PushSubscription | null = null, permission: NotificationPermission = 'default', time = 1000, activated = true;
  let answer: unknown = { type: 'REMINDER_CAPABILITIES', v: 1 }, reply = true;
  const channels: MessageChannel[] = [];
  const get = vi.fn(async () => current);
  function subscription(extra: Partial<PushSubscription> = {}) {
    const value = { endpoint: ENDPOINT, options: { applicationServerKey: publicBytes.buffer },
      getKey: vi.fn((name: string) => name === 'p256dh' ? publicBytes.slice().buffer : new Uint8Array(16).buffer),
      unsubscribe: vi.fn(async () => { if (current === value) current = null; return true; }), ...extra } as unknown as PushSubscription;
    return value;
  }
  const created = subscription(), subscribe = vi.fn(async () => { current = created; return created; });
  const respond = () => channels.at(-1)!.port1.onmessage?.(new MessageEvent('message', { data: answer }));
  const worker = { state: 'activated' as ServiceWorkerState, postMessage: vi.fn(() => { if (reply) queueMicrotask(respond); }) };
  const registration = { scope: 'https://app.example/DayPop/', active: worker, pushManager: { getSubscription: get, subscribe } } satisfies ReminderRegistration;
  const request = vi.fn<() => Promise<NotificationPermission>>(() => { permission = 'granted'; return Promise.resolve(permission); });
  const browser: ReminderBrowser = {
    secure: true, supported: true, ios: false, standalone: false, origin: 'https://app.example', scope: registration.scope,
    permission: () => permission, userActivation: () => activated, requestPermission: request,
    registration: vi.fn(async () => registration), now: () => time,
    channel: () => {
      const channel = { port1: { onmessage: null, close: vi.fn() }, port2: { close: vi.fn() } } as unknown as MessageChannel;
      channels.push(channel); return channel;
    }, ...options,
  };
  return { device: new BrowserReminderDevice(browser), browser, worker, registration, channels, request, get, subscribe, created, subscription, respond,
    setCurrent: (value: PushSubscription | null) => { current = value; }, setPermission: (value: NotificationPermission) => { permission = value; },
    setTime: (value: number) => { time = value; }, setActivation: (value: boolean) => { activated = value; },
    setReply: (value: boolean, data: unknown = answer) => { reply = value; answer = data; },
  };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('browser reminder adapter (DP-228)', () => {
  it('prepares a supported worker without requesting permission, subscribing or persisting', async () => {
    process.stdout.write('DP-228 actual timezone: ' + Intl.DateTimeFormat().resolvedOptions().timeZone + '\n');
    const h = harness(), store = vi.spyOn(Storage.prototype, 'setItem');
    expect(await h.device.prepare(READY)).toEqual({ permission: 'default', subscription: 'none' });
    expect(h.worker.postMessage).toHaveBeenCalledWith({ type: 'GET_REMINDER_CAPABILITIES', v: 1 }, [h.channels[0]!.port2]);
    for (const channel of h.channels) { expect(channel.port1.close).toHaveBeenCalledOnce(); expect(channel.port2.close).toHaveBeenCalledOnce(); }
    expect(h.request).not.toHaveBeenCalled(); expect(h.subscribe).not.toHaveBeenCalled(); expect(store).not.toHaveBeenCalled();
  });
  it.each([
    [{ secure: false }, 'unsupported'], [{ supported: false }, 'unsupported'], [{ ios: true, standalone: false }, 'install'],
  ] as const)('blocks unavailable browser state %# before preflight I/O', async (options, kind) => {
    const h = harness(options); await expect(h.device.prepare(READY)).rejects.toMatchObject({ kind });
    expect(h.browser.registration).not.toHaveBeenCalled(); expect(h.request).not.toHaveBeenCalled();
  });
  it('allows a supported iPhone Home Screen app and a root scope', async () => {
    const h = harness({ ios: true, standalone: true, scope: 'https://app.example/' }); h.registration.scope = 'https://app.example/';
    expect((await h.device.prepare(READY)).subscription).toBe('none');
  });
  it.each([{ enabled: false, publicKey: null }, { enabled: true, publicKey: null }, { enabled: true, publicKey: KEY + '\n' }])('does not prepare a disabled or malformed backend %#', async capabilities => {
      const h = harness(); await expect(h.device.prepare(capabilities)).rejects.toBeInstanceOf(BrowserReminderError);
      expect(h.browser.registration).not.toHaveBeenCalled(); expect(h.request).not.toHaveBeenCalled();
    });
  it.each(['https://external.example/DayPop/', 'https://app.example/DayPop-evil/', 'https://app.example/'])('refuses a foreign registration %s', async scope => {
    const h = harness(); h.registration.scope = scope;
    await expect(h.device.prepare(READY)).rejects.toMatchObject({ kind: 'worker' }); expect(h.worker.postMessage).not.toHaveBeenCalled();
  });
  it('refuses an unsafe expected scope and an activating worker', async () => {
    const unsafe = harness({ scope: 'https://external.example/DayPop/' });
    await expect(unsafe.device.prepare(READY)).rejects.toMatchObject({ kind: 'worker' });
    const h = harness(); h.worker.state = 'activating'; await expect(h.device.prepare(READY)).rejects.toMatchObject({ kind: 'worker' });
  });
  it.each([null, [], { type: 'REMINDER_CAPABILITIES', v: 2 }, { type: 'REMINDER_CAPABILITIES', v: 1, secret: 'PRIVATE' }].map(value => [value]))('rejects malformed worker handshakes %j', async data => {
      const h = harness(); h.setReply(true, data); await expect(h.device.prepare(READY)).rejects.toMatchObject({ kind: 'worker' });
      expect(h.request).not.toHaveBeenCalled();
    });
  it('times out an old worker and closes both message ports', async () => {
    vi.useFakeTimers(); const h = harness(); h.setReply(false);
    const rejected = expect(h.device.prepare(READY)).rejects.toMatchObject({ kind: 'worker' });
    await vi.advanceTimersByTimeAsync(1501); await rejected;
    expect(h.channels[0]!.port1.close).toHaveBeenCalledOnce(); expect(h.channels[0]!.port2.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0); expect(h.subscribe).not.toHaveBeenCalled();
  });
  it('invalidates a preflight when its worker or identity changes', async () => {
    const h = harness(); h.setReply(false); const pending = h.device.prepare(READY);
    const rejected = expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
    await vi.waitFor(() => expect(h.channels).toHaveLength(1)); h.device.invalidate(); h.respond(); await rejected;
    await expect(h.device.subscribe()).rejects.toMatchObject({ kind: 'worker' }); expect(h.request).not.toHaveBeenCalled();
  });
  it('counts preflight age from its start, including a slow subscription read', async () => {
    const h = harness(); h.get.mockImplementationOnce(async () => { h.setTime(31_001); return null; });
    await expect(h.device.prepare(READY)).rejects.toMatchObject({ kind: 'worker' }); expect(h.request).not.toHaveBeenCalled();
  });
  it('requests permission synchronously in the trusted action and returns only transient RPC input', async () => {
    const h = harness(); await h.device.prepare(READY); const pending = h.device.subscribe();
    expect(h.request).toHaveBeenCalledOnce(); // Before any awaited continuation.
    expect(await pending).toEqual({ endpoint: ENDPOINT, p256dh: KEY, auth: 'A'.repeat(22), publicKey: KEY });
    expect(h.subscribe).toHaveBeenCalledExactlyOnceWith({ userVisibleOnly: true, applicationServerKey: publicBytes });
    await expect(h.device.subscribe()).rejects.toMatchObject({ kind: 'worker' }); expect(h.request).toHaveBeenCalledOnce();
  });
  it.each(['expired', 'clock-back', 'worker', 'gesture', 'invalidated'] as const)('requires fresh prepared consent: %s', async change => {
    const h = harness(); await h.device.prepare(READY);
    if (change === 'expired') h.setTime(31_001);
    if (change === 'clock-back') h.setTime(999);
    if (change === 'worker') h.registration.active = { ...h.worker };
    if (change === 'gesture') h.setActivation(false);
    if (change === 'invalidated') h.device.invalidate();
    await expect(h.device.subscribe()).rejects.toBeInstanceOf(BrowserReminderError); expect(h.request).not.toHaveBeenCalled(); expect(h.subscribe).not.toHaveBeenCalled();
  });
  it('does not reprompt denied permission or subscribe after dismissing a prompt', async () => {
    const h = harness(); h.setPermission('denied'); await h.device.prepare(READY);
    await expect(h.device.subscribe()).rejects.toMatchObject({ kind: 'permission' }); expect(h.request).not.toHaveBeenCalled();
    h.setPermission('default'); await h.device.prepare(READY); h.request.mockResolvedValueOnce('default');
    await expect(h.device.subscribe()).rejects.toMatchObject({ kind: 'permission' }); expect(h.subscribe).not.toHaveBeenCalled();
  });
  it('reuses a matching subscription after explicit consent without replacing it', async () => {
    const h = harness(); h.setCurrent(h.created); h.setPermission('granted');
    expect((await h.device.prepare(READY)).subscription).toBe('matching');
    expect((await h.device.subscribe()).endpoint).toBe(ENDPOINT); expect(h.request).not.toHaveBeenCalled(); expect(h.subscribe).not.toHaveBeenCalled(); expect(h.created.unsubscribe).not.toHaveBeenCalled();
  });
  it('never rotates or removes an existing mismatched subscription implicitly', async () => {
    const h = harness(), existing = h.subscription({ options: { applicationServerKey: new Uint8Array(65).buffer, userVisibleOnly: true } }); h.setCurrent(existing);
    expect((await h.device.prepare(READY)).subscription).toBe('different');
    await expect(h.device.subscribe()).rejects.toMatchObject({ kind: 'subscription' }); expect(h.request).not.toHaveBeenCalled(); expect(existing.unsubscribe).not.toHaveBeenCalled();
  });
  it.each(['endpoint', 'key', 'auth', 'point'] as const)('removes a newly created malformed capability: %s', async broken => {
    const h = harness(); let value = h.created;
    if (broken === 'endpoint') value = h.subscription({ endpoint: 'https://external.example/private' });
    if (broken === 'key') value = h.subscription({ options: { applicationServerKey: null, userVisibleOnly: true } });
    if (broken === 'auth') value = h.subscription({ getKey: () => null });
    if (broken === 'point') { const bad = publicBytes.slice(); bad[0] = 5; value = h.subscription({ getKey: name => name === 'p256dh' ? bad.buffer : new Uint8Array(16).buffer }); }
    h.subscribe.mockImplementationOnce(async () => { h.setCurrent(value); return value; }); await h.device.prepare(READY);
    await expect(h.device.subscribe()).rejects.toMatchObject({ kind: 'subscription' }); expect(value.unsubscribe).toHaveBeenCalledOnce(); expect(await h.get()).toBeNull();
  });
  it('cancels a prompt without creating a subscription', async () => {
    const h = harness(), permission = deferred<NotificationPermission>(); h.request.mockReturnValueOnce(permission.promise);
    await h.device.prepare(READY); const pending = h.device.subscribe(); const rejected = expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
    h.device.invalidate(); permission.resolve('granted'); await rejected; expect(h.subscribe).not.toHaveBeenCalled();
  });
  it('cannot prepare or open another prompt while consent is pending', async () => {
    const h = harness(), permission = deferred<NotificationPermission>(); h.request.mockReturnValueOnce(permission.promise);
    await h.device.prepare(READY); const pending = h.device.subscribe();
    await expect(h.device.prepare(READY)).rejects.toMatchObject({ kind: 'busy' });
    await expect(h.device.subscribe()).rejects.toMatchObject({ kind: 'worker' }); expect(h.request).toHaveBeenCalledOnce();
    permission.resolve('default'); await expect(pending).rejects.toMatchObject({ kind: 'permission' });
  });
  it('treats a verified absence of a registration as locally unsubscribed', async () => {
    const h = harness(); vi.mocked(h.browser.registration).mockResolvedValueOnce(null);
    await h.device.unsubscribe(); expect(h.subscribe).not.toHaveBeenCalled(); expect(h.request).not.toHaveBeenCalled();
  });
  it('waits for a late-created subscription to be removed before reporting unsubscribe complete', async () => {
    const h = harness(), creating = deferred<PushSubscription>(); h.subscribe.mockReturnValueOnce(creating.promise);
    await h.device.prepare(READY); const pending = h.device.subscribe(); const rejected = expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
    await vi.waitFor(() => expect(h.subscribe).toHaveBeenCalledOnce()); let removed = false;
    const removal = h.device.unsubscribe().then(() => { removed = true; }); await Promise.resolve(); expect(removed).toBe(false);
    h.setCurrent(h.created); creating.resolve(h.created); await rejected; await removal;
    expect(h.created.unsubscribe).toHaveBeenCalledOnce(); expect(await h.get()).toBeNull();
  });
  it('reports unconfirmed removal even if unsubscribe says true', async () => {
    const h = harness(); h.setCurrent(h.created); vi.mocked(h.created.unsubscribe).mockResolvedValue(true);
    await expect(h.device.unsubscribe()).rejects.toMatchObject({ kind: 'cleanup' });
  });
  it('accepts independently confirmed absence after unsubscribe says false or throws', async () => {
    for (const throws of [true, false]) {
      const h = harness(); h.setCurrent(h.created); vi.mocked(h.created.unsubscribe).mockImplementation(async () => {
        h.setCurrent(null); if (throws) throw new Error('PRIVATE'); return false;
      }); await h.device.unsubscribe();
    }
  });
  it('can remove an old subscription without a new handshake, installation or permission', async () => {
    const h = harness({ ios: true, standalone: false }); h.setPermission('denied'); h.setCurrent(h.created); h.setReply(false);
    await h.device.unsubscribe(); expect(h.created.unsubscribe).toHaveBeenCalledOnce(); expect(h.worker.postMessage).not.toHaveBeenCalled(); expect(h.request).not.toHaveBeenCalled();
  });
  it('does not leak browser/provider errors or capability text', async () => {
    const h = harness(), logs = vi.spyOn(console, 'error'); await h.device.prepare(READY);
    h.subscribe.mockRejectedValueOnce(new Error('PRIVATE '+ENDPOINT));
    const error = await h.device.subscribe().catch(error => error);
    expect(error).toBeInstanceOf(BrowserReminderError); expect(error.message).not.toContain(ENDPOINT); expect(error.cause).toBeUndefined(); expect(logs).not.toHaveBeenCalled();
  });
});
