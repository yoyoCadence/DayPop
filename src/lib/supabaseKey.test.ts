import { describe, expect, it } from 'vitest';
import {
  classifySupabaseKey,
  isBrowserSafeSupabaseKey,
  describeSupabaseKeyProblem,
} from './supabaseKey';

/**
 * Every key in this file is fabricated. The JWTs are unsigned shapes built for
 * the parser — no real project, no real signature.
 */
function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.not-a-real-signature`;
}

describe('classifySupabaseKey', () => {
  it('accepts the current publishable format', () => {
    expect(classifySupabaseKey('sb_publishable_abc123')).toBe('publishable');
  });

  it('accepts a legacy anon JWT', () => {
    expect(classifySupabaseKey(fakeJwt({ iss: 'supabase', role: 'anon' }))).toBe('anon-jwt');
  });

  it('rejects a secret key', () => {
    expect(classifySupabaseKey('sb_secret_not-a-real-key')).toBe('secret');
  });

  it('rejects a legacy service_role JWT even though the bundle scan cannot see the role', () => {
    const key = fakeJwt({ iss: 'supabase', role: 'service_role' });
    // The role lives inside base64url, so a plaintext search for it finds nothing.
    expect(key.includes('service_role')).toBe(false);
    expect(classifySupabaseKey(key)).toBe('service-role-jwt');
  });

  it('rejects anything it cannot positively recognise', () => {
    expect(classifySupabaseKey(undefined)).toBe('unknown');
    expect(classifySupabaseKey('')).toBe('unknown');
    expect(classifySupabaseKey('   ')).toBe('unknown');
    expect(classifySupabaseKey('not-a-key')).toBe('unknown');
    // JWT-shaped but the payload is not base64url.
    expect(classifySupabaseKey('header.***.signature')).toBe('unknown');
    // Valid base64url, but not JSON.
    expect(classifySupabaseKey('header.aGVsbG8.signature')).toBe('unknown');
    // JSON without a role.
    expect(classifySupabaseKey(fakeJwt({ iss: 'supabase' }))).toBe('unknown');
    // A role we do not know about is not assumed to be safe.
    expect(classifySupabaseKey(fakeJwt({ role: 'authenticated' }))).toBe('unknown');
  });

  it('ignores surrounding whitespace, as a pasted value often carries it', () => {
    expect(classifySupabaseKey('  sb_publishable_abc123\n')).toBe('publishable');
    expect(classifySupabaseKey('  sb_secret_abc123\n')).toBe('secret');
  });
});

describe('isBrowserSafeSupabaseKey', () => {
  it('allows only the two browser-safe kinds', () => {
    expect(isBrowserSafeSupabaseKey('publishable')).toBe(true);
    expect(isBrowserSafeSupabaseKey('anon-jwt')).toBe(true);
    expect(isBrowserSafeSupabaseKey('secret')).toBe(false);
    expect(isBrowserSafeSupabaseKey('service-role-jwt')).toBe(false);
    expect(isBrowserSafeSupabaseKey('unknown')).toBe(false);
  });
});

describe('describeSupabaseKeyProblem', () => {
  it('names the fix for each rejected kind without quoting the key', () => {
    const secret = describeSupabaseKeyProblem('secret');
    expect(secret).toContain('sb_secret_');
    expect(secret).toContain('sb_publishable_');

    expect(describeSupabaseKeyProblem('service-role-jwt')).toContain('RLS');
    expect(describeSupabaseKeyProblem('unknown')).toContain('publishable');
  });
});
