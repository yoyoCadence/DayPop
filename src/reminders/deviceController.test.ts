import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStorage, MemoryStorage } from '../storage/browserStorage';
import { BrowserReminderError } from './browserPush';
import { ReminderDeviceRecords } from './deviceRecords';
import { ReminderDeviceController } from './deviceController';
import { ReminderError, type RegisteredReminderDevice, type ReminderService, type ReminderSnapshot } from './reminderService';

const SCOPE = 'https://app.example/DayPop/', A = '00000000-0000-4000-8000-000000000230', B = '00000000-0000-4000-8000-000000000231';
const DEVICE = '00000000-0000-4000-8000-000000000232', OTHER = '00000000-0000-4000-8000-000000000233';
const KEY = 'B' + 'A'.repeat(86), NOW = '2026-11-01T01:00:00.000Z';
const input = { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-controller', p256dh: KEY, auth: 'A'.repeat(22), publicKey: KEY };
const fingerprint = createHash('sha256').update('daypop-push-v1\0' + SCOPE + '\0' + input.endpoint).digest('hex');
const nativeIdentity = { fingerprint, publicKey: KEY };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function setup() {
  let sequence = 1, native: typeof nativeIdentity | null = null;
  const raw = new MemoryStorage(), storage = new AppStorage(raw);
  raw.setItem('daypop.user-data', 'original-v4-bytes');
  const records = new ReminderDeviceRecords(SCOPE, storage, () => '00000000-0000-4000-8000-' + String(sequence++).padStart(12, '0'));
  const snapshot: ReminderSnapshot = { capabilities: { enabled: true, publicKey: KEY, lastTick: NOW }, rules: [], devices: [] };
  const remove = vi.fn(async () => { snapshot.devices = snapshot.devices.filter(row => row.id !== DEVICE); });
  const service = {
    capabilities: vi.fn(async () => snapshot.capabilities), load: vi.fn(async () => structuredClone(snapshot)), setRule: vi.fn(),
    registerDevice: vi.fn(), registerDeviceLease: vi.fn<ReminderService['registerDeviceLease']>(async () => {
      snapshot.devices = [{ id: DEVICE, createdAt: NOW, updatedAt: NOW }]; return { id: DEVICE, remove };
    }), unregisterDevice: vi.fn(), captureDeviceRemoval: vi.fn(async () => remove),
  } satisfies ReminderService;
  const browser = {
    prepare: vi.fn(async () => ({ permission: 'default' as NotificationPermission, subscription: 'none' as 'none' | 'matching' | 'different' })),
    subscribe: vi.fn(async () => { native = nativeIdentity; return input; }),
    identity: vi.fn(async () => native), unsubscribe: vi.fn(async () => { native = null; }), invalidate: vi.fn(),
  };
  const controller = new ReminderDeviceController(SCOPE, browser, records);
  const account = { kind: 'account' as const, userId: A, service };
  const seed = (owner = A, deviceId: string | null = DEVICE, phase: 'active' | 'unconfirmed' = 'active') => {
    const record = records.create(owner, KEY); native = nativeIdentity;
    if (deviceId) snapshot.devices = [{ id: deviceId, createdAt: NOW, updatedAt: NOW }];
    return records.update(record, { fingerprint, deviceId, phase });
  };
  return { raw, storage, records, snapshot, remove, service, browser, controller, account, seed, setNative: (value: typeof nativeIdentity | null) => { native = value; } };
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('reminder device coordinator (DP-230)', () => {
  it('keeps startup unconfirmed and guest read-only, without prompting or registering', async () => {
    process.stdout.write('DP-230 actual timezone: ' + Intl.DateTimeFormat().resolvedOptions().timeZone + '\n');
    const h = setup(); expect(h.controller.getSnapshot().phase).toBe('waiting');
    await h.controller.setIdentity({ kind: 'waiting' }); expect(h.browser.unsubscribe).not.toHaveBeenCalled();
    await h.controller.setIdentity({ kind: 'guest' }); expect(await h.controller.enable()).toBe(false);
    expect(h.controller.getSnapshot()).toMatchObject({ phase: 'guest', userId: null, snapshot: null });
    expect(h.browser.subscribe).not.toHaveBeenCalled(); expect(h.service.load).not.toHaveBeenCalled(); expect(h.service.registerDeviceLease).not.toHaveBeenCalled();
  });
  it('preflights without consent and persists a marker synchronously before the gesture-bound subscription call', async () => {
    const h = setup(); await h.controller.setIdentity(h.account);
    expect(h.controller.getSnapshot()).toMatchObject({ phase: 'ready', canEnable: true });
    expect(h.browser.subscribe).not.toHaveBeenCalled(); expect(h.service.registerDeviceLease).not.toHaveBeenCalled();
    h.browser.subscribe.mockImplementation(async () => {
      expect(h.records.read().records).toMatchObject([{ userId: A, phase: 'registering', deviceId: null }]);
      h.setNative(nativeIdentity); return input;
    });
    const operation = h.controller.enable(); expect(h.browser.subscribe).toHaveBeenCalledTimes(1);
    expect(h.service.registerDeviceLease).not.toHaveBeenCalled(); expect(await operation).toBe(true);
    expect(h.controller.getSnapshot()).toMatchObject({ phase: 'active', deviceId: DEVICE, canEnable: false });
    expect(h.records.read().records).toMatchObject([{ userId: A, phase: 'active', deviceId: DEVICE, fingerprint }]);
    const persisted = JSON.stringify(h.records.read()); expect(persisted).not.toContain(input.endpoint); expect(persisted).not.toContain('p256dh');
    expect(h.raw.getItem('daypop.user-data')).toBe('original-v4-bytes');
  });
  it.each(['disabled', 'missing', 'unsupported', 'denied', 'different'])('cannot enable after %s preflight', async fault => {
    const h = setup();
    if (fault === 'disabled') h.snapshot.capabilities.enabled = false;
    if (fault === 'missing') h.service.load.mockRejectedValue(new ReminderError('unavailable', '尚未啟用'));
    if (fault === 'unsupported') h.browser.prepare.mockRejectedValue(new BrowserReminderError('install', '請安裝 App'));
    if (fault === 'denied') h.browser.prepare.mockResolvedValue({ permission: 'denied', subscription: 'none' });
    if (fault === 'different') h.browser.prepare.mockResolvedValue({ permission: 'granted', subscription: 'different' });
    await h.controller.setIdentity(h.account); expect(await h.controller.enable()).toBe(false);
    expect(h.browser.subscribe).not.toHaveBeenCalled(); expect(h.service.registerDeviceLease).not.toHaveBeenCalled();
  });
  it.each(['future', 'corrupt', 'quota'])('refuses %s persistence before invoking the permission flow and preserves old bytes', async fault => {
    const h = setup(); await h.controller.setIdentity(h.account);
    if (fault === 'quota') vi.spyOn(h.raw, 'setItem').mockImplementation(() => { throw new DOMException('private quota', 'QuotaExceededError'); });
    else h.raw.setItem(h.records.prefix + '00000000-0000-4000-8000-000000000234', fault === 'future' ? '{"version":2}' : 'broken');
    expect(await h.controller.enable()).toBe(false); expect(h.browser.subscribe).not.toHaveBeenCalled();
    expect(h.raw.getItem('daypop.user-data')).toBe('original-v4-bytes');
    if (fault !== 'quota') expect(h.raw.getItem(h.records.prefix + '00000000-0000-4000-8000-000000000234')).toBe(fault === 'future' ? '{"version":2}' : 'broken');
  });
  it('recovers a matching active receipt without new permission, subscription or registration', async () => {
    const h = setup(); h.seed(); await h.controller.setIdentity(h.account);
    expect(h.controller.getSnapshot()).toMatchObject({ phase: 'active', deviceId: DEVICE });
    expect(h.service.captureDeviceRemoval).toHaveBeenCalledWith(DEVICE); expect(h.browser.prepare).not.toHaveBeenCalled();
    expect(h.browser.subscribe).not.toHaveBeenCalled(); expect(h.service.registerDeviceLease).not.toHaveBeenCalled();
  });
  it('preserves active notifications across observer disposal and ordinary backgrounding', async () => {
    const h = setup(); h.seed(); await h.controller.setIdentity(h.account);
    h.controller.invalidatePreflight(); h.controller.dispose();
    expect(h.browser.unsubscribe).not.toHaveBeenCalled(); expect(h.remove).not.toHaveBeenCalled(); expect(h.records.read().records[0]?.phase).toBe('active');
  });
  it('does not revoke for same-account token refresh or temporarily waiting Auth', async () => {
    const h = setup(); h.seed(); await h.controller.setIdentity(h.account);
    await h.controller.setIdentity({ ...h.account }); await h.controller.setIdentity({ kind: 'waiting' });
    expect(h.browser.unsubscribe).not.toHaveBeenCalled(); expect(h.remove).not.toHaveBeenCalled();
    await h.controller.setIdentity(h.account); expect(h.controller.getSnapshot().phase).toBe('active');
  });
  it.each(['guest', 'account'] as const)('revokes only A using the captured remover when switching to %s, including through waiting', async kind => {
    const h = setup(); h.seed(); await h.controller.setIdentity(h.account); await h.controller.setIdentity({ kind: 'waiting' });
    const b = setup();
    await h.controller.setIdentity(kind === 'guest' ? { kind } : { kind, userId: B, service: b.service });
    expect(h.remove).toHaveBeenCalledTimes(1); expect(b.service.captureDeviceRemoval).not.toHaveBeenCalled();
    expect(h.records.read().records).toEqual([]); expect(h.browser.unsubscribe).toHaveBeenCalled();
    expect(h.controller.getSnapshot()).toMatchObject({ userId: kind === 'guest' ? null : B, deviceId: null });
  });
  it('retains a pending receipt and warns when remote revocation fails even after local removal', async () => {
    const h = setup(); h.seed(); await h.controller.setIdentity(h.account); h.remove.mockRejectedValue(new Error('private remote failure'));
    expect(await h.controller.disable()).toBe(false);
    expect(h.controller.getSnapshot()).toMatchObject({ phase: 'unconfirmed', deviceId: null, pendingCount: 1 });
    expect(h.records.read().records[0]?.phase).toBe('unconfirmed'); await expect(h.browser.identity()).resolves.toBeNull();
    expect(h.controller.getSnapshot().error).not.toContain('private');
  });
  it('keeps the cleanup warning visible after confirmed sign-out instead of replacing it with ordinary guest state', async () => {
    const h = setup(); h.seed(); await h.controller.setIdentity(h.account); h.remove.mockRejectedValue(new Error('private'));
    await h.controller.setIdentity({ kind: 'guest' });
    expect(h.controller.getSnapshot()).toMatchObject({ phase: 'unconfirmed', userId: null, snapshot: null, canEnable: false, pendingCount: 1 });
    expect(h.controller.getSnapshot().error).toBeTruthy(); await h.controller.refresh(); expect(h.controller.getSnapshot().phase).toBe('unconfirmed');
  });
  it('retains known ids and never claims active after receipt persistence fails following registration', async () => {
    const h = setup(); await h.controller.setIdentity(h.account);
    h.service.registerDeviceLease.mockImplementationOnce(async () => {
      vi.spyOn(h.raw, 'setItem').mockImplementation(() => { throw new DOMException('private quota', 'QuotaExceededError'); });
      return { id: DEVICE, remove: h.remove };
    });
    expect(await h.controller.enable()).toBe(false); expect(h.remove).toHaveBeenCalledTimes(1);
    expect(h.controller.getSnapshot()).toMatchObject({ phase: 'unconfirmed', canEnable: false });
    expect(h.storage.mode.kind).toBe('memory'); expect(h.records.read().status).toBe('unavailable');
    expect(h.raw.getItem('daypop.user-data')).toBe('original-v4-bytes');
  });
  it('cleans synchronous subscription errors without leaving a fresh registering marker', async () => {
    const h = setup(); await h.controller.setIdentity(h.account);
    h.browser.subscribe.mockImplementation(() => { throw new Error('private browser error'); });
    expect(await h.controller.enable()).toBe(false); expect(h.records.read().records).toEqual([]);
    expect(h.service.registerDeviceLease).not.toHaveBeenCalled(); expect(h.controller.getSnapshot().error).not.toContain('private');
  });
  it('requires local absence as well as server absence before confirming disable', async () => {
    const h = setup(); h.seed(); await h.controller.setIdentity(h.account);
    h.browser.unsubscribe.mockRejectedValue(new BrowserReminderError('cleanup', '尚未停用'));
    expect(await h.controller.disable()).toBe(false); expect(h.records.read().records).toHaveLength(1);
    expect(h.snapshot.devices).toEqual([]); expect(h.controller.getSnapshot().phase).toBe('unconfirmed');
  });
  it('removes the local receipt only after both sides confirm disable', async () => {
    const h = setup(); h.seed(); await h.controller.setIdentity(h.account);
    expect(await h.controller.disable()).toBe(true); expect(h.records.read().records).toEqual([]);
    expect(h.snapshot.devices).toEqual([]); expect(h.controller.getSnapshot()).toMatchObject({ phase: 'ready', deviceId: null });
  });
  it('cleans a late lease with its A-scoped remover and never updates B with an A device', async () => {
    const h = setup(), pending = deferred<RegisteredReminderDevice>(), b = setup();
    h.service.registerDeviceLease.mockReturnValue(pending.promise); await h.controller.setIdentity(h.account);
    const operation = h.controller.enable(); await vi.waitFor(() => expect(h.service.registerDeviceLease).toHaveBeenCalled());
    await h.controller.setIdentity({ kind: 'account', userId: B, service: b.service });
    pending.resolve({ id: DEVICE, remove: h.remove }); expect(await operation).toBe(false);
    await vi.waitFor(() => expect(h.records.read().records).toEqual([])); expect(h.remove).toHaveBeenCalledTimes(1);
    expect(h.controller.getSnapshot()).toMatchObject({ userId: B, deviceId: null }); expect(b.service.registerDeviceLease).not.toHaveBeenCalled();
  });
  it('leaves unknown registration outcomes explicit and allows only a user-triggered same-account retry', async () => {
    const h = setup(); h.service.registerDeviceLease.mockRejectedValueOnce(new ReminderError('failed', '連線中斷'));
    await h.controller.setIdentity(h.account); expect(await h.controller.enable()).toBe(false);
    await vi.waitFor(() => expect(h.controller.getSnapshot().canEnable).toBe(true));
    expect(h.records.read().records).toMatchObject([{ phase: 'unconfirmed', fingerprint, deviceId: null }]);
    expect(h.browser.unsubscribe).not.toHaveBeenCalled(); expect(h.service.registerDeviceLease).toHaveBeenCalledTimes(1);
    expect(await h.controller.enable()).toBe(true); expect(h.service.registerDeviceLease).toHaveBeenCalledTimes(2);
    expect(h.records.read().records).toHaveLength(1); expect(h.records.read().records[0]?.phase).toBe('active');
  });
  it('recovers interrupted registering after a cold restart only by explicit same-account matching-subscription retry', async () => {
    const h = setup(), marker = h.records.create(A, KEY);
    h.records.update(marker, { fingerprint }); h.setNative(nativeIdentity);
    h.snapshot.devices = [{ id: DEVICE, createdAt: NOW, updatedAt: NOW }]; // The RPC committed before the App closed.
    await h.controller.setIdentity(h.account);
    expect(h.controller.getSnapshot()).toMatchObject({ phase: 'unconfirmed', canEnable: true, deviceId: null });
    expect(h.service.registerDeviceLease).not.toHaveBeenCalled(); expect(h.browser.unsubscribe).not.toHaveBeenCalled();
    expect(await h.controller.enable()).toBe(true); expect(h.service.registerDeviceLease).toHaveBeenCalledTimes(1);
    expect(h.records.read().records).toHaveLength(1);
    expect(h.records.read().records[0]).toMatchObject({ operationId: marker.operationId, phase: 'active', deviceId: DEVICE, fingerprint });
  });
  it.each(['foreign', 'different', 'no-fingerprint'] as const)('does not retry interrupted registering with %s identity', async fault => {
    const h = setup(), marker = h.records.create(fault === 'foreign' ? B : A, KEY);
    if (fault !== 'no-fingerprint') h.records.update(marker, { fingerprint: fault === 'different' ? 'b'.repeat(64) : fingerprint });
    h.setNative(nativeIdentity); await h.controller.setIdentity(h.account);
    expect(h.controller.getSnapshot().canEnable).toBe(false); expect(await h.controller.enable()).toBe(false);
    expect(h.service.registerDeviceLease).not.toHaveBeenCalled(); expect(h.records.read().records).toHaveLength(1);
  });
  it('blocks overlapping enable, times out explicitly, and cleans a still-pending late registration', async () => {
    const h = setup(), pending = deferred<RegisteredReminderDevice>(); h.service.registerDeviceLease.mockReturnValue(pending.promise);
    await h.controller.setIdentity(h.account); vi.useFakeTimers(); const operation = h.controller.enable();
    await vi.waitFor(() => expect(h.service.registerDeviceLease).toHaveBeenCalled());
    expect(await h.controller.enable()).toBe(false); await vi.advanceTimersByTimeAsync(8001); expect(await operation).toBe(false);
    expect(h.records.read().records[0]?.phase).toBe('unconfirmed'); expect(await h.controller.enable()).toBe(false);
    pending.resolve({ id: DEVICE, remove: h.remove }); await vi.advanceTimersByTimeAsync(0);
    expect(h.remove).toHaveBeenCalledTimes(1); expect(h.records.read().records).toEqual([]);
  });
  it('blocks new consent while a timed-out native removal is still pending, including after account switch', async () => {
    const h = setup(), pending = deferred<void>(), b = setup(); h.seed(); await h.controller.setIdentity(h.account);
    h.browser.unsubscribe.mockReturnValue(pending.promise); vi.useFakeTimers();
    const change = h.controller.setIdentity({ kind: 'account', userId: B, service: b.service });
    await vi.advanceTimersByTimeAsync(5001); await change;
    await h.controller.refresh(); expect(h.controller.getSnapshot()).toMatchObject({ phase: 'unconfirmed', canEnable: false });
    expect(await h.controller.enable()).toBe(false); expect(h.browser.subscribe).not.toHaveBeenCalled();
    h.setNative(null); pending.resolve(); await vi.advanceTimersByTimeAsync(0);
  });
  it('preserves an unknown receipt on denied retry but removes a fresh failed attempt after local absence', async () => {
    const h = setup(); await h.controller.setIdentity(h.account); h.browser.subscribe.mockRejectedValue(new BrowserReminderError('permission', '未授權'));
    expect(await h.controller.enable()).toBe(false); expect(h.records.read().records).toEqual([]);
    await vi.waitFor(() => expect(h.controller.getSnapshot().canEnable).toBe(true));
    h.seed(A, null, 'unconfirmed'); await h.controller.refresh(); expect(await h.controller.enable()).toBe(false);
    expect(h.records.read().records).toHaveLength(1); expect(h.service.registerDeviceLease).not.toHaveBeenCalled();
  });
  it('accepts independent confirmed compensation but retains unknown server failures', async () => {
    const h = setup(); await h.controller.setIdentity(h.account);
    h.service.registerDeviceLease.mockRejectedValue(new ReminderError('session', '帳號已變更', undefined, DEVICE));
    expect(await h.controller.enable()).toBe(false); expect(h.records.read().records).toEqual([]); expect(h.browser.unsubscribe).toHaveBeenCalled();
  });
  it('does not guess a lost device id or remove other devices, even during explicit disable', async () => {
    const h = setup(); h.seed(A, null, 'unconfirmed'); h.snapshot.devices = [{ id: OTHER, createdAt: NOW, updatedAt: NOW }];
    await h.controller.setIdentity(h.account); expect(await h.controller.disable()).toBe(false);
    expect(h.service.captureDeviceRemoval).not.toHaveBeenCalled(); expect(h.snapshot.devices[0]?.id).toBe(OTHER); expect(h.records.read().records).toHaveLength(1);
  });
  it('can clear an unknown receipt only with explicit local absence and an independently empty account device list', async () => {
    const h = setup(); h.seed(A, null, 'unconfirmed'); await h.controller.setIdentity(h.account);
    expect(await h.controller.disable()).toBe(true); expect(h.records.read().records).toEqual([]);
  });
  it.each([false, true])('clears an interrupted pre-registration receipt after local absence, preserving unrelated remote devices (native %s)', async native => {
    const h = setup(); h.records.create(A, KEY);
    h.snapshot.devices = [{ id: OTHER, createdAt: NOW, updatedAt: NOW }];
    if (native) h.setNative(nativeIdentity);
    await h.controller.setIdentity(h.account);
    expect(h.controller.getSnapshot().canEnable).toBe(false); expect(h.service.registerDeviceLease).not.toHaveBeenCalled();
    expect(await h.controller.disable()).toBe(true); expect(h.records.read().records).toEqual([]);
    expect(h.snapshot.devices.map(row => row.id)).toEqual([OTHER]); expect(h.service.captureDeviceRemoval).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().canEnable).toBe(true);
  });
  it('retains an interrupted pre-registration receipt when local removal is unconfirmed', async () => {
    const h = setup(); h.records.create(A, KEY); await h.controller.setIdentity(h.account);
    h.browser.unsubscribe.mockRejectedValue(new BrowserReminderError('cleanup', '尚未停用'));
    expect(await h.controller.disable()).toBe(false); expect(h.records.read().records).toHaveLength(1);
    expect(h.controller.getSnapshot().phase).toBe('unconfirmed');
  });
  it('clears only never-sent receipts while retaining an unknown sent operation and every unrelated remote device', async () => {
    const h = setup(); h.records.create(A, KEY); const sent = h.seed(A, null, 'unconfirmed');
    h.snapshot.devices = [{ id: OTHER, createdAt: NOW, updatedAt: NOW }]; await h.controller.setIdentity(h.account);
    expect(await h.controller.disable()).toBe(false); expect(h.records.read().records).toHaveLength(1);
    expect(h.records.read().records[0]?.operationId).toBe(sent.operationId); expect(h.snapshot.devices.map(row => row.id)).toEqual([OTHER]);
    expect(h.service.captureDeviceRemoval).not.toHaveBeenCalled();
  });
  it('never clears an interrupted pre-registration receipt across a future-data barrier', async () => {
    const h = setup(), marker = h.records.create(A, KEY), bytes = h.raw.getItem(h.records.prefix + marker.operationId);
    const futureKey = h.records.prefix + '00000000-0000-4000-8000-000000000234'; h.raw.setItem(futureKey, '{"version":2}');
    await h.controller.setIdentity(h.account); expect(await h.controller.disable()).toBe(false);
    expect(h.raw.getItem(h.records.prefix + marker.operationId)).toBe(bytes); expect(h.raw.getItem(futureKey)).toBe('{"version":2}');
  });
  it('does not reuse a stale never-sent proof after another context has saved a fingerprint', async () => {
    const h = setup(), marker = h.records.create(A, KEY); h.snapshot.devices = [{ id: OTHER, createdAt: NOW, updatedAt: NOW }];
    await h.controller.setIdentity(h.account);
    h.browser.unsubscribe.mockImplementationOnce(async () => { h.records.update(marker, { fingerprint, phase: 'unconfirmed' }); h.setNative(null); });
    expect(await h.controller.disable()).toBe(false); expect(h.records.read().records).toHaveLength(1);
    expect(h.records.read().records[0]?.fingerprint).toBe(fingerprint); expect(h.snapshot.devices.map(row => row.id)).toEqual([OTHER]);
  });
  it('never silently adopts a foreign or untracked native subscription after cold-start login', async () => {
    const h = setup(); h.seed(B); h.snapshot.devices = []; await h.controller.setIdentity(h.account);
    expect(h.browser.unsubscribe).toHaveBeenCalledTimes(1); expect(h.service.registerDeviceLease).not.toHaveBeenCalled();
    expect(h.records.read().records[0]?.userId).toBe(B); expect(h.controller.getSnapshot()).toMatchObject({ phase: 'unconfirmed', pendingCount: 1, canEnable: false });
  });
  it('invalidates unused preflight without treating an OS prompt background event as cancellation', async () => {
    const h = setup(); await h.controller.setIdentity(h.account); h.controller.invalidatePreflight();
    expect(await h.controller.enable()).toBe(false); await h.controller.refresh();
    const permission = deferred<typeof input>(); h.browser.subscribe.mockReturnValue(permission.promise);
    const operation = h.controller.enable(); h.controller.invalidatePreflight(); permission.resolve(input);
    expect(await operation).toBe(true); expect(h.remove).not.toHaveBeenCalled();
  });
  it('does not register cancelled consent after explicit disable while the browser prompt is pending', async () => {
    const h = setup(), permission = deferred<typeof input>(); await h.controller.setIdentity(h.account);
    h.browser.subscribe.mockReturnValue(permission.promise); const operation = h.controller.enable();
    await h.controller.disable(); permission.resolve(input); expect(await operation).toBe(false);
    expect(h.service.registerDeviceLease).not.toHaveBeenCalled(); expect(h.records.read().records).toEqual([]);
  });
  it('discards an obsolete preflight and rechecks future data written during metadata loading', async () => {
    const h = setup(), first = deferred<ReminderSnapshot>(); h.service.load.mockReturnValueOnce(first.promise);
    const old = h.controller.setIdentity(h.account); await h.controller.setIdentity({ kind: 'guest' });
    first.resolve(h.snapshot); await old; expect(h.controller.getSnapshot().phase).toBe('guest'); expect(h.browser.prepare).not.toHaveBeenCalled();
    h.service.load.mockImplementationOnce(async () => { h.raw.setItem(h.records.prefix + '00000000-0000-4000-8000-000000000234', '{"version":2}'); return h.snapshot; });
    await h.controller.setIdentity(h.account); expect(h.controller.getSnapshot()).toMatchObject({ phase: 'unconfirmed', canEnable: false });
    expect(h.browser.prepare).not.toHaveBeenCalled();
  });
});
