import { describe, expect, it } from 'vitest';
import { PET_KINDS } from '../domain/types';
import { buildJsonBackup, planJsonImport } from '../domain/dataTransfer';
import { MemoryStorage } from './browserStorage';
import { accountCacheKey, readAccountCache, writeAccountCache } from './accountCache';
import { migrateV2UserData } from './localDataMigration';
import { LocalDayPopRepository } from './localRepository';
import { readUserData, USER_DATA_STORAGE_KEY } from './versionedStorage';
import fixture from './fixtures/user-data-v2.json';

const OWNER = '11111111-1111-4111-8111-111111111111';
const STAMP = '2026-11-04T04:00:00.000Z';
function legacy() {
  const data = migrateV2UserData(fixture.data);
  const { petKind, ...preferences } = data.preferences;
  expect(petKind).toBe('moon_cat');
  return { ...data, preferences };
}

describe('v5 partner preference migration', () => {
  it('adds only the default partner to v4, retaining rows, metadata and saved preferences across two reads', () => {
    const storage = new MemoryStorage(); const data = legacy();
    storage.setItem(USER_DATA_STORAGE_KEY, JSON.stringify({ schemaVersion: 4, revision: 19, updatedAt: STAMP, data }));
    const result = readUserData(storage);
    expect(result).toEqual({ status: 'ready', envelope: { schemaVersion: 5, revision: 19, updatedAt: STAMP,
      data: { ...data, preferences: { ...data.preferences, petKind: 'moon_cat' } } } });
    const migrated = storage.getItem(USER_DATA_STORAGE_KEY);
    expect(readUserData(storage)).toEqual(result);
    expect(storage.getItem(USER_DATA_STORAGE_KEY)).toBe(migrated);
  });
  it('reads a same-account v4 cache without rewriting its source or another account', () => {
    const storage = new MemoryStorage(); const data = legacy();
    const raw = JSON.stringify({ schemaVersion: 4, accountId: OWNER, updatedAt: STAMP, data });
    storage.setItem(accountCacheKey(OWNER), raw);
    expect(readAccountCache(OWNER, storage)).toMatchObject({ status: 'ready', envelope: { schemaVersion: 5,
      data: { ...data, preferences: { ...data.preferences, petKind: 'moon_cat' } } } });
    expect(storage.getItem(accountCacheKey(OWNER))).toBe(raw);
    expect(readAccountCache('another', storage)).toEqual({ status: 'missing' });
  });
  it.each([null, 'unknown', 3])('refuses invalid v4 partner %s instead of replacing it with a default', petKind => {
    const storage = new MemoryStorage(); const data = legacy();
    const raw = JSON.stringify({ schemaVersion: 4, revision: 19, updatedAt: STAMP,
      data: { ...data, preferences: { ...data.preferences, petKind } } });
    storage.setItem(USER_DATA_STORAGE_KEY, raw);
    expect(readUserData(storage).status).toBe('corrupt');
    expect(storage.getItem(USER_DATA_STORAGE_KEY)).toBe(raw);
  });
  it('requires petKind in current v5 data; it only supplies defaults during legacy migration', () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify({ schemaVersion: 5, revision: 19, updatedAt: STAMP, data: legacy() });
    storage.setItem(USER_DATA_STORAGE_KEY, raw);
    expect(readUserData(storage).status).toBe('corrupt');
    expect(storage.getItem(USER_DATA_STORAGE_KEY)).toBe(raw);
  });
  it('leaves original v4 bytes intact when migration persistence is refused', () => {
    const storage = new MemoryStorage(); const data = legacy();
    const raw = JSON.stringify({ schemaVersion: 4, revision: 19, updatedAt: STAMP, data });
    storage.setItem(USER_DATA_STORAGE_KEY, raw);
    storage.setItem = () => { throw Error('quota'); };
    expect(readUserData(storage).status).toBe('corrupt');
    expect(storage.getItem(USER_DATA_STORAGE_KEY)).toBe(raw);
  });
  it('persists every valid partner through guest reload and account cache; invalid edits keep bytes', async () => {
    const storage = new MemoryStorage(); const repository = new LocalDayPopRepository(storage);
    for (const petKind of PET_KINDS) {
      await repository.updatePreferences({ petKind });
      const data = await new LocalDayPopRepository(storage).load();
      expect(data.preferences.petKind).toBe(petKind);
      writeAccountCache(OWNER, data, storage);
      expect(readAccountCache(OWNER, storage)).toMatchObject({ status: 'ready', envelope: { data: { preferences: { petKind } } } });
    }
    const raw = storage.getItem(USER_DATA_STORAGE_KEY);
    await expect(repository.updatePreferences({ petKind: 'unknown' as never })).rejects.toThrow();
    expect(storage.getItem(USER_DATA_STORAGE_KEY)).toBe(raw);
  });
  it('round-trips v2 backups with a choice, migrates old v1 backups, and rejects future/invalid choices', async () => {
    const data = await new LocalDayPopRepository(new MemoryStorage()).load();
    data.preferences.petKind = 'honey_bear';
    const backup = buildJsonBackup(data) as unknown as { formatVersion: number; data: { preferences: { petKind?: string } } };
    expect(backup.formatVersion).toBe(2);
    expect(planJsonImport(JSON.stringify(backup), data).command).toMatchObject({ kind: 'replace', data: { preferences: { petKind: 'honey_bear' } } });
    backup.formatVersion = 1; delete backup.data.preferences.petKind;
    expect(planJsonImport(JSON.stringify(backup), data).command).toMatchObject({ kind: 'replace', data: { preferences: { petKind: 'moon_cat' } } });
    backup.formatVersion = 2;
    expect(() => planJsonImport(JSON.stringify(backup), data)).toThrow();
    backup.data.preferences.petKind = 'unknown';
    expect(() => planJsonImport(JSON.stringify(backup), data)).toThrow();
    backup.formatVersion = 3;
    expect(() => planJsonImport(JSON.stringify(backup), data)).toThrow(/較新版本/);
  });
});
