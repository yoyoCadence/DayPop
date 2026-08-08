import { describe, expect, it } from 'vitest';
import { LocalDayPopRepository } from './localRepository';
import { MemoryStorage } from './browserStorage';
import {
  ACCOUNT_CACHE_PREFIX,
  accountCacheKey,
  readAccountCache,
  writeAccountCache,
} from './accountCache';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER_OWNER = '22222222-2222-4222-8222-222222222222';

describe('signed-in account cache', () => {
  it('round-trips a validated, versioned document for one account', async () => {
    const storage = new MemoryStorage();
    const data = await new LocalDayPopRepository(new MemoryStorage()).load();

    const written = writeAccountCache(
      OWNER,
      data,
      storage,
      new Date('2026-08-08T14:00:00.000Z'),
    );
    const result = readAccountCache(OWNER, storage);

    expect(written).toMatchObject({
      schemaVersion: __DATA_SCHEMA_VERSION__,
      accountId: OWNER,
      updatedAt: '2026-08-08T14:00:00.000Z',
    });
    expect(result.status === 'ready' ? result.envelope.data : null).toEqual(data);
  });

  it('keeps account keys isolated and never falls back across users', async () => {
    const storage = new MemoryStorage();
    const data = await new LocalDayPopRepository(new MemoryStorage()).load();
    writeAccountCache(OWNER, data, storage);

    expect(accountCacheKey(OWNER)).not.toBe(accountCacheKey(OTHER_OWNER));
    expect(readAccountCache(OTHER_OWNER, storage)).toEqual({ status: 'missing' });
    expect(storage.length).toBe(1);
  });

  it('preserves corrupt bytes instead of treating them as empty data', () => {
    const storage = new MemoryStorage();
    const key = accountCacheKey(OWNER);
    storage.setItem(key, '{not-json');

    expect(readAccountCache(OWNER, storage).status).toBe('corrupt');
    expect(storage.getItem(key)).toBe('{not-json');
  });

  it('refuses a future-version or mismatched-account envelope', async () => {
    const storage = new MemoryStorage();
    const data = await new LocalDayPopRepository(new MemoryStorage()).load();
    storage.setItem(
      accountCacheKey(OWNER),
      JSON.stringify({
        schemaVersion: __DATA_SCHEMA_VERSION__ + 1,
        accountId: OWNER,
        updatedAt: '2026-08-08T14:00:00.000Z',
        data,
      }),
    );
    expect(readAccountCache(OWNER, storage).status).toBe('future');

    storage.setItem(
      accountCacheKey(OWNER),
      JSON.stringify({
        schemaVersion: __DATA_SCHEMA_VERSION__,
        accountId: OTHER_OWNER,
        updatedAt: '2026-08-08T14:00:00.000Z',
        data,
      }),
    );
    expect(readAccountCache(OWNER, storage)).toMatchObject({
      status: 'corrupt',
      reason: '帳號快取 metadata 不符合目前版本',
    });
    expect(accountCacheKey(OWNER)).toMatch(new RegExp('^' + ACCOUNT_CACHE_PREFIX));
  });
});
