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
});
