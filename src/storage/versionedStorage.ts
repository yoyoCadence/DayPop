import { createEmptyUserData, type DayPopUserData } from '../domain/types';
import { isIsoInstant, parseDayPopUserData } from '../domain/validation';
import { getAppStorage, type StorageLike } from './browserStorage';
import { isV1UserData, migrateV1UserData, type V1UserData } from './localDataMigration';

export type { StorageLike };

export const USER_DATA_STORAGE_KEY = 'daypop.user-data';
export const LEGACY_USER_DATA_STORAGE_KEY = 'calpet.v2';
/** Backups are timestamped so recovering twice never clobbers the first copy. */
export const USER_DATA_BACKUP_PREFIX = 'daypop.user-data.backup.';

export interface StoredEnvelope {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  data: DayPopUserData;
}

/**
 * What was found under the user-data key.
 *
 * `corrupt` and `future` are deliberately not collapsed into "just use empty
 * data": doing that is how the previous version lost data, because the next
 * mutation wrote the empty state straight over the bytes it could not read.
 * Callers must refuse to write while the result is not `ready`.
 */
export type StorageReadResult =
  | { status: 'ready'; envelope: StoredEnvelope }
  | { status: 'corrupt'; raw: string; reason: string }
  | { status: 'future'; raw: string; schemaVersion: number };

export function readUserData(storage: StorageLike = getAppStorage()): StorageReadResult {
  const raw = storage.getItem(USER_DATA_STORAGE_KEY);
  // No key yet is a genuinely fresh start, not damage.
  if (raw === null) {
    const envelope = createEnvelope(createEmptyUserData(), 0);
    storage.setItem(USER_DATA_STORAGE_KEY, JSON.stringify(envelope));
    return { status: 'ready', envelope };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return {
      status: 'corrupt',
      raw,
      reason: cause instanceof Error ? cause.message : '無法解析 JSON',
    };
  }

  if (!isRecord(parsed)) {
    return { status: 'corrupt', raw, reason: '資料結構不符合目前的 DayPop 格式' };
  }
  const schemaVersion = parsed.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
    return { status: 'corrupt', raw, reason: '資料結構不符合目前的 DayPop 格式' };
  }

  if (schemaVersion > __DATA_SCHEMA_VERSION__) {
    return { status: 'future', raw, schemaVersion };
  }

  if (!isEnvelopeMetadata(parsed)) {
    return { status: 'corrupt', raw, reason: '資料 envelope metadata 不完整' };
  }

  if (schemaVersion === 1) {
    if (!isV1UserData(parsed.data)) {
      return { status: 'corrupt', raw, reason: 'schema v1 資料內容不完整' };
    }
    const envelope = migrateEnvelope({ ...parsed, data: parsed.data });
    storage.setItem(USER_DATA_STORAGE_KEY, JSON.stringify(envelope));
    return { status: 'ready', envelope };
  }

  if (parsed.schemaVersion !== __DATA_SCHEMA_VERSION__) {
    return { status: 'corrupt', raw, reason: `不支援 schema v${parsed.schemaVersion}` };
  }

  try {
    return {
      status: 'ready',
      envelope: { ...parsed, data: parseDayPopUserData(parsed.data) },
    };
  } catch (cause) {
    return {
      status: 'corrupt',
      raw,
      reason: cause instanceof Error ? cause.message : 'domain validation failed',
    };
  }
}

export function writeUserData(
  data: DayPopUserData,
  previousRevision: number,
  storage: StorageLike = getAppStorage(),
): StoredEnvelope {
  const envelope = createEnvelope(parseDayPopUserData(data), previousRevision + 1);
  storage.setItem(USER_DATA_STORAGE_KEY, JSON.stringify(envelope));
  return envelope;
}

/**
 * Copy the unreadable bytes to a timestamped key.
 *
 * This runs before anything is allowed to replace the original, so a reset can
 * never be the only copy of the user's data. Returns the key it wrote to.
 */
export function backupRawUserData(
  raw: string,
  storage: StorageLike = getAppStorage(),
  now: Date = new Date(),
): string {
  const key = `${USER_DATA_BACKUP_PREFIX}${now.toISOString()}`;
  storage.setItem(key, raw);
  return key;
}

export function listUserDataBackups(storage: StorageLike = getAppStorage()): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(USER_DATA_BACKUP_PREFIX)) keys.push(key);
  }
  return keys.sort();
}

/**
 * Replace unreadable data with a fresh empty envelope.
 *
 * Refuses to run until a backup of the current bytes exists, so the reset path
 * cannot be used to destroy data that was never copied anywhere.
 */
export function resetUserData(storage: StorageLike = getAppStorage()): StoredEnvelope {
  if (listUserDataBackups(storage).length === 0) {
    throw new Error('尚未備份原始內容，拒絕重設本機資料。');
  }
  return writeUserData(createEmptyUserData(), 0, storage);
}

function createEnvelope(data: DayPopUserData, revision: number): StoredEnvelope {
  return {
    schemaVersion: __DATA_SCHEMA_VERSION__,
    revision,
    updatedAt: new Date().toISOString(),
    data,
  };
}

interface RawEnvelope {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  data: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEnvelopeMetadata(
  value: Record<string, unknown>,
): value is Record<string, unknown> & RawEnvelope {
  return (
    Number.isInteger(value.schemaVersion) &&
    Number(value.schemaVersion) > 0 &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 0 &&
    isIsoInstant(value.updatedAt) &&
    'data' in value
  );
}

function migrateEnvelope(envelope: RawEnvelope & { data: V1UserData }): StoredEnvelope {
  // v1 is intentionally retained as a concrete fixture and migrator. Future
  // steps are appended here; newer envelopes never reach this function.
  return {
    schemaVersion: __DATA_SCHEMA_VERSION__,
    revision: envelope.revision,
    updatedAt: envelope.updatedAt,
    data: migrateV1UserData(envelope.data, envelope.updatedAt),
  };
}
