/* Dev-only entry: preserving component state across HMR is irrelevant to isolated e2e runs. */
/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState, type PropsWithChildren } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session, User } from '@supabase/supabase-js';
import App from '../App';
import { AuthContext, type AuthContextValue } from '../auth/authContext';
import { SessionDataProvider } from '../data/SessionDataProvider';
import { calendarToInsert, preferencesToInsert } from '../domain/databaseMapping';
import { createEmptyUserData } from '../domain/types';
import { ThemeProvider } from '../theme/ThemeProvider';
import { FakeSupabase } from './fakeSupabase';
import '../theme/fonts.css';
import '../styles.css';

const E2E_ACCOUNT_ID = '00000000-0000-4000-8000-000000000030';
const E2E_CALENDAR_ID = '00000000-0000-4000-8000-000000000031';
const E2E_EMAIL = 'daypop-e2e@example.test';
const E2E_PASSWORD = 'daypop-e2e-password';
const E2E_NOW = '2026-08-09T00:00:00.000Z';

/**
 * Dev-server-only browser harness for deterministic authenticated e2e.
 *
 * The production Vite entry remains index.html → src/main.tsx. This HTML is
 * outside the production build graph and injects only fake credentials and an
 * in-memory Supabase surface, while retaining the real App, data provider,
 * authenticated repository and attachment boundary.
 */
const fakeSupabase = new FakeSupabase();
seedAccount(fakeSupabase);

function seedAccount(database: FakeSupabase) {
  const data = createEmptyUserData({
    idFactory: () => E2E_CALENDAR_ID,
    now: E2E_NOW,
  });
  database.serverTime = E2E_NOW;
  database.seed('calendars', [
    {
      ...calendarToInsert(data.calendars[0]!, E2E_ACCOUNT_ID),
      created_at: E2E_NOW,
      updated_at: E2E_NOW,
    },
  ]);
  database.seed('user_preferences', [
    {
      ...preferencesToInsert(data.preferences, E2E_ACCOUNT_ID),
      created_at: E2E_NOW,
      updated_at: E2E_NOW,
    },
  ]);
  for (const table of [
    'events',
    'event_attachments',
    'event_exceptions',
    'todos',
    'stickers',
    'attachment_cleanup_jobs',
  ]) {
    database.seed(table, []);
  }
}

function E2EAuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      initializing: false,
      isPasswordRecovery: false,
      googleAuthStatus: 'disabled',
      configurationError: null,
      async signIn(email, password) {
        if (email !== E2E_EMAIL || password !== E2E_PASSWORD) {
          throw new Error('Invalid login credentials');
        }
        setSession(createSession(email));
      },
      async signUp(email, password) {
        if (password.length < 8) throw new Error('密碼至少需要 8 個字元。');
        setSession(createSession(email));
        return { needsEmailConfirmation: false };
      },
      async signInWithGoogle() {
        throw new Error('E2E harness 不啟用 Google 登入。');
      },
      async requestPasswordReset() {},
      async updatePassword() {},
      dismissPasswordRecovery() {},
      async signOut() {
        setSession(null);
      },
    }),
    [session],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function createSession(email: string): Session {
  const user = {
    id: E2E_ACCOUNT_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    email_confirmed_at: E2E_NOW,
    phone: '',
    confirmed_at: E2E_NOW,
    last_sign_in_at: E2E_NOW,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: E2E_NOW,
    updated_at: E2E_NOW,
    is_anonymous: false,
  } as User;
  return {
    access_token: 'e2e-access-token',
    refresh_token: 'e2e-refresh-token',
    expires_in: 3600,
    expires_at: 1_786_236_000,
    token_type: 'bearer',
    user,
  };
}

createRoot(document.getElementById('root')!).render(
  <E2EAuthProvider>
    <SessionDataProvider client={fakeSupabase.asClient()} storage={window.localStorage}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </SessionDataProvider>
  </E2EAuthProvider>,
);
