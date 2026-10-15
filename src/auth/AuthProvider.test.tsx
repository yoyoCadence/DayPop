import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyUserData } from '../domain/types';
import { writeAccountCache } from '../storage/accountCache';
import type { AuthContextValue } from './authContext';
import { AUTH_STARTUP_DEADLINE_MS } from './AuthProvider';

/**
 * DP-158 — the real `AuthProvider` over the real supabase-js client.
 *
 * Every other test, and the browser harness, hands the App a ready-made
 * `AuthContext`. Nothing ran the provider itself: session restore from
 * storage, token refresh, the recovery link, signing out and in as someone
 * else. Here only the network is replaced, by a small stand-in for the Auth
 * endpoints, so what is exercised is supabase-js's own session handling and
 * how the provider turns its events into `user`, `initializing` and
 * `isPasswordRecovery`.
 */

const PROJECT_URL = 'https://daypopauth.supabase.co';
const STORAGE_KEY = 'sb-daypopauth-auth-token';

interface TestUser {
  id: string;
  email: string;
}

const ALICE: TestUser = { id: '11111111-1111-4111-8111-111111111111', email: 'alice@example.test' };
const BOB: TestUser = { id: '22222222-2222-4222-8222-222222222222', email: 'bob@example.test' };

function base64url(value: object): string {
  return btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

let issued = 0;

/** Unique per call, so a refresh within the same second still yields a new token. */
function accessToken(user: TestUser, expiresAt: number): string {
  issued += 1;
  return [
    base64url({ alg: 'HS256', typ: 'JWT' }),
    base64url({ sub: user.id, email: user.email, exp: expiresAt, aud: 'authenticated', role: 'authenticated', jti: String(issued) }),
    'signature',
  ].join('.');
}

function userJson(user: TestUser) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    app_metadata: { provider: 'email' },
    user_metadata: {},
    created_at: '2026-08-01T00:00:00.000Z',
  };
}

function sessionJson(user: TestUser, { expiresIn = 3600, refresh = `refresh-${user.id}` } = {}) {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  return {
    access_token: accessToken(user, expiresAt),
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: expiresAt,
    refresh_token: refresh,
    user: userJson(user),
  };
}

type Reply = Response | Promise<Response> | 'network-error' | 'never';

/** The Auth endpoints the provider and supabase-js reach, and nothing else. */
class FakeAuthServer {
  readonly requests: { method: string; path: string; body: unknown }[] = [];
  readonly accounts = new Map<string, TestUser>([
    [ALICE.email, ALICE],
    [BOB.email, BOB],
  ]);
  googleEnabled: boolean | 'error' = true;
  /** How the next refresh-token requests are answered. */
  refresh: 'ok' | 'network-error' | 'server-error' | 'never' | 'revoked' = 'ok';
  signUpNeedsConfirmation = true;

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    this.requests.push({ method, path: `${url.pathname}${url.search}`, body });
    const reply = this.#route(method, url, body);
    if (reply === 'network-error') throw new TypeError('Failed to fetch');
    if (reply === 'never') return new Promise<Response>(() => {});
    return reply;
  };

  #route(method: string, url: URL, body: Record<string, unknown> | null): Reply {
    const path = url.pathname;
    if (path === '/auth/v1/settings') {
      if (this.googleEnabled === 'error') return json({ message: 'down' }, 503);
      return json({ external: { google: this.googleEnabled } });
    }
    if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const account = this.accounts.get(String(body?.email));
      if (!account || body?.password !== 'correct-password') {
        return json({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
      }
      return json(sessionJson(account));
    }
    if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      if (this.refresh === 'never') return 'never';
      if (this.refresh === 'network-error') return 'network-error';
      if (this.refresh === 'server-error') return json({ message: 'unavailable' }, 503);
      if (this.refresh === 'revoked') {
        return json({ code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }, 400);
      }
      const owner = [...this.accounts.values()].find((user) => body?.refresh_token === `refresh-${user.id}`);
      if (!owner) {
        return json({ code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }, 400);
      }
      return json(sessionJson(owner));
    }
    if (path === '/auth/v1/user' && method === 'GET') return json(userJson(ALICE));
    if (path === '/auth/v1/user' && method === 'PUT') return json(userJson(ALICE));
    if (path === '/auth/v1/logout') return new Response(null, { status: 204 });
    if (path === '/auth/v1/recover') return json({});
    if (path === '/auth/v1/signup') {
      const user = { id: '33333333-3333-4333-8333-333333333333', email: String(body?.email) };
      return this.signUpNeedsConfirmation ? json(userJson(user)) : json(sessionJson(user));
    }
    return json({ message: `unexpected ${method} ${path}` }, 404);
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let server: FakeAuthServer;
let container: HTMLDivElement;
let root: Root;
let latest: AuthContextValue | null;
let stopClient: (() => void) | null;

beforeEach(() => {
  server = new FakeAuthServer();
  vi.stubGlobal('fetch', server.fetch);
  vi.stubEnv('VITE_SUPABASE_URL', PROJECT_URL);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_daypop_test_key');
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  latest = null;
  stopClient = null;
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  stopClient?.();
  await settle(20);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

/** A fresh module graph, so supabase-js's client singleton starts over. */
async function mountProvider() {
  vi.resetModules();
  const [{ AuthProvider }, { useAuth }, { getSupabaseClient }] = await Promise.all([
    import('./AuthProvider'),
    import('./authContext'),
    import('../lib/supabase'),
  ]);
  function Probe() {
    latest = useAuth();
    return null;
  }
  act(() =>
    root.render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    ),
  );
  const client = getSupabaseClient();
  stopClient = () => void client.auth.stopAutoRefresh();
  return client;
}

function auth(): AuthContextValue {
  if (!latest) throw new Error('AuthProvider has not rendered');
  return latest;
}

async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function until(predicate: () => boolean, label: string, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await settle(10);
  }
}

function storeSession(user: TestUser, options?: { expiresIn?: number }) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionJson(user, options)));
}

const refreshRequests = () =>
  server.requests.filter((request) => request.path.includes('grant_type=refresh_token')).length;

describe('AuthProvider over supabase-js (DP-158)', () => {
  it('starts as a guest when nothing is stored, and reports Google sign-in from the project settings', async () => {
    await mountProvider();
    expect(auth().initializing).toBe(true);
    await until(() => !auth().initializing, 'initial session');
    expect(auth().user).toBeNull();
    expect(auth().configurationError).toBeNull();
    await until(() => auth().googleAuthStatus !== 'checking', 'google status');
    expect(auth().googleAuthStatus).toBe('enabled');
  });

  it.each([
    [false, 'disabled'],
    ['error', 'unavailable'],
  ] as const)('reports Google sign-in as %s → %s', async (setting, status) => {
    server.googleEnabled = setting;
    await mountProvider();
    await until(() => auth().googleAuthStatus !== 'checking', 'google status');
    expect(auth().googleAuthStatus).toBe(status);
  });

  it('restores a stored session on launch without asking the server', async () => {
    storeSession(ALICE);
    await mountProvider();
    await until(() => !auth().initializing, 'initial session');
    expect(auth().user?.id).toBe(ALICE.id);
    expect(auth().session?.user.email).toBe(ALICE.email);
    expect(refreshRequests()).toBe(0);
  });

  it('refreshes an expired stored session on launch and carries on signed in', async () => {
    storeSession(ALICE, { expiresIn: -60 });
    await mountProvider();
    await until(() => !auth().initializing, 'initial session');
    expect(refreshRequests()).toBeGreaterThan(0);
    expect(auth().user?.id).toBe(ALICE.id);
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as { expires_at: number };
    expect(stored.expires_at).toBeGreaterThan(Date.now() / 1000);
  });

  it('signs in, signs out and signs in as someone else, ending each session cleanly', async () => {
    await mountProvider();
    await until(() => !auth().initializing, 'initial session');

    await act(async () => {
      await auth().signIn(ALICE.email, 'correct-password');
    });
    await until(() => auth().user?.id === ALICE.id, 'Alice');
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain(ALICE.id);

    await act(async () => {
      await auth().signOut();
    });
    expect(auth().user).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(server.requests.some((request) => request.path.startsWith('/auth/v1/logout'))).toBe(true);

    await act(async () => {
      await auth().signIn(BOB.email, 'correct-password');
    });
    await until(() => auth().user?.id === BOB.id, 'Bob');
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toContain(ALICE.id);
  });

  it('rejects wrong credentials and stays signed out', async () => {
    await mountProvider();
    await until(() => !auth().initializing, 'initial session');
    await expect(auth().signIn(ALICE.email, 'wrong-password')).rejects.toThrow('Invalid login credentials');
    await settle(20);
    expect(auth().user).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('takes a refreshed token into the session it hands out', async () => {
    storeSession(ALICE);
    const client = await mountProvider();
    await until(() => !auth().initializing, 'initial session');
    const before = auth().session?.access_token;
    await act(async () => {
      await client.auth.refreshSession();
    });
    await until(() => auth().session?.access_token !== before, 'refreshed token');
    expect(auth().user?.id).toBe(ALICE.id);
  });

  it('opens password recovery from the emailed link, updates the password, and ends recovery on sign-out', async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    window.history.replaceState(
      null,
      '',
      `/#access_token=${accessToken(ALICE, expiresAt)}&expires_at=${expiresAt}&expires_in=3600` +
        `&refresh_token=refresh-${ALICE.id}&token_type=bearer&type=recovery`,
    );
    await mountProvider();
    await until(() => auth().isPasswordRecovery, 'recovery');
    expect(auth().user?.id).toBe(ALICE.id);
    // The tokens do not stay in the address bar.
    expect(window.location.hash).toBe('');

    await act(async () => {
      await auth().updatePassword('a-new-password');
    });
    const update = server.requests.find((request) => request.method === 'PUT' && request.path === '/auth/v1/user');
    expect(update?.body).toMatchObject({ password: 'a-new-password' });

    await act(async () => {
      await auth().signOut();
    });
    expect(auth().isPasswordRecovery).toBe(false);
  });

  it('reports whether a sign-up still needs the confirmation email', async () => {
    await mountProvider();
    await until(() => !auth().initializing, 'initial session');
    await expect(auth().signUp('new@example.test', 'correct-password')).resolves.toEqual({
      needsEmailConfirmation: true,
    });
    server.signUpNeedsConfirmation = false;
    await expect(auth().signUp('other@example.test', 'correct-password')).resolves.toEqual({
      needsEmailConfirmation: false,
    });
    const signups = server.requests.filter((request) => request.path.startsWith('/auth/v1/signup'));
    // Confirmation links come back to the App, not to Supabase's default page.
    expect(signups.every((request) => request.path.includes('redirect_to='))).toBe(true);
  });

  it('runs without a client when the project is not configured, and says why', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.resetModules();
    const [{ AuthProvider }, { useAuth }] = await Promise.all([
      import('./AuthProvider'),
      import('./authContext'),
    ]);
    function Probe() {
      latest = useAuth();
      return null;
    }
    act(() =>
      root.render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      ),
    );
    expect(auth().initializing).toBe(false);
    expect(auth().googleAuthStatus).toBe('unavailable');
    expect(auth().configurationError).toContain('VITE_SUPABASE_URL');
    await expect(auth().signIn(ALICE.email, 'correct-password')).rejects.toThrow('VITE_SUPABASE_URL');
    expect(server.requests).toHaveLength(0);
  });
});

/*
 * Launch with an expired session that cannot be refreshed — DP-176.
 *
 * Before the fix (measured with real timers, supabase-js 2.111.0, DP-158):
 * about 25.5 s and 8 refresh attempts of 載入中 before starting signed out
 * with the session still stored, and no end at all when the request hung.
 * Now launch waits at most AUTH_STARTUP_DEADLINE_MS and goes on as the
 * account this device stored; supabase-js keeps retrying behind it.
 */
describe('AuthProvider launch with an expired session that cannot be refreshed (DP-176)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it.each(['network-error', 'server-error'] as const)(
    'with %s, stops waiting at the deadline as the stored account and stays it after supabase-js gives up',
    async (mode) => {
      storeSession(ALICE, { expiresIn: -60 });
      server.refresh = mode;
      await mountProvider();
      await advance(AUTH_STARTUP_DEADLINE_MS - 1_000);
      expect(auth().initializing).toBe(true);
      await advance(2_000);
      expect(auth().initializing).toBe(false);
      expect(auth().user?.id).toBe(ALICE.id);

      // supabase-js finishes retrying with no session; the stored one stands.
      await advance(30_000);
      expect(refreshRequests()).toBeGreaterThan(1);
      expect(auth().user?.id).toBe(ALICE.id);
      expect(window.localStorage.getItem(STORAGE_KEY)).toContain(ALICE.id);
    },
  );

  it('stops waiting at the deadline when the refresh request never answers', async () => {
    storeSession(ALICE, { expiresIn: -60 });
    server.refresh = 'never';
    await mountProvider();
    await advance(AUTH_STARTUP_DEADLINE_MS + 1_000);
    expect(auth().initializing).toBe(false);
    expect(auth().user?.id).toBe(ALICE.id);
    expect(refreshRequests()).toBe(1);
  });

  it('confirms the session once the network is back and supabase-js refreshes it', async () => {
    storeSession(ALICE, { expiresIn: -60 });
    server.refresh = 'network-error';
    await mountProvider();
    await advance(40_000);
    const stale = auth().session?.access_token;
    expect(auth().user?.id).toBe(ALICE.id);

    server.refresh = 'ok';
    await advance(65_000);
    expect(auth().session?.access_token).not.toBe(stale);
    expect(auth().user?.id).toBe(ALICE.id);
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as { expires_at: number };
    expect(stored.expires_at).toBeGreaterThan(Date.now() / 1000);
  });

  it('starts as a guest when the server refuses the stored refresh token', async () => {
    storeSession(ALICE, { expiresIn: -60 });
    server.refresh = 'revoked';
    await mountProvider();
    await advance(2_000);
    expect(auth().initializing).toBe(false);
    expect(auth().user).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    // And the deadline does not bring the account back.
    await advance(AUTH_STARTUP_DEADLINE_MS);
    expect(auth().user).toBeNull();
  });

  it('opens the stored account’s cached calendar with the offline notice, not the guest one', async () => {
    storeSession(ALICE, { expiresIn: -60 });
    server.refresh = 'never';
    const cached = createEmptyUserData({ now: '2026-08-01T00:00:00.000Z' });
    cached.preferences.petName = '帳號快取的夥伴';
    writeAccountCache(ALICE.id, cached, window.localStorage);
    vi.resetModules();
    const [{ AuthProvider }, { SessionDataProvider }, { useDayPopDataState }, { getSupabaseClient }] =
      await Promise.all([
        import('./AuthProvider'),
        import('../data/SessionDataProvider'),
        import('../data/dataContext'),
        import('../lib/supabase'),
      ]);
    let state: ReturnType<typeof useDayPopDataState>['state'] | null = null;
    function Probe() {
      state = useDayPopDataState().state;
      return null;
    }
    act(() =>
      root.render(
        <AuthProvider>
          <SessionDataProvider>
            <Probe />
          </SessionDataProvider>
        </AuthProvider>,
      ),
    );
    stopClient = () => void getSupabaseClient().auth.stopAutoRefresh();
    await advance(AUTH_STARTUP_DEADLINE_MS + 2_000);

    const current = state as ReturnType<typeof useDayPopDataState>['state'] | null;
    expect(current?.status).toBe('ready');
    if (current?.status !== 'ready') return;
    expect(current.data.preferences.petName).toBe('帳號快取的夥伴');
    expect(current.warning).toBeTruthy();
    // Nothing reached Supabase's data API: those requests would wait on auth.
    expect(server.requests.some((request) => request.path.startsWith('/rest/'))).toBe(false);
  });

  /** The real tree, the stored account's cache, and a refresh that fails on the network. */
  async function mountTree() {
    storeSession(ALICE, { expiresIn: -60 });
    server.refresh = 'network-error';
    writeAccountCache(ALICE.id, createEmptyUserData({ now: '2026-08-01T00:00:00.000Z' }), window.localStorage);
    vi.resetModules();
    const [{ AuthProvider }, { SessionDataProvider }, { useDayPopDataState }, { getSupabaseClient }, { useAuth }] =
      await Promise.all([
        import('./AuthProvider'),
        import('../data/SessionDataProvider'),
        import('../data/dataContext'),
        import('../lib/supabase'),
        import('./authContext'),
      ]);
    const seen: { value: ReturnType<typeof useDayPopDataState> | null } = { value: null };
    function Probe() {
      latest = useAuth();
      seen.value = useDayPopDataState();
      return null;
    }
    act(() =>
      root.render(
        <AuthProvider>
          <SessionDataProvider>
            <Probe />
          </SessionDataProvider>
        </AuthProvider>,
      ),
    );
    stopClient = () => void getSupabaseClient().auth.stopAutoRefresh();
    await advance(AUTH_STARTUP_DEADLINE_MS + 2_000);
    return seen;
  }

  it('refuses a write at once while unconfirmed, so a form keeps its draft instead of waiting', async () => {
    const seen = await mountTree();
    expect(seen.value?.state.status).toBe('ready');
    let outcome: unknown = 'pending';
    await act(async () => {
      outcome = await seen.value!.actions.addTodo({ title: '離線新增', date: '2026-10-15' }).then(
        () => 'saved',
        (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
      );
    });
    expect(outcome).toContain('還無法連上雲端確認登入');
    expect(window.localStorage.getItem(`daypop.account-cache.${ALICE.id}`)).not.toContain('離線新增');
  });

  it('switches to Supabase once the session is confirmed', async () => {
    const seen = await mountTree();
    expect(server.requests.some((request) => request.path.startsWith('/rest/'))).toBe(false);
    server.refresh = 'ok';
    expect(auth().sessionUnconfirmed).toBe(true);
    await advance(65_000);
    expect(auth().user?.id).toBe(ALICE.id);
    expect(auth().sessionUnconfirmed).toBe(false);
    // The real repository took over and asked the data API.
    expect(server.requests.some((request) => request.path.startsWith('/rest/'))).toBe(true);
    expect(seen.value?.state.status).toBe('ready');
  });
});
