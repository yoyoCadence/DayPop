import { createEmptyUserData, type DayPopUserData } from '../domain/types';
import { getAppStorage, type StorageLike } from './browserStorage';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUserData(value: unknown): value is DayPopUserData {
  if (!isRecord(value) || !Array.isArray(value.events) || !Array.isArray(value.todos)) return false;
  if (!isRecord(value.preferences)) return false;
  return (
    (value.preferences.weekStartsOn === 0 || value.preferences.weekStartsOn === 1) &&
    typeof value.preferences.petName === 'string' &&
    ['system', 'light', 'dark'].includes(String(value.preferences.theme))
  );
}

function isEnvelope(value: unknown): value is StoredEnvelope {
  return (
    isRecord(value) &&
    typeof value.schemaVersion === 'number' &&
    typeof value.revision === 'number' &&
    typeof value.updatedAt === 'string' &&
    isUserData(value.data)
  );
}

export function readUserData(storage: StorageLike = getAppStorage()): StorageReadResult {
  const raw = storage.getItem(USER_DATA_STORAGE_KEY);
  // No key yet is a genuinely fresh start, not damage.
  if (raw === null) return { status: 'ready', envelope: createEnvelope(createEmptyUserData(), 0) };

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

  if (!isEnvelope(parsed)) {
    return { status: 'corrupt', raw, reason: '資料結構不符合目前的 DayPop 格式' };
  }

  if (parsed.schemaVersion > __DATA_SCHEMA_VERSION__) {
    return { status: 'future', raw, schemaVersion: parsed.schemaVersion };
  }

  if (parsed.schemaVersion < __DATA_SCHEMA_VERSION__) {
    return { status: 'ready', envelope: migrateEnvelope(parsed) };
  }

  return { status: 'ready', envelope: parsed };
}

export function writeUserData(
  data: DayPopUserData,
  previousRevision: number,
  storage: StorageLike = getAppStorage(),
): StoredEnvelope {
  const envelope = createEnvelope(data, previousRevision + 1);
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

function migrateEnvelope(envelope: StoredEnvelope): StoredEnvelope {
  // Schema v1 is the first structured DayPop envelope. Future migrations are
  // appended here and must never delete unrelated localStorage or Cache entries.
  // Envelopes from a newer schema never reach this function — `readUserData`
  // reports them as `future` so nothing overwrites them.
  return createEnvelope(envelope.data, envelope.revision);
}
