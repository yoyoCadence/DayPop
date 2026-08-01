import { useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';
import { getAuthRedirectUrl, getSupabaseClient, isGoogleAuthEnabled } from '../lib/supabase';
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
  const [googleAuthStatus, setGoogleAuthStatus] = useState<GoogleAuthStatus>(
    resolution.client ? 'checking' : 'unavailable',
  );

  useEffect(() => {
    const client = resolution.client;
    if (!client) return;

    let active = true;
    const { data } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
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
    resolution.client,
    resolution.error,
    session,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
