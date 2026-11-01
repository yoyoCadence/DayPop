import { createHash, webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppStorage, MemoryStorage } from '../storage/browserStorage';
import { DeviceRecordsError, ReminderDeviceRecords } from './deviceRecords';
import { reminderDeviceFingerprint } from './deviceFingerprint';

const SCOPE = 'https://app.example/DayPop/', OTHER_SCOPE = 'https://app.example/other/';
const A = '00000000-0000-4000-8000-000000000229', B = '00000000-0000-4000-8000-000000000230';
const DEVICE = '00000000-0000-4000-8000-000000000231', KEY = 'B' + 'A'.repeat(86), FINGERPRINT = 'a'.repeat(64);
let sequence = 1;
const nextId = () => '00000000-0000-4000-8000-' + String(sequence++).padStart(12, '0');
function setup() {
  const raw = new MemoryStorage(), storage = new AppStorage(raw), store = new ReminderDeviceRecords(SCOPE, storage, nextId);
  raw.setItem('daypop.user-data', 'existing v4 bytes'); raw.setItem('calpet.v2', 'legacy bytes');
  return { raw, storage, store };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('scope-local device receipts (DP-229)', () => {
  it('stores only safe fields in independent operation keys, preserving personal and other-scope bytes', () => {
    process.stdout.write('DP-229 actual timezone: ' + Intl.DateTimeFormat().resolvedOptions().timeZone + '\n');
    const { raw, storage, store } = setup(), other = new ReminderDeviceRecords(OTHER_SCOPE, storage, nextId);
    const unrelated = other.create(B, KEY), a = store.create(A, KEY), b = store.create(B, KEY);
    expect(a.operationId).not.toBe(b.operationId); expect(store.read().records).toEqual([a, b]);
    expect(Object.keys(JSON.parse(raw.getItem(store.prefix + a.operationId)!)).sort()).toEqual([
      'deviceId', 'fingerprint', 'operationId', 'phase', 'publicKey', 'revision', 'scope', 'userId', 'version',
    ]);
    const identified = store.update(a, { fingerprint: FINGERPRINT });
    const active = store.update(identified, { deviceId: DEVICE, phase: 'active' });
    const pending = store.update(active, { phase: 'removing' }); store.remove(pending);
    expect(store.read().records).toEqual([b]); expect(other.read().records).toEqual([unrelated]);
    expect(raw.getItem('daypop.user-data')).toBe('existing v4 bytes'); expect(raw.getItem('calpet.v2')).toBe('legacy bytes');
  });
  it('refuses stale writes/removal without changing any receipt', () => {
    const { raw, store } = setup(), record = store.create(A, KEY), current = store.update(record, { phase: 'unconfirmed' });
    const bytes = raw.getItem(store.prefix + record.operationId);
    expect(() => store.update(record, { fingerprint: FINGERPRINT })).toThrow(DeviceRecordsError);
    expect(() => store.remove(record)).toThrow(DeviceRecordsError);
    expect(raw.getItem(store.prefix + record.operationId)).toBe(bytes); expect(store.read().records).toEqual([current]);
  });
  it('never replaces an existing operation after an id collision', () => {
    const { raw, storage, store } = setup(), record = store.create(A, KEY), bytes = raw.getItem(store.prefix + record.operationId);
    const collision = new ReminderDeviceRecords(SCOPE, storage, () => record.operationId);
    expect(() => collision.create(B, KEY)).toThrow(DeviceRecordsError); expect(raw.getItem(store.prefix + record.operationId)).toBe(bytes);
  });
  it.each(['bad-json', JSON.stringify({ version: 2, secret: 'PRIVATE' })])('preserves corrupt/future bytes and refuses all writes %#', bytes => {
    const { raw, store } = setup(), record = store.create(A, KEY), key = store.prefix + nextId(); raw.setItem(key, bytes);
    expect(store.read().status).toBe(bytes === 'bad-json' ? 'corrupt' : 'future');
    expect(() => store.create(B, KEY)).toThrow(DeviceRecordsError); expect(() => store.update(record, { phase: 'unconfirmed' })).toThrow(DeviceRecordsError);
    expect(() => store.remove(record)).toThrow(DeviceRecordsError); expect(raw.getItem(key)).toBe(bytes);
  });
  it.each(['secret', 'scope', 'owner', 'id-newline', 'revision', 'operation', 'active', 'fingerprint', 'oversized'] as const)('rejects inconsistent stored data: %s', fault => {
    const { raw, store } = setup(), record = store.create(A, KEY), key = store.prefix + record.operationId;
    const value: Record<string, unknown> = { ...record };
    if (fault === 'secret') value.endpoint = 'PRIVATE endpoint';
    if (fault === 'scope') value.scope = OTHER_SCOPE;
    if (fault === 'owner') value.userId = 'invalid';
    if (fault === 'id-newline') value.userId = A + '\n';
    if (fault === 'revision') value.revision = -1;
    if (fault === 'operation') value.operationId = nextId();
    if (fault === 'active') value.phase = 'active';
    if (fault === 'fingerprint') value.fingerprint = FINGERPRINT + '\n';
    const bytes = fault === 'oversized' ? 'x'.repeat(8193) : JSON.stringify(value); raw.setItem(key, bytes);
    expect(store.read().status).toBe('corrupt'); expect(() => store.create(B, KEY)).toThrow(DeviceRecordsError); expect(raw.getItem(key)).toBe(bytes);
  });
  it('refuses partial active states, secret input fields and mutable capability identity', () => {
    const { store } = setup(), record = store.create(A, KEY);
    expect(() => store.update(record, { phase: 'active', deviceId: DEVICE })).toThrow(DeviceRecordsError);
    expect(() => store.update(record, { endpoint: 'PRIVATE' } as never)).toThrow(DeviceRecordsError);
    const active = store.update(record, { fingerprint: FINGERPRINT, deviceId: DEVICE, phase: 'active' });
    expect(() => store.update(active, { deviceId: A })).toThrow(DeviceRecordsError);
    expect(() => store.update(active, { fingerprint: 'b'.repeat(64) })).toThrow(DeviceRecordsError);
    expect(store.read().records).toEqual([active]);
  });
  it('does not claim a write persisted when quota changes AppStorage to memory', () => {
    const { raw, storage, store } = setup(), record = store.create(A, KEY), key = store.prefix + record.operationId, bytes = raw.getItem(key);
    vi.spyOn(raw, 'setItem').mockImplementation(() => { throw new DOMException('PRIVATE quota', 'QuotaExceededError'); });
    expect(() => store.update(record, { fingerprint: FINGERPRINT })).toThrow(DeviceRecordsError);
    expect(storage.mode.kind).toBe('memory'); expect(raw.getItem(key)).toBe(bytes); expect(store.read().status).toBe('unavailable');
    expect(() => store.create(B, KEY)).toThrow(DeviceRecordsError);
  });
  it('does not claim removal persisted when the browser refuses it', () => {
    const { raw, storage, store } = setup(), record = store.create(A, KEY), key = store.prefix + record.operationId, bytes = raw.getItem(key);
    vi.spyOn(raw, 'removeItem').mockImplementation(() => { throw new DOMException('PRIVATE blocked', 'SecurityError'); });
    expect(() => store.remove(record)).toThrow(DeviceRecordsError); expect(storage.mode.kind).toBe('memory'); expect(raw.getItem(key)).toBe(bytes);
  });
  it('refuses explicit memory mode before creating an operation', () => {
    const raw = new MemoryStorage(), storage = new AppStorage(raw, { kind: 'memory', reason: 'synthetic' });
    const store = new ReminderDeviceRecords(SCOPE, storage, nextId);
    expect(() => store.create(A, KEY)).toThrow(DeviceRecordsError); expect(raw.length).toBe(0);
  });
  it('bounds receipts without truncating or clearing pending records', () => {
    const { store, raw } = setup(); for (let index = 0; index < 50; index++) store.create(A, KEY);
    expect(() => store.create(B, KEY)).toThrow(DeviceRecordsError); expect(store.read().records).toHaveLength(50);
    const first = store.read().records[0]!; raw.setItem(store.prefix + nextId(), JSON.stringify({ ...first, operationId: nextId() }));
    expect(store.read().status).toBe('capacity'); expect(() => store.remove(first)).toThrow(DeviceRecordsError);
  });
  it('never exposes malformed raw values in errors', () => {
    const { store, raw } = setup(), record = store.create(A, KEY); raw.setItem(store.prefix + record.operationId, 'PRIVATE endpoint token');
    let error: unknown; try { store.create(A, KEY); } catch (cause) { error = cause; }
    expect(error).toBeInstanceOf(DeviceRecordsError); expect((error as Error).message).not.toContain('PRIVATE'); expect((error as Error).cause).toBeUndefined();
  });
});

describe('opaque subscription identity', () => {
  it('hashes scope-separated high-entropy capability material without returning or storing it', async () => {
    vi.stubGlobal('crypto', webcrypto); const endpoint = 'https://fcm.googleapis.com/fcm/send/synthetic-fingerprint';
    const hash = await reminderDeviceFingerprint(SCOPE, endpoint);
    expect(hash).toBe(createHash('sha256').update('daypop-push-v1\0' + SCOPE + '\0' + endpoint).digest('hex'));
    expect(hash).not.toContain('synthetic'); expect(await reminderDeviceFingerprint(OTHER_SCOPE, endpoint)).not.toBe(hash);
  });
  it.each(['https://external.example/private', 'http://127.0.0.1/push'])('rejects an unsafe capability without echoing it %#', async endpoint => {
    await expect(reminderDeviceFingerprint(SCOPE, endpoint)).rejects.toThrow('無法辨識這台裝置的通知資料。');
  });
});
