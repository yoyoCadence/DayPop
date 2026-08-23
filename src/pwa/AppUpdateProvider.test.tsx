import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUpdateProvider } from './AppUpdateProvider';
import { useAppUpdateState } from './appUpdateContext';
import { useAppUpdate } from './useAppUpdate';

/**
 * DP-073 — a cold start checks `version.json` once, not twice.
 *
 * `SessionDataProvider` mounts `<DataProvider key={identity}>`, and `identity`
 * changes on every cold start: `'auth-initializing'` becomes `'guest'` or an
 * account id when Supabase Auth resolves. A changed key unmounts and remounts
 * the whole subtree, so a version check hosted inside it runs again. These
 * cases assert one check versus more than one rather than a specific total:
 * the observed total has differed between measurements and the extra triggers
 * were never traced. That remount is a deliberate safety boundary and stays;
 * the version check moved out instead.
 *
 * The key change is reproduced directly rather than by mounting
 * `SessionDataProvider`, which would need a Supabase client: what matters is
 * the remount, not what triggers it.
 *
 * Stubbed the same way as `useAppUpdate.test.ts` — the production branch is the
 * one that ships, and the dev branch would exercise different code.
 */

const VERSION_RESPONSE = { version: '0.0.0', releasedAt: '2026-01-01', title: 't', changes: [] };

let container: HTMLDivElement;
let root: Root;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubEnv('PROD', true);

  fetchSpy = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(VERSION_RESPONSE) }),
  );
  vi.stubGlobal('fetch', fetchSpy);

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      controller: null,
      register: vi.fn(() =>
        Promise.resolve({
          waiting: null,
          installing: null,
          update: vi.fn(() => Promise.resolve()),
          addEventListener: vi.fn(),
        }),
      ),
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

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function checks(): number {
  return fetchSpy.mock.calls.filter(([url]) => String(url).includes('version.json')).length;
}

/**
 * Stands in for `SessionDataProvider`: the key is driven from the test rather
 * than from internal state, so a re-render with a new `identity` reproduces the
 * cold-start remount exactly.
 */
function KeyedSubtree({ identity, children }: { identity: string; children: ReactNode }) {
  return <div key={identity}>{children}</div>;
}

function Consumer() {
  useAppUpdateState();
  return null;
}

/** The arrangement DP-073 replaced: the hook owned inside the keyed subtree. */
function HookInsideKeyedSubtree() {
  useAppUpdate();
  return null;
}

describe('AppUpdateProvider', () => {
  it('checks once across the cold-start identity change', async () => {
    const renderWith = async (identity: string) => {
      await act(async () => {
        root.render(
          <AppUpdateProvider>
            <KeyedSubtree identity={identity}>
              <Consumer />
            </KeyedSubtree>
          </AppUpdateProvider>,
        );
      });
      await settle();
    };

    await renderWith('auth-initializing');
    expect(checks()).toBe(1);

    await renderWith('guest');

    expect(checks()).toBe(1);
  });

  /**
   * The defect, kept executable. Without this the test above could pass for the
   * wrong reason — a setup that never really remounts would also report one
   * check. This proves the remount is real and that hosting the hook inside it
   * is what doubled the request.
   */
  it('would check twice if the hook were hosted inside the keyed subtree', async () => {
    const renderWith = async (identity: string) => {
      await act(async () => {
        root.render(
          <KeyedSubtree identity={identity}>
            <HookInsideKeyedSubtree />
          </KeyedSubtree>,
        );
      });
      await settle();
    };

    await renderWith('auth-initializing');
    expect(checks()).toBe(1);

    await renderWith('guest');

    expect(checks()).toBe(2);
  });

  it('refuses to run outside the provider rather than silently doing nothing', () => {
    const onError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => act(() => root.render(<Consumer />))).toThrow(/AppUpdateProvider/);
    onError.mockRestore();
  });
});
