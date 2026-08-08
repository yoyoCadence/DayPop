import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy } from './csp';

function directive(policy: string, name: string): string | undefined {
  return policy
    .split('; ')
    .find((part) => part === name || part.startsWith(`${name} `))
    ?.slice(name.length)
    .trim();
}

describe('buildContentSecurityPolicy', () => {
  it('keeps everything same-origin when no Supabase project is configured', () => {
    const policy = buildContentSecurityPolicy();

    expect(directive(policy, 'default-src')).toBe("'self'");
    expect(directive(policy, 'script-src')).toBe("'self'");
    expect(directive(policy, 'connect-src')).toBe("'self'");
    expect(policy).not.toContain('unpkg');
  });

  it('allows data: fonts, because Vite inlines small font files', () => {
    // Verified in a real browser: without `data:`, three theme fonts are
    // blocked outright — the stylesheet carries them as base64.
    expect(directive(buildContentSecurityPolicy(), 'font-src')).toBe("'self' data:");
  });

  it('allows the Supabase origin over https and wss', () => {
    const policy = buildContentSecurityPolicy({
      supabaseUrl: 'https://abcdef.supabase.co',
    });

    expect(directive(policy, 'connect-src')).toBe(
      "'self' https://abcdef.supabase.co wss://abcdef.supabase.co",
    );
  });

  it('reduces a URL with a path to its origin', () => {
    const policy = buildContentSecurityPolicy({
      supabaseUrl: 'https://abcdef.supabase.co/rest/v1?x=1',
    });

    expect(directive(policy, 'connect-src')).toBe(
      "'self' https://abcdef.supabase.co wss://abcdef.supabase.co",
    );
  });

  it('supports a local Supabase stack over http', () => {
    const policy = buildContentSecurityPolicy({ supabaseUrl: 'http://localhost:54321' });

    expect(directive(policy, 'connect-src')).toBe(
      "'self' http://localhost:54321 ws://localhost:54321",
    );
  });

  it('ignores an unusable value instead of emitting a broken directive', () => {
    for (const value of ['', '   ', 'not-a-url', 'ftp://example.com']) {
      expect(directive(buildContentSecurityPolicy({ supabaseUrl: value }), 'connect-src')).toBe(
        "'self'",
      );
    }
  });

  it('allows style attributes but not injected style elements', () => {
    const policy = buildContentSecurityPolicy();

    // React writes `style` attributes; `<style>` injection stays blocked.
    expect(directive(policy, 'style-src')).toBe("'self'");
    expect(directive(policy, 'style-src-attr')).toBe("'unsafe-inline'");
  });

  it('locks down the directives that have no legitimate use here', () => {
    const policy = buildContentSecurityPolicy();

    expect(directive(policy, 'object-src')).toBe("'none'");
    expect(directive(policy, 'frame-src')).toBe("'none'");
    expect(directive(policy, 'base-uri')).toBe("'self'");
    expect(directive(policy, 'form-action')).toBe("'self'");
  });
});
