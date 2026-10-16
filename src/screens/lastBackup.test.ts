import { describe, expect, it } from 'vitest';
import { createEmptyUserData } from '../domain/types';
import { MemoryStorage, type StorageLike } from '../storage/browserStorage';
import {
  LAST_BACKUP_PREFIX,
  backupCoverage,
  formatBackupTime,
  lastBackupKey,
  readLastBackup,
  recordLastBackup,
  summarizeBackup,
  type LastBackup,
} from './lastBackup';

/** A storage that refuses everything, as Safari private mode or a full quota can. */
const brokenStorage: StorageLike = {
  get length() {
    return 0;
  },
  key: () => null,
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
  removeItem: () => {
    throw new Error('denied');
  },
};

const record: LastBackup = {
  exportedAt: '2026-10-16T06:05:00.000Z',
  calendars: 2,
  events: 12,
  todos: 30,
  stickers: 4,
  omittedAttachments: 0,
};

describe('last backup record', () => {
  it('keeps the guest and every account apart', () => {
    expect(lastBackupKey(null)).toBe(`${LAST_BACKUP_PREFIX}guest`);
    expect(lastBackupKey('a/b c')).toBe(`${LAST_BACKUP_PREFIX}account.a%2Fb%20c`);
    // An account literally named "guest" must not read the guest's record.
    expect(lastBackupKey('guest')).not.toBe(lastBackupKey(null));

    const storage = new MemoryStorage();
    recordLastBackup(storage, null, record);
    expect(readLastBackup(storage, null)).toEqual(record);
    expect(readLastBackup(storage, 'account-a')).toBeNull();

    const later = { ...record, exportedAt: '2026-10-17T00:00:00.000Z', events: 1 };
    recordLastBackup(storage, 'account-a', later);
    expect(readLastBackup(storage, 'account-a')).toEqual(later);
    expect(readLastBackup(storage, 'account-b')).toBeNull();
    expect(readLastBackup(storage, null)).toEqual(record);
  });

  it('stores only the time and counts', () => {
    const storage = new MemoryStorage();
    recordLastBackup(storage, null, record);
    expect(JSON.parse(storage.getItem(lastBackupKey(null))!)).toEqual(record);
  });

  it('treats anything it cannot trust as no record', () => {
    const storage = new MemoryStorage();
    const key = lastBackupKey(null);
    const invalid: unknown[] = [
      'not json',
      'null',
      '[]',
      { ...record, exportedAt: 'yesterday' },
      { ...record, events: -1 },
      { ...record, todos: 1.5 },
      { ...record, stickers: '4' },
      { exportedAt: record.exportedAt },
    ];
    for (const value of invalid) {
      storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      expect(readLastBackup(storage, null), JSON.stringify(value)).toBeNull();
    }
  });

  it('drops fields it does not know when reading', () => {
    const storage = new MemoryStorage();
    storage.setItem(lastBackupKey(null), JSON.stringify({ ...record, title: '不該出現' }));
    expect(readLastBackup(storage, null)).toEqual(record);
  });

  it('degrades to "no record" and "not recorded" instead of throwing', () => {
    expect(readLastBackup(brokenStorage, null)).toBeNull();
    expect(() => recordLastBackup(brokenStorage, null, record)).not.toThrow();
  });
});

describe('summarizeBackup', () => {
  it('counts what the file holds and what it leaves out', () => {
    const data = createEmptyUserData({ now: '2026-10-16T00:00:00.000Z' });
    const summary = summarizeBackup(
      {
        ...data,
        events: [{ id: 'e1' }, { id: 'e2' }] as never,
        todos: [{ id: 't1' }] as never,
        eventAttachments: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }] as never,
      },
      '2026-10-16T06:05:00.000Z',
    );
    expect(summary).toEqual({
      exportedAt: '2026-10-16T06:05:00.000Z',
      calendars: data.calendars.length,
      events: 2,
      todos: 1,
      stickers: 0,
      omittedAttachments: 3,
    });
  });
});

describe('showing the record', () => {
  it('formats the time in the display timezone', () => {
    expect(formatBackupTime(record.exportedAt, 'Asia/Taipei')).toBe('2026/10/16 14:05');
    expect(formatBackupTime(record.exportedAt, 'America/New_York')).toBe('2026/10/16 02:05');
    expect(formatBackupTime('2026-10-16T02:05:00.000Z', 'America/New_York')).toBe('2026/10/15 22:05');
    // Midnight is 00:00 of the new day, never 24:00 of the old one.
    expect(formatBackupTime('2026-10-15T16:00:00.000Z', 'Asia/Taipei')).toBe('2026/10/16 00:00');
  });

  it('says what the file holds and that attachments are not in it', () => {
    expect(backupCoverage(record)).toBe('含 2 個日曆、12 筆行程、30 筆待辦、4 張貼圖與設定；不含附件。');
    expect(backupCoverage({ ...record, omittedAttachments: 3 })).toBe(
      '含 2 個日曆、12 筆行程、30 筆待辦、4 張貼圖與設定；3 個附件不在備份內。',
    );
  });
});
