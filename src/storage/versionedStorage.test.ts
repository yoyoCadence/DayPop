import { describe, expect, it } from 'vitest';
import { createEmptyUserData } from '../domain/types';
import {
  LEGACY_USER_DATA_STORAGE_KEY,
  readUserData,
  USER_DATA_STORAGE_KEY,
  writeUserData,
} from './versionedStorage';

describe('versioned user storage', () => {
  it('stores user data in a schema-versioned envelope', () => {
    const data = createEmptyUserData();
    data.preferences.petName = '小蹦';

    const stored = writeUserData(data, 0);

    expect(stored.schemaVersion).toBe(1);
    expect(stored.revision).toBe(1);
    expect(readUserData().data.preferences.petName).toBe('小蹦');
  });

  it('never removes unrelated or legacy localStorage data', () => {
    localStorage.setItem(LEGACY_USER_DATA_STORAGE_KEY, '{"events":[{"id":"legacy"}]}');
    localStorage.setItem('another.app.setting', 'keep-me');

    writeUserData(createEmptyUserData(), 0);

    expect(localStorage.getItem(USER_DATA_STORAGE_KEY)).not.toBeNull();
    expect(localStorage.getItem(LEGACY_USER_DATA_STORAGE_KEY)).toContain('legacy');
    expect(localStorage.getItem('another.app.setting')).toBe('keep-me');
  });

  it('returns safe defaults without overwriting malformed data', () => {
    localStorage.setItem(USER_DATA_STORAGE_KEY, 'not-json');

    const result = readUserData();

    expect(result.data.events).toEqual([]);
    expect(localStorage.getItem(USER_DATA_STORAGE_KEY)).toBe('not-json');
  });
});
