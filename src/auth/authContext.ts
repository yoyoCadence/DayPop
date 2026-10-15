import { createContext, useContext } from 'react';
import type { Session, User } from '@supabase/supabase-js';

export interface SignUpResult {
  needsEmailConfirmation: boolean;
}

export type GoogleAuthStatus = 'checking' | 'enabled' | 'disabled' | 'unavailable';

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  initializing: boolean;
  isPasswordRecovery: boolean;
  googleAuthStatus: GoogleAuthStatus;
  configurationError: string | null;
  /**
   * True only while `session` is the one this device stored and supabase-js
   * has not confirmed it yet: its refresh is retrying, failing on the network
   * or not answering at launch (DP-176). Requests made with it would wait on
   * supabase-js, so the data layer shows the account's cache instead and
   * refuses writes until a real auth event arrives. Absent means confirmed.
   */
  sessionUnconfirmed?: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<SignUpResult>;
  signInWithGoogle(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  dismissPasswordRecovery(): void;
  signOut(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth 必須在 AuthProvider 內使用。');
  return value;
}
