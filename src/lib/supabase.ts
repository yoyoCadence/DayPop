import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { readSupabasePublicConfig } from './env';

let client: SupabaseClient<Database> | undefined;

function getPublicConfig() {
  return readSupabasePublicConfig({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  });
}

/**
 * Where supabase-js keeps this device's session: its own default, written out
 * and passed in explicitly so the App can read the same entry (DP-176).
 * Changing it would sign every device out.
 */
function authStorageKey(url: string): string {
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
}

export function getSupabaseClient(): SupabaseClient<Database> {
  if (client) return client;

  const config = getPublicConfig();
  client = createClient<Database>(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
      storageKey: authStorageKey(config.url),
    },
  });
  return client;
}

/**
 * The session supabase-js last stored on this device, read without asking the
 * server — DP-176.
 *
 * Only for deciding which account this device belongs to while supabase-js
 * cannot yet confirm it: a refresh that is retrying, failing on the network or
 * not answering. It may be expired. Nothing is sent with it; requests still go
 * through the client, which refreshes or rejects as it should.
 */
export function readStoredSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(authStorageKey(getPublicConfig().url));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const session = value as Partial<Session>;
    if (typeof session.access_token !== 'string' || typeof session.user?.id !== 'string') return null;
    return session as Session;
  } catch {
    return null;
  }
}

export function getAuthRedirectUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}

export async function isGoogleAuthEnabled(): Promise<boolean> {
  const config = getPublicConfig();
  const response = await fetch(`${config.url}/auth/v1/settings`, {
    headers: { apikey: config.publishableKey },
  });
  if (!response.ok) throw new Error(`Auth settings request failed (${response.status}).`);
  const settings = (await response.json()) as { external?: { google?: boolean } };
  return settings.external?.google === true;
}
