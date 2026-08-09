import { act } from 'react';
import type { Session } from '@supabase/supabase-js';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/authContext';
import { LocalDayPopRepository } from '../storage/localRepository';
import { MemoryStorage } from '../storage/browserStorage';
import { readAccountCache } from '../storage/accountCache';
import { FakeSupabase, type FakeRow } from '../test/fakeSupabase';
import { useDayPopDataState, type DataContextValue } from './dataContext';
import { SessionDataProvider } from './SessionDataProvider';

const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';
const CALENDAR_A = '33333333-3333-4333-8333-333333333333';
const CALENDAR_B = '44444444-4444-4444-8444-444444444444';

let container: HTMLDivElement;
let root: Root;
const seen: DataContextValue[] = [];

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  seen.length = 0;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function Probe() {
  const value = useDayPopDataState();
  seen.push(value);
  return <span>{value.state.status}</span>;
}

function latest(): DataContextValue {
  const value = seen.at(-1);
  if (!value) throw new Error('probe never rendered');
  return value;
}

function calendarRow(ownerId: string, id: string, name: string): FakeRow {
  return {
    id,
    owner_id: ownerId,
    name,
    color: '#F06C5C',
    is_visible: true,
    is_default: true,
    sort_order: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}

function preferencesRow(ownerId: string): FakeRow {
  return {
    user_id: ownerId,
    timezone: 'Asia/Taipei',
    week_starts_on: 0,
    theme: 'light',
    theme_id: 'manga',
    fixed_six_week_grid: false,
    default_reminder_minutes: [],
    pet_name: '摩卡',
    pet_enabled: true,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}

function bootstrappedAccounts(): FakeSupabase {
  const db = new FakeSupabase();
  db.seed('calendars', [
    calendarRow(OWNER_A, CALENDAR_A, '帳號 A'),
    calendarRow(OWNER_B, CALENDAR_B, '帳號 B'),
  ]);
  db.seed('user_preferences', [preferencesRow(OWNER_A), preferencesRow(OWNER_B)]);
  return db;
}

function authValue(accountId: string | null, initializing = false): AuthContextValue {
  const session = accountId
    ? ({ user: { id: accountId } } as unknown as Session)
    : null;
  return {
    session,
    user: session?.user ?? null,
    initializing,
    isPasswordRecovery: false,
    googleAuthStatus: 'disabled',
    configurationError: null,
    signIn: async () => {},
    signUp: async () => ({ needsEmailConfirmation: false }),
    signInWithGoogle: async () => {},
    requestPasswordReset: async () => {},
    updatePassword: async () => {},
    dismissPasswordRecovery: () => {},
    signOut: async () => {},
  };
}

async function renderSession(
  auth: AuthContextValue,
  db: FakeSupabase,
  storage: MemoryStorage,
) {
  await act(async () => {
    root.render(
      <AuthContext.Provider value={auth}>
        <SessionDataProvider client={db.asClient()} storage={storage}>
          <Probe />
        </SessionDataProvider>
      </AuthContext.Provider>,
    );
  });
}

describe('SessionDataProvider', () => {
  it('does not expose guest data before Auth resolves the initial session', async () => {
    const storage = new MemoryStorage();
    const guest = new LocalDayPopRepository(storage);
    await guest.load();
    await guest.addTodo({ title: '訪客資料', date: '2026-08-08' });

    await renderSession(authValue(null, true), bootstrappedAccounts(), storage);

    expect(latest().state.status).toBe('loading');
    expect(seen.some((value) => value.state.status === 'ready')).toBe(false);
  });

  it('uses Supabase for signed-in CRUD and caches only confirmed rows', async () => {
    const storage = new MemoryStorage();
    const db = bootstrappedAccounts();
    await renderSession(authValue(OWNER_A), db, storage);

    await act(async () => {
      latest().actions.addTodo({ title: '雲端待辦', date: '2026-08-08' });
    });

    expect(db.rows('todos')).toEqual([
      expect.objectContaining({ owner_id: OWNER_A, title: '雲端待辦' }),
    ]);
    const cached = readAccountCache(OWNER_A, storage);
    expect(cached.status === 'ready' ? cached.envelope.data.todos[0]?.title : null).toBe(
      '雲端待辦',
    );
  });

  it('discards the previous snapshot when switching accounts', async () => {
    const storage = new MemoryStorage();
    const db = bootstrappedAccounts();
    await renderSession(authValue(OWNER_A), db, storage);
    const accountAState = latest().state;
    expect(
      accountAState.status === 'ready'
        ? accountAState.data.calendars[0]?.name
        : null,
    ).toBe('帳號 A');

    await renderSession(authValue(OWNER_B), db, storage);

    const state = latest().state;
    expect(state.status === 'ready' ? state.data.calendars.map((item) => item.name) : []).toEqual([
      '帳號 B',
    ]);
  });

  it('restores the separate guest document after sign-out', async () => {
    const storage = new MemoryStorage();
    const guest = new LocalDayPopRepository(storage);
    await guest.load();
    await guest.addTodo({ title: '訪客資料', date: '2026-08-08' });
    const db = bootstrappedAccounts();

    await renderSession(authValue(OWNER_A), db, storage);
    await renderSession(authValue(null), db, storage);

    const state = latest().state;
    expect(state.status === 'ready' ? state.data.todos.map((item) => item.title) : []).toEqual([
      '訪客資料',
    ]);
    expect(state.status === 'ready' ? state.data.calendars[0]?.name : null).toBe('我的日曆');
  });

  it('uses only the same account cache during a transient reload failure', async () => {
    const storage = new MemoryStorage();
    const db = bootstrappedAccounts();
    await renderSession(authValue(OWNER_A), db, storage);
    await renderSession(authValue(null), db, storage);
    db.failures.set('events', 'network unavailable');

    await renderSession(authValue(OWNER_A), db, storage);

    const state = latest().state;
    expect(state.status).toBe('ready');
    expect(state.status === 'ready' ? state.warning?.kind : null).toBe('cached');
    expect(state.status === 'ready' ? state.data.calendars[0]?.name : null).toBe('帳號 A');
    expect(readAccountCache(OWNER_B, storage).status).toBe('missing');
  });

  it('never falls back to another account cache', async () => {
    const storage = new MemoryStorage();
    const db = bootstrappedAccounts();
    await renderSession(authValue(OWNER_A), db, storage);
    db.failures.set('events', 'network unavailable');

    await renderSession(authValue(OWNER_B), db, storage);

    expect(latest().state.status).toBe('failed');
  });
});
