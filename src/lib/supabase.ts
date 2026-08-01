import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { readSupabasePublicConfig } from './env';

let client: SupabaseClient<Database> | undefined;

function getPublicConfig() {
  return readSupabasePublicConfig({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  });
}

export function getSupabaseClient(): SupabaseClient<Database> {
  if (client) return client;

  const config = getPublicConfig();
  client = createClient<Database>(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });
  return client;
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
