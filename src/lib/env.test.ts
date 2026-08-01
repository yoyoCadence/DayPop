import { describe, expect, it } from 'vitest';
import { readSupabasePublicConfig, SupabaseConfigurationError } from './env';

describe('readSupabasePublicConfig', () => {
  it('normalizes a valid public Supabase configuration', () => {
    expect(
      readSupabasePublicConfig({
        VITE_SUPABASE_URL: ' https://example.supabase.co/ ',
        VITE_SUPABASE_PUBLISHABLE_KEY: ' sb_publishable_example ',
      }),
    ).toEqual({
      url: 'https://example.supabase.co',
      publishableKey: 'sb_publishable_example',
    });
  });

  it('rejects missing public values without exposing a key', () => {
    expect(() => readSupabasePublicConfig({})).toThrow(SupabaseConfigurationError);
  });

  it('rejects an insecure remote URL', () => {
    expect(() =>
      readSupabasePublicConfig({
        VITE_SUPABASE_URL: 'http://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
      }),
    ).toThrow('HTTPS');
  });

  it.each(['http://localhost:54321', 'http://127.0.0.1:54321', 'http://[::1]:54321'])(
    'allows the local Supabase loopback URL %s',
    (url) => {
      expect(
        readSupabasePublicConfig({
          VITE_SUPABASE_URL: url,
          VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
        }).url,
      ).toBe(url);
    },
  );

  it('rejects non-HTTP protocols even when the hostname is localhost', () => {
    expect(() =>
      readSupabasePublicConfig({
        VITE_SUPABASE_URL: 'ftp://localhost:54321',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
      }),
    ).toThrow('HTTPS');
  });
});
