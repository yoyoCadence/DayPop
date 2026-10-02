/**
 * Browser storage access for DayPop (DP-017).
 *
 * `window.localStorage` is not always usable. Reading the property itself
 * throws when a browser blocks site data (privacy mode, "block cookies", some
 * embedded webviews), and `setItem` throws once the origin is over quota. Both
 * are recoverable states rather than crashes, but neither may be swallowed:
 * dropping a write silently is how an app tells a user their data is safe when
 * it is not.
 *
 * Everything DayPop stores goes through `AppStorage`. It degrades this tab —
 * and only this tab — to memory when the browser stops accepting writes, so the
 * edit the user just made stays on screen. The mode is published so the UI can
 * keep saying that nothing is being saved; see `StorageWarningBanner`.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

/**
 * `persistent` means the browser accepted a probe write and returned it again.
 * `memory` means this tab is running on a throwaway store and everything is
 * lost on reload — the reason is written for the user, not for logs.
 */
export type StorageMode = { kind: 'persistent' } | { kind: 'memory'; reason: string };

const PROBE_KEY = 'daypop.storage-probe';
const PROBE_VALUE = 'ok';

/** Keys DayPop owns, carried into memory mode so the session stays consistent. */
const OWNED_KEY_PREFIX = 'daypop.';
/** Legacy 日曆桌寵 data. Kept in step with `LEGACY_USER_DATA_STORAGE_KEY`;
 *  spelled out here so this module stays below `versionedStorage`. DP-025. */
const LEGACY_KEYS = ['calpet.v2', 'CALPET_FIRED'];

/** Session-only stand-in. Accepts every write and keeps nothing after reload. */
export class MemoryStorage implements StorageLike {
  readonly #entries = new Map<string, string>();

  get length(): number {
    return this.#entries.size;
  }

  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.#entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#entries.set(key, String(value));
  }

  removeItem(key: string): void {
    this.#entries.delete(key);
  }
}

/**
 * The store the app actually uses.
 *
 * Delegates to the browser until the browser refuses, then switches to memory
 * for the rest of the tab. It never switches back: a quota that cleared itself
 * mid-session would otherwise start persisting again without the user being
 * told, leaving half the session on disk and half in memory.
 */
export class AppStorage implements StorageLike {
  #delegate: StorageLike;
  #mode: StorageMode;
  readonly #listeners = new Set<() => void>();

  constructor(delegate: StorageLike, mode: StorageMode = { kind: 'persistent' }) {
    this.#delegate = delegate;
    this.#mode = mode;
  }

  /** Replaced as a whole on degrade, so identity is a valid change signal. */
  get mode(): StorageMode {
    return this.#mode;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  get length(): number {
    try {
      return this.#delegate.length;
    } catch (cause) {
      return this.#retryOnce(cause, (delegate) => delegate.length);
    }
  }

  key(index: number): string | null {
    try {
      return this.#delegate.key(index);
    } catch (cause) {
      return this.#retryOnce(cause, (delegate) => delegate.key(index));
    }
  }

  getItem(key: string): string | null {
    try {
      return this.#delegate.getItem(key);
    } catch (cause) {
      return this.#retryOnce(cause, (delegate) => delegate.getItem(key));
    }
  }

  setItem(key: string, value: string): void {
    try {
      this.#delegate.setItem(key, value);
    } catch (cause) {
      this.#retryOnce(cause, (delegate) => delegate.setItem(key, value));
    }
  }

  removeItem(key: string): void {
    try {
      this.#delegate.removeItem(key);
    } catch (cause) {
      this.#retryOnce(cause, (delegate) => delegate.removeItem(key));
    }
  }

  /**
   * Degrade to memory and run the operation again there.
   *
   * Rethrows when the failure came from the memory store, which cannot happen
   * today but would otherwise loop forever if it ever did.
   */
  #retryOnce<T>(cause: unknown, operation: (delegate: StorageLike) => T): T {
    if (this.#mode.kind === 'memory') throw cause;
    this.#degrade(describeStorageFailure(cause));
    return operation(this.#delegate);
  }

  #degrade(reason: string): void {
    this.#delegate = carryOwnedEntries(this.#delegate);
    this.#mode = { kind: 'memory', reason };
    for (const listener of [...this.#listeners]) listener();
  }
}

/**
 * Copy what DayPop owns out of a store that stopped accepting writes.
 *
 * Best effort: such a store is usually still readable, so carrying its
 * contents over keeps the session showing the same data — and keeps export
 * able to hand that data back, which is the user's way out of a full device.
 * Only ever reads `source`; the original bytes stay on disk untouched.
 */
function carryOwnedEntries(source: StorageLike): MemoryStorage {
  const memory = new MemoryStorage();
  try {
    for (let index = 0; index < source.length; index += 1) {
      const key = source.key(index);
      if (key === null || key === PROBE_KEY) continue;
      if (!key.startsWith(OWNED_KEY_PREFIX) && !LEGACY_KEYS.includes(key)) continue;
      const value = source.getItem(key);
      if (value !== null) memory.setItem(key, value);
    }
  } catch {
    // A store that cannot even be enumerated starts the session empty. The
    // original bytes are untouched on disk either way.
  }
  return memory;
}

/**
 * `readable` is the store that failed the probe but could still be reached. It
 * is absent when there was nothing to reach: the accessor threw or returned
 * nothing. It is for reading only — a store that fails the probe is never
 * written to again.
 */
export type StorageProbe =
  | { ok: true; storage: StorageLike }
  | { ok: false; reason: string; readable?: StorageLike };

/**
 * Decide whether a store is usable before trusting it with user data.
 *
 * `access` is a thunk because reading `window.localStorage` is itself the part
 * that throws in a blocked browser.
 */
export function probeStorage(access: () => StorageLike | null | undefined): StorageProbe {
  let storage: StorageLike | null | undefined;
  try {
    storage = access();
  } catch (cause) {
    return { ok: false, reason: describeStorageFailure(cause) };
  }
  if (!storage) return { ok: false, reason: '這個瀏覽器沒有提供本機儲存空間。' };

  try {
    storage.setItem(PROBE_KEY, PROBE_VALUE);
    const echoed = storage.getItem(PROBE_KEY);
    storage.removeItem(PROBE_KEY);
    // Some privacy modes accept the write and hand back nothing at all.
    if (echoed !== PROBE_VALUE) {
      return { ok: false, reason: '瀏覽器沒有保留剛剛寫入的測試資料。', readable: storage };
    }
  } catch (cause) {
    return { ok: false, reason: describeStorageFailure(cause), readable: storage };
  }

  return { ok: true, storage };
}

/**
 * Build the tab's store from whatever the browser offers at startup (DP-106).
 *
 * A failed probe starts in memory, like a write refused mid-session does, and
 * for the same reason starts from what can still be read: an origin that is
 * merely full at startup must not open as an empty calendar whose export is
 * empty too. With nothing to read, the session starts empty as before.
 */
export function createAppStorage(access: () => StorageLike | null | undefined): AppStorage {
  const probe = probeStorage(access);
  if (probe.ok) return new AppStorage(probe.storage);
  const memory = probe.readable ? carryOwnedEntries(probe.readable) : new MemoryStorage();
  return new AppStorage(memory, { kind: 'memory', reason: probe.reason });
}

const QUOTA_ERROR_NAMES = new Set(['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED']);
/** `DOMException.QUOTA_EXCEEDED_ERR`, plus the legacy Firefox code. */
const QUOTA_ERROR_CODES = new Set([22, 1014]);

export function isQuotaExceededError(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  if (QUOTA_ERROR_NAMES.has(cause.name)) return true;
  const code = (cause as { code?: unknown }).code;
  return typeof code === 'number' && QUOTA_ERROR_CODES.has(code);
}

/** User-facing sentence. Never includes the raw error text, which is noise. */
export function describeStorageFailure(cause: unknown): string {
  if (isQuotaExceededError(cause)) return '這台裝置給 DayPop 的儲存空間已經滿了。';
  return '這個瀏覽器目前不允許 DayPop 使用本機儲存空間（常見於無痕視窗或已封鎖網站資料）。';
}

let appStorage: AppStorage | null = null;

/**
 * The one store the whole tab shares.
 *
 * A singleton on purpose: in memory mode a second instance would be a second
 * empty store, and data written by one screen would be invisible to the next.
 */
export function getAppStorage(): AppStorage {
  if (appStorage) return appStorage;

  appStorage = createAppStorage(() => globalThis.localStorage);
  return appStorage;
}

export function subscribeStorageMode(listener: () => void): () => void {
  return getAppStorage().subscribe(listener);
}

export function getStorageMode(): StorageMode {
  return getAppStorage().mode;
}
