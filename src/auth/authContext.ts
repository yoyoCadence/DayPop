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
