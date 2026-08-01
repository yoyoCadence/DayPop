import { createEmptyUserData, type DayPopUserData } from '../domain/types';

export const USER_DATA_STORAGE_KEY = 'daypop.user-data';
export const LEGACY_USER_DATA_STORAGE_KEY = 'calpet.v2';

export interface StoredEnvelope {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  data: DayPopUserData;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

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

export function readUserData(storage: StorageLike = window.localStorage): StoredEnvelope {
  const raw = storage.getItem(USER_DATA_STORAGE_KEY);
  if (!raw) return createEnvelope(createEmptyUserData(), 0);

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isEnvelope(parsed)) return createEnvelope(createEmptyUserData(), 0);
    if (parsed.schemaVersion !== __DATA_SCHEMA_VERSION__) {
      return migrateEnvelope(parsed);
    }
    return parsed;
  } catch {
    return createEnvelope(createEmptyUserData(), 0);
  }
}

export function writeUserData(
  data: DayPopUserData,
  previousRevision: number,
  storage: StorageLike = window.localStorage,
): StoredEnvelope {
  const envelope = createEnvelope(data, previousRevision + 1);
  storage.setItem(USER_DATA_STORAGE_KEY, JSON.stringify(envelope));
  return envelope;
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
  if (envelope.schemaVersion > __DATA_SCHEMA_VERSION__) {
    throw new Error('這份 DayPop 資料來自較新的版本，請先更新 App。');
  }

  // Schema v1 is the first structured DayPop envelope. Future migrations are
  // appended here and must never delete unrelated localStorage or Cache entries.
  return createEnvelope(envelope.data, envelope.revision);
}
