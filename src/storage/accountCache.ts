import type { DayPopUserData } from '../domain/types';
import { isIsoInstant, parseDayPopUserData } from '../domain/validation';
import { getAppStorage, type StorageLike } from './browserStorage';

export const ACCOUNT_CACHE_PREFIX = 'daypop.account-cache.';

export interface StoredAccountCache {
  schemaVersion: number;
  accountId: string;
  updatedAt: string;
  data: DayPopUserData;
}

export type AccountCacheReadResult =
  | { status: 'missing' }
  | { status: 'ready'; envelope: StoredAccountCache }
  | { status: 'corrupt'; raw: string; reason: string }
  | { status: 'future'; raw: string; schemaVersion: number };

/**
 * A signed-in account cache is only a reload/failure fallback.
 *
 * Supabase remains the durable source of truth, so unreadable cache bytes are
 * never uploaded or treated as an empty document. The account id is present
 * in both the key and envelope so one account can never consume another
 * account's cached rows even if a key is copied manually.
 */
export function readAccountCache(
  accountId: string,
  storage: StorageLike = getAppStorage(),
): AccountCacheReadResult {
  const raw = storage.getItem(accountCacheKey(accountId));
  if (raw === null) return { status: 'missing' };

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

  if (!isRecord(parsed) || !Number.isInteger(parsed.schemaVersion)) {
    return { status: 'corrupt', raw, reason: '帳號快取 envelope 不完整' };
  }
  const schemaVersion = Number(parsed.schemaVersion);
  if (schemaVersion > __DATA_SCHEMA_VERSION__) {
    return { status: 'future', raw, schemaVersion };
  }
  if (
    schemaVersion !== __DATA_SCHEMA_VERSION__ ||
    parsed.accountId !== accountId ||
    !isIsoInstant(parsed.updatedAt)
  ) {
    return { status: 'corrupt', raw, reason: '帳號快取 metadata 不符合目前版本' };
  }

  try {
    return {
      status: 'ready',
      envelope: {
        schemaVersion,
        accountId,
        updatedAt: parsed.updatedAt,
        data: parseDayPopUserData(parsed.data),
      },
    };
  } catch (cause) {
    return {
      status: 'corrupt',
      raw,
      reason: cause instanceof Error ? cause.message : '帳號快取內容驗證失敗',
    };
  }
}

export function writeAccountCache(
  accountId: string,
  data: DayPopUserData,
  storage: StorageLike = getAppStorage(),
  now: Date = new Date(),
): StoredAccountCache {
  const envelope: StoredAccountCache = {
    schemaVersion: __DATA_SCHEMA_VERSION__,
    accountId,
    updatedAt: now.toISOString(),
    data: parseDayPopUserData(data),
  };
  storage.setItem(accountCacheKey(accountId), JSON.stringify(envelope));
  return envelope;
}

export function accountCacheKey(accountId: string): string {
  return ACCOUNT_CACHE_PREFIX + encodeURIComponent(accountId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
