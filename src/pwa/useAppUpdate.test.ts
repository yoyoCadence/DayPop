import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { MemoryStorage, type StorageLike } from '../storage/browserStorage';
import { readSeenRelease, recordSeenRelease } from './releaseNotesSeen';
import { useAppUpdate, type AppUpdateState } from './useAppUpdate';

/**
 * DP-035 — the automatic update checks are throttled.
 *
 * `visibilitychange` and `online` only get their listeners on the production
 * path (`import.meta.env.PROD` plus a service worker), so both are stubbed here;
 * testing the dev path would exercise a branch that has no listeners at all and
 * prove nothing about the throttle.
 */

const VERSION_RESPONSE = { version: '0.0.0', releasedAt: '2026-01-01', title: 't', changes: [] };

let container: HTMLDivElement;
let root: Root;
let fetchSpy: ReturnType<typeof vi.fn>;
let registration: {
  waiting: { postMessage: ReturnType<typeof vi.fn> } | null;
  installing: null;
  update: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
};

/** Renders the hook and hands back a live view of its return value. */
function renderHook(storage?: StorageLike): { current: AppUpdateState } {
  const ref = { current: null as unknown as AppUpdateState };
  function Probe() {
    ref.current = useAppUpdate(storage);
    return null;
  }
  act(() => root.render(createElement(Probe)));
  return ref;
}

/** Lets the mocked fetch's promise chain settle. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubEnv('PROD', true);

  fetchSpy = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(VERSION_RESPONSE) }),
  );
  vi.stubGlobal('fetch', fetchSpy);

  registration = {
    waiting: null,
    installing: null,
    update: vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn(),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      controller: null,
      register: vi.fn(() => Promise.resolve(registration)),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/** Number of `version.json` requests so far. */
function checks(): number {
  return fetchSpy.mock.calls.filter(([url]) => String(url).includes('version.json')).length;
}

function fireVisible() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function fireOnline() {
  act(() => {
    window.dispatchEvent(new Event('online'));
  });
}

describe('useAppUpdate automatic check throttling', () => {
  it('checks once on mount', async () => {
    renderHook();
    await settle();
    expect(checks()).toBe(1);
  });

  it('ignores visibility and online inside the five-minute window', async () => {
    renderHook();
    await settle();
    expect(checks()).toBe(1);

    vi.advanceTimersByTime(60_000);
    fireVisible();
    fireOnline();
    fireVisible();
    await settle();

    // Four extra triggers, none of them due yet.
    expect(checks()).toBe(1);
  });

  it('runs one check once the window has passed, then closes it again', async () => {
    renderHook();
    await settle();

    vi.advanceTimersByTime(5 * 60 * 1000);
    fireVisible();
    await settle();
    expect(checks()).toBe(2);

    // The window restarts from that check, so the next trigger is ignored.
    vi.advanceTimersByTime(60_000);
    fireOnline();
    await settle();
    expect(checks()).toBe(2);
  });

  it('never throttles the manual check', async () => {
    const hook = renderHook();
    await settle();
    expect(checks()).toBe(1);

    // Three presses back to back, with no waiting between them.
    for (let press = 0; press < 3; press += 1) {
      await act(async () => {
        await hook.current.checkForUpdate();
      });
    }
    expect(checks()).toBe(4);
  });

  it('lets a manual check restart the window for automatic ones', async () => {
    const hook = renderHook();
    await settle();

    vi.advanceTimersByTime(5 * 60 * 1000);
    await act(async () => {
      await hook.current.checkForUpdate();
    });
    expect(checks()).toBe(2);

    // The window now runs from the manual check, not from mount.
    fireVisible();
    await settle();
    expect(checks()).toBe(2);
  });

  it('keeps the thirty-minute timer, which the throttle does not gate', async () => {
    renderHook();
    await settle();
    expect(checks()).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(30 * 60 * 1000);
    });
    await settle();
    expect(checks()).toBe(2);

    await act(async () => {
      vi.advanceTimersByTime(30 * 60 * 1000);
    });
    await settle();
    expect(checks()).toBe(3);
  });

  it('stops checking after unmount', async () => {
    renderHook();
    await settle();
    const before = checks();

    act(() => root.unmount());
    root = createRoot(container);

    vi.advanceTimersByTime(60 * 60 * 1000);
    fireVisible();
    fireOnline();
    await settle();
    expect(checks()).toBe(before);
  });
});

/**
 * DP-090 — notes reach people who never see an update prompt, and a manual
 * 檢查更新 always answers. Each test injects its own `MemoryStorage`, so the
 * "already shown" record never leaks between tests.
 */
const CURRENT = {
  version: __APP_VERSION__,
  releasedAt: '2026-09-30',
  title: '這一版',
  changes: ['改了一件事'],
};
const NEWER_VERSION = `${Number(__APP_VERSION__.split('.')[0]) + 1}.0.0`;
const NEWER = { ...CURRENT, version: NEWER_VERSION, title: '下一版' };

function respondWith(body: unknown) {
  fetchSpy.mockImplementation(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }),
  );
}

describe('useAppUpdate release notes and manual feedback', () => {
  it("shows the running version's notes until acknowledged, then not on a later launch", async () => {
    respondWith(CURRENT);
    const storage = new MemoryStorage();
    const hook = renderHook(storage);
    await settle();
    expect(hook.current.whatsNew?.version).toBe(__APP_VERSION__);
    // The automatic check found nothing newer and says nothing about it.
    expect(hook.current.checkResult).toBeNull();

    act(() => hook.current.acknowledgeWhatsNew());
    expect(hook.current.whatsNew).toBeNull();
    expect(readSeenRelease(storage)).toBe(__APP_VERSION__);

    act(() => root.unmount());
    root = createRoot(container);
    const relaunched = renderHook(storage);
    await settle();
    expect(relaunched.current.currentRelease?.version).toBe(__APP_VERSION__);
    expect(relaunched.current.whatsNew).toBeNull();
  });

  it("answers a manual check that finds nothing newer, with this version's notes", async () => {
    respondWith(CURRENT);
    const storage = new MemoryStorage();
    recordSeenRelease(storage, __APP_VERSION__);
    const hook = renderHook(storage);
    await settle();
    expect(hook.current.checkResult).toBeNull();

    await act(async () => {
      await hook.current.checkForUpdate();
    });
    expect(hook.current.checkResult).toEqual({ kind: 'latest', release: CURRENT });

    act(() => hook.current.clearCheckResult());
    expect(hook.current.checkResult).toBeNull();
  });

  it('counts closing the 已是最新 answer as having seen the notes', async () => {
    respondWith(CURRENT);
    const storage = new MemoryStorage();
    const hook = renderHook(storage);
    await settle();

    await act(async () => {
      await hook.current.checkForUpdate();
    });
    act(() => hook.current.clearCheckResult());
    expect(readSeenRelease(storage)).toBe(__APP_VERSION__);
    expect(hook.current.whatsNew).toBeNull();
  });

  it('answers a failed manual check, and keeps a failed automatic one silent', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 503, json: () => Promise.reject(new Error('unused')) }),
    );
    const hook = renderHook(new MemoryStorage());
    await settle();
    expect(hook.current.error).toBe('HTTP 503');
    expect(hook.current.checkResult).toBeNull();

    await act(async () => {
      await hook.current.checkForUpdate();
    });
    expect(hook.current.checkResult).toEqual({ kind: 'failed', message: 'HTTP 503' });
  });

  it('offers again an update the user put off, but only when they ask', async () => {
    respondWith(NEWER);
    const hook = renderHook(new MemoryStorage());
    await settle();
    expect(hook.current.availableRelease?.version).toBe(NEWER_VERSION);

    act(() => hook.current.dismissUpdate());
    expect(hook.current.availableRelease).toBeNull();

    // An automatic check honours 稍後提醒 ...
    vi.advanceTimersByTime(5 * 60 * 1000);
    fireVisible();
    await settle();
    expect(checks()).toBe(2);
    expect(hook.current.availableRelease).toBeNull();

    // ... pressing 檢查更新 is the user asking for it again.
    await act(async () => {
      await hook.current.checkForUpdate();
    });
    expect(hook.current.availableRelease?.version).toBe(NEWER_VERSION);
    expect(hook.current.checkResult).toBeNull();
  });

  it('records the incoming version as seen when 立即更新 is pressed', async () => {
    const worker = { postMessage: vi.fn() };
    registration.waiting = worker;
    respondWith(NEWER);
    const storage = new MemoryStorage();
    const hook = renderHook(storage);
    await settle();

    await act(async () => {
      await hook.current.updateNow();
    });
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    // So the build the reload brings up does not announce the same notes again.
    expect(readSeenRelease(storage)).toBe(NEWER_VERSION);
  });
});
