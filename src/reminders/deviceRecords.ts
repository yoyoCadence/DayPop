import { isUuid } from '../domain/validation';
import { getAppStorage, type AppStorage } from '../storage/browserStorage';
import { isReminderDeviceScope } from './deviceFingerprint';

export interface ReminderDeviceRecord {
  version: 1; operationId: string; revision: number; userId: string; scope: string;
  publicKey: string; fingerprint: string | null; deviceId: string | null;
  phase: 'registering' | 'active' | 'removing' | 'unconfirmed';
}
type RecordStatus = 'ready' | 'corrupt' | 'future' | 'unavailable' | 'capacity';
export interface DeviceRecordsRead { status: RecordStatus; records: readonly ReminderDeviceRecord[] }
export class DeviceRecordsError extends Error {
  constructor(readonly kind: Exclude<RecordStatus, 'ready'> | 'conflict' | 'invalid') {
    super(kind === 'future' ? '裝置通知資料來自較新版本，請先更新日蹦。' :
      kind === 'conflict' ? '裝置通知資料已變更，請重新確認後再試。' :
      kind === 'capacity' ? '待確認的裝置通知資料已達上限，請先完成停用確認。' :
      '無法安全保存裝置通知資料，請先恢復儲存或重新確認設定。');
    this.name = 'DeviceRecordsError';
  }
}
const LIMIT = 50;
const fields = ['version', 'operationId', 'revision', 'userId', 'scope', 'publicKey', 'fingerprint', 'deviceId', 'phase'];
const identifier = (value: unknown): value is string => isUuid(value) && value.length === 36;
function parse(value: unknown, scope: string, operationId: string): ReminderDeviceRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DeviceRecordsError('corrupt');
  const row = value as Record<string, unknown>;
  if (typeof row.version === 'number' && Number.isInteger(row.version) && row.version > 1) throw new DeviceRecordsError('future');
  if (row.version !== 1 || Object.keys(row).length !== fields.length || Object.keys(row).some(key => !fields.includes(key)) ||
      !identifier(row.operationId) || row.operationId !== operationId || !identifier(row.userId) || row.scope !== scope ||
      !Number.isSafeInteger(row.revision) || (row.revision as number) < 0 ||
      typeof row.publicKey !== 'string' || row.publicKey.length !== 87 || !/^B[A-Za-z0-9_-]{86}$/.test(row.publicKey) ||
      (row.fingerprint !== null && (typeof row.fingerprint !== 'string' || row.fingerprint.length !== 64 || !/^[a-f0-9]{64}$/.test(row.fingerprint))) ||
      (row.deviceId !== null && !identifier(row.deviceId)) || !['registering', 'active', 'removing', 'unconfirmed'].includes(row.phase as string) ||
      (row.phase === 'active' && (!row.deviceId || !row.fingerprint)) || (row.phase === 'registering' && row.deviceId !== null)) throw new DeviceRecordsError('corrupt');
  return { version: 1, operationId: row.operationId, revision: row.revision as number, userId: row.userId, scope,
    publicKey: row.publicKey, fingerprint: row.fingerprint as string | null, deviceId: row.deviceId as string | null, phase: row.phase as ReminderDeviceRecord['phase'] };
}

/** Independent operation receipts avoid overwriting another account/tab's pending cleanup. Never part of v4. */
export class ReminderDeviceRecords {
  readonly prefix: string;
  constructor(readonly scope: string, private readonly storage: AppStorage = getAppStorage(), private readonly makeId = () => crypto.randomUUID() as string) {
    if (!isReminderDeviceScope(scope)) throw new DeviceRecordsError('invalid');
    this.prefix = 'daypop.reminder-device.' + encodeURIComponent(scope) + '.';
  }
  read(): DeviceRecordsRead {
    const records: ReminderDeviceRecord[] = [];
    let status: RecordStatus = 'ready';
    const keys: string[] = [];
    for (let index = 0; index < this.storage.length; index++) {
      const key = this.storage.key(index);
      if (key?.startsWith(this.prefix)) keys.push(key);
    }
    if (keys.length > LIMIT) return { status: 'capacity', records };
    for (const key of keys) {
      const raw = this.storage.getItem(key);
      if (raw === null) continue; // Another tab may have completed this receipt.
      try {
        if (raw.length > 8192) throw new DeviceRecordsError('corrupt');
        records.push(parse(JSON.parse(raw), this.scope, key.slice(this.prefix.length)));
      } catch (cause) {
        if (cause instanceof DeviceRecordsError && cause.kind === 'future') status = 'future';
        else if (status !== 'future') status = 'corrupt';
      }
    }
    if (status === 'ready' && this.storage.mode.kind !== 'persistent') status = 'unavailable';
    return { status, records: records.sort((a, b) => a.operationId.localeCompare(b.operationId)) };
  }
  private writable() {
    const state = this.read();
    if (state.status !== 'ready') throw new DeviceRecordsError(state.status);
    return state.records;
  }
  private confirmedWrite(record: ReminderDeviceRecord) {
    const key = this.prefix + record.operationId, bytes = JSON.stringify(record);
    this.storage.setItem(key, bytes);
    if (this.storage.mode.kind !== 'persistent') throw new DeviceRecordsError('unavailable');
    if (this.storage.getItem(key) !== bytes) throw new DeviceRecordsError('conflict');
    if (this.storage.mode.kind !== 'persistent') throw new DeviceRecordsError('unavailable');
    return record;
  }
  create(userId: string, publicKey: string): ReminderDeviceRecord {
    const records = this.writable();
    if (records.length >= LIMIT) throw new DeviceRecordsError('capacity');
    const operationId = this.makeId();
    if (records.some(row => row.operationId === operationId)) throw new DeviceRecordsError('conflict');
    const record = parse({ version: 1, operationId, revision: 0, userId, scope: this.scope, publicKey, fingerprint: null, deviceId: null, phase: 'registering' }, this.scope, operationId);
    return this.confirmedWrite(record);
  }
  update(expected: ReminderDeviceRecord, changes: Partial<Pick<ReminderDeviceRecord, 'fingerprint' | 'deviceId' | 'phase'>>): ReminderDeviceRecord {
    const current = this.writable().find(row => row.operationId === expected.operationId);
    if (!current || JSON.stringify(current) !== JSON.stringify(expected)) throw new DeviceRecordsError('conflict');
    if (Object.keys(changes).some(key => !['fingerprint', 'deviceId', 'phase'].includes(key)) ||
        (current.fingerprint !== null && changes.fingerprint !== undefined && changes.fingerprint !== current.fingerprint) ||
        (current.deviceId !== null && changes.deviceId !== undefined && changes.deviceId !== current.deviceId)) throw new DeviceRecordsError('invalid');
    const record = parse({ ...current, ...changes, revision: current.revision + 1 }, this.scope, current.operationId);
    return this.confirmedWrite(record);
  }
  remove(expected: ReminderDeviceRecord): void {
    const current = this.writable().find(row => row.operationId === expected.operationId);
    if (!current || JSON.stringify(current) !== JSON.stringify(expected)) throw new DeviceRecordsError('conflict');
    const key = this.prefix + current.operationId;
    this.storage.removeItem(key);
    if (this.storage.mode.kind !== 'persistent') throw new DeviceRecordsError('unavailable');
    if (this.storage.getItem(key) !== null) throw new DeviceRecordsError('conflict');
    if (this.storage.mode.kind !== 'persistent') throw new DeviceRecordsError('unavailable');
  }
}
