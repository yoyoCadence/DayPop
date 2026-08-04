import { describe, expect, it } from 'vitest';
import { createEmptyUserData } from '../domain/types';
import { AppStorage, MemoryStorage, probeStorage, type StorageLike } from './browserStorage';
import { LocalDayPopRepository } from './localRepository';
import { readUserData, USER_DATA_STORAGE_KEY, writeUserData } from './versionedStorage';

/** A store that behaves normally until it is told to start refusing writes. */
class FlakyStorage implements StorageLike {
  readonly entries = new Map<string, string>();
  failWrites: Error | null = null;
  failEverything: Error | null = null;

  get length(): number {
    if (this.failEverything) throw this.failEverything;
    return this.entries.size;
  }

  key(index: number): string | null {
    if (this.failEverything) throw this.failEverything;
    return [...this.entries.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    if (this.failEverything) throw this.failEverything;
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failEverything) throw this.failEverything;
    if (this.failWrites) throw this.failWrites;
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    if (this.failEverything) throw this.failEverything;
    this.entries.delete(key);
  }
}

function quotaError(): Error {
  const error = new Error('exceeded the quota');
  error.name = 'QuotaExceededError';
  return error;
}

describe('storage probe', () => {
  it('reports a working store as usable', () => {
    const probe = probeStorage(() => new MemoryStorage());
    expect(probe.ok).toBe(true);
  });

  it('treats a throwing accessor as unavailable instead of crashing', () => {
    const probe = probeStorage(() => {
      throw new DOMException('access denied', 'SecurityError');
    });

    expect(probe).toMatchObject({ ok: false });
    if (!probe.ok) expect(probe.reason).toMatch(/本機儲存空間/);
  });

  it('treats a store that refuses writes as unavailable', () => {
    const storage = new FlakyStorage();
    storage.failWrites = quotaError();

    const probe = probeStorage(() => storage);

    expect(probe).toMatchObject({ ok: false });
    if (!probe.ok) expect(probe.reason).toMatch(/空間已經滿了/);
  });

  it('rejects a store that accepts a write but keeps nothing', () => {
    const amnesiac: StorageLike = {
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };

    expect(probeStorage(() => amnesiac).ok).toBe(false);
  });

  it('leaves no probe key behind', () => {
    const storage = new MemoryStorage();
    probeStorage(() => storage);
    expect(storage.length).toBe(0);
  });
});

describe('degrading to memory', () => {
  it('starts out persistent and reports no warning', () => {
    const storage = new AppStorage(new FlakyStorage());
    expect(storage.mode).toEqual({ kind: 'persistent' });
  });

  it('switches to memory when a write is refused, and keeps the value', () => {
    const browser = new FlakyStorage();
    const storage = new AppStorage(browser);
    storage.setItem('daypop.user-data', 'first');
    browser.failWrites = quotaError();

    storage.setItem('daypop.user-data', 'second');

    expect(storage.mode).toMatchObject({ kind: 'memory' });
    expect(storage.getItem('daypop.user-data')).toBe('second');
    // The browser store keeps what it had; nothing was destroyed to fit.
    expect(browser.entries.get('daypop.user-data')).toBe('first');
  });

  it('does not report the failed write as saved', () => {
    const browser = new FlakyStorage();
    const storage = new AppStorage(browser);
    writeUserData(createEmptyUserData(), 0, storage);
    browser.failWrites = quotaError();

    const repository = new LocalDayPopRepository(storage);
    repository.addTodo({ title: '買菜', date: '2026-08-06' });

    // Visible in this tab…
    const inSession = readUserData(storage);
    expect(inSession.status).toBe('ready');
    if (inSession.status === 'ready') expect(inSession.envelope.data.todos).toHaveLength(1);

    // …and gone after a reload, which is exactly what the warning promises.
    const afterReload = readUserData(new AppStorage(browser));
    expect(afterReload.status).toBe('ready');
    if (afterReload.status === 'ready') expect(afterReload.envelope.data.todos).toHaveLength(0);
  });

  it('carries DayPop data across so the session keeps showing it', () => {
    const browser = new FlakyStorage();
    browser.entries.set(USER_DATA_STORAGE_KEY, 'kept');
    browser.entries.set('calpet.v2', 'legacy');
    browser.entries.set('another.app.setting', 'not ours');
    const storage = new AppStorage(browser);
    browser.failWrites = quotaError();

    storage.setItem('daypop.something-else', 'x');

    expect(storage.getItem(USER_DATA_STORAGE_KEY)).toBe('kept');
    expect(storage.getItem('calpet.v2')).toBe('legacy');
    expect(storage.getItem('another.app.setting')).toBeNull();
    // The originals are untouched — memory mode never deletes anything.
    expect(browser.entries.get(USER_DATA_STORAGE_KEY)).toBe('kept');
    expect(browser.entries.get('calpet.v2')).toBe('legacy');
  });

  it('degrades on a failing read as well as a failing write', () => {
    const browser = new FlakyStorage();
    const storage = new AppStorage(browser);
    browser.failEverything = new DOMException('gone', 'SecurityError');

    expect(storage.getItem(USER_DATA_STORAGE_KEY)).toBeNull();
    expect(storage.mode).toMatchObject({ kind: 'memory' });
  });

  it('notifies subscribers once, when the mode actually changes', () => {
    const browser = new FlakyStorage();
    const storage = new AppStorage(browser);
    let changes = 0;
    const unsubscribe = storage.subscribe(() => {
      changes += 1;
    });

    browser.failWrites = quotaError();
    storage.setItem('daypop.a', '1');
    storage.setItem('daypop.b', '2');

    expect(changes).toBe(1);
    unsubscribe();
  });

  it('stops notifying after unsubscribe', () => {
    const browser = new FlakyStorage();
    const storage = new AppStorage(browser);
    let changes = 0;
    storage.subscribe(() => {
      changes += 1;
    })();

    browser.failWrites = quotaError();
    storage.setItem('daypop.a', '1');

    expect(changes).toBe(0);
  });

  it('never silently returns to the browser store', () => {
    const browser = new FlakyStorage();
    const storage = new AppStorage(browser);
    browser.failWrites = quotaError();
    storage.setItem('daypop.a', '1');

    // Space freed up again — but this tab stays in memory, so the session does
    // not end up half on disk and half in memory.
    browser.failWrites = null;
    storage.setItem('daypop.b', '2');

    expect(storage.mode).toMatchObject({ kind: 'memory' });
    expect(browser.entries.has('daypop.b')).toBe(false);
  });
});

describe('memory storage', () => {
  it('behaves like a store for the keys it is given', () => {
    const storage = new MemoryStorage();
    storage.setItem('a', '1');
    storage.setItem('b', '2');

    expect(storage.length).toBe(2);
    expect(storage.key(1)).toBe('b');
    expect(storage.getItem('a')).toBe('1');

    storage.removeItem('a');
    expect(storage.getItem('a')).toBeNull();
    expect(storage.length).toBe(1);
  });
});
