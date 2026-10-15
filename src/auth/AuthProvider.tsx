import { useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';
import {
  getAuthRedirectUrl,
  getSupabaseClient,
  isGoogleAuthEnabled,
  readStoredSession,
} from '../lib/supabase';
import {
  AuthContext,
  type AuthContextValue,
  type GoogleAuthStatus,
  type SignUpResult,
} from './authContext';

interface ClientResolution {
  client: SupabaseClient<Database> | null;
  error: string | null;
}

/**
 * How long launch waits for supabase-js to confirm the stored session — DP-176.
 *
 * Until it answers, the data layer can only show 載入中. An expired session
 * whose refresh fails on the network or with a 5xx is retried for about 25 s,
 * and one whose request never answers has no end at all (measured with
 * supabase-js 2.111.0, DP-158). A session that is still valid, or no session,
 * answers at once and never reaches this.
 */
export const AUTH_STARTUP_DEADLINE_MS = 8_000;

export function AuthProvider({ children }: PropsWithChildren) {
  const [resolution] = useState<ClientResolution>(() => {
    try {
      return { client: getSupabaseClient(), error: null };
    } catch (error) {
      return {
        client: null,
        error: error instanceof Error ? error.message : 'Supabase 設定無法讀取。',
      };
    }
  });
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(Boolean(resolution.client));
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [sessionUnconfirmed, setSessionUnconfirmed] = useState(false);
  const [googleAuthStatus, setGoogleAuthStatus] = useState<GoogleAuthStatus>(
    resolution.client ? 'checking' : 'unavailable',
  );

  useEffect(() => {
    const client = resolution.client;
    if (!client) return;

    let active = true;
    let answered = false;
    // Past the deadline, go on as the account this device last stored. Its
    // cached data opens with the existing "無法連上雲端" notice, instead of an
    // endless 載入中 or a guest calendar that is not this person's (DP-176).
    // supabase-js keeps trying, and its next event replaces this session.
    const deadline = window.setTimeout(() => {
      if (!active || answered) return;
      const stored = readStoredSession();
      setSession(stored);
      setSessionUnconfirmed(stored !== null);
      setInitializing(false);
    }, AUTH_STARTUP_DEADLINE_MS);

    const { data } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      answered = true;
      // No initial session while one is still stored means its refresh failed
      // in a way supabase-js will retry (network, 5xx); a refresh token the
      // server refuses is removed from storage, and that reads as signed out.
      const fallback = event === 'INITIAL_SESSION' && !nextSession ? readStoredSession() : null;
      setSession(fallback ?? nextSession);
      setSessionUnconfirmed(fallback !== null);
      if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true);
      if (event === 'SIGNED_OUT') setIsPasswordRecovery(false);
      setInitializing(false);
    });

    void isGoogleAuthEnabled()
      .then((enabled) => {
        if (active) setGoogleAuthStatus(enabled ? 'enabled' : 'disabled');
      })
      .catch(() => {
        if (active) setGoogleAuthStatus('unavailable');
      });

    return () => {
      active = false;
      window.clearTimeout(deadline);
      data.subscription.unsubscribe();
    };
  }, [resolution.client]);

  const value = useMemo<AuthContextValue>(() => {
    function requireClient(): SupabaseClient<Database> {
      if (!resolution.client) throw new Error(resolution.error ?? 'Supabase 尚未設定。');
      return resolution.client;
    }

    return {
      session,
      user: session?.user ?? null,
      initializing,
      isPasswordRecovery,
      googleAuthStatus,
      configurationError: resolution.error,
      sessionUnconfirmed,
      async signIn(email, password) {
        const { error } = await requireClient().auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      async signUp(email, password): Promise<SignUpResult> {
        const { data, error } = await requireClient().auth.signUp({
          email,
          password,
          options: { emailRedirectTo: getAuthRedirectUrl() },
        });
        if (error) throw error;
        return { needsEmailConfirmation: !data.session };
      },
      async signInWithGoogle() {
        const { error } = await requireClient().auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: getAuthRedirectUrl() },
        });
        if (error) throw error;
      },
      async requestPasswordReset(email) {
        const { error } = await requireClient().auth.resetPasswordForEmail(email, {
          redirectTo: getAuthRedirectUrl(),
        });
        if (error) throw error;
      },
      async updatePassword(password) {
        const { error } = await requireClient().auth.updateUser({ password });
        if (error) throw error;
      },
      dismissPasswordRecovery() {
        setIsPasswordRecovery(false);
      },
      async signOut() {
        const { error } = await requireClient().auth.signOut();
        if (error) throw error;
        setSession(null);
      },
    };
  }, [
    googleAuthStatus,
    initializing,
    isPasswordRecovery,
    sessionUnconfirmed,
    resolution.client,
    resolution.error,
    session,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
