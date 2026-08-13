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

  // DP-033: the build refuses a privileged key, but a browser must never create
  // a client with one either — the two gates are independent on purpose.
  it('refuses to build a client from a secret key', () => {
    expect(() =>
      readSupabasePublicConfig({
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_not-a-real-key',
      }),
    ).toThrow(SupabaseConfigurationError);
  });

  it('refuses a legacy service_role JWT', () => {
    // Fabricated, unsigned, and shaped only for the parser.
    const encode = (value: object) =>
      btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    const serviceRole = `${encode({ alg: 'HS256' })}.${encode({ role: 'service_role' })}.sig`;

    expect(() =>
      readSupabasePublicConfig({
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: serviceRole,
      }),
    ).toThrow(SupabaseConfigurationError);
  });

  it('does not put the rejected key in the error message', () => {
    const key = 'sb_secret_not-a-real-key';
    try {
      readSupabasePublicConfig({
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: key,
      });
      expect.unreachable('a secret key must be rejected');
    } catch (error) {
      expect((error as Error).message).not.toContain(key);
    }
  });
});
