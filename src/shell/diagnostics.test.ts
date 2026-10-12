import { describe, expect, it } from 'vitest';
import { buildDiagnostics } from './diagnostics';

/**
 * DP-146. What the user can paste into a message when a screen fails. The
 * owner's rule: version, screen and error type — never event text,
 * attachments, an email address or anything that could be a credential.
 */
const NOW = new Date('2026-10-12T03:04:05.000Z');

describe('buildDiagnostics', () => {
  it('lists the version, the screen, the error type and the time, one per line', () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'title')");
    expect(buildDiagnostics({ error, screen: '搜尋', now: NOW, version: '0.4.2' })).toBe(
      ['日蹦診斷資訊', '版本：0.4.2', '畫面：搜尋', '錯誤類型：TypeError', '發生時間：2026-10-12T03:04:05.000Z'].join('\n'),
    );
  });

  it('defaults the version to the build being run', () => {
    const text = buildDiagnostics({ error: new Error('x'), screen: '日曆', now: NOW });
    expect(text).toContain(`版本：${__APP_VERSION__}`);
  });

  it('never includes the error message, which can carry what the user wrote', () => {
    // A message is free text: an exception thrown while handling a row can
    // quote its title, a failed request can echo a server reply.
    const error = new Error('無法保存「和醫生約診」user@example.com token=eyJhbGciOi');
    const text = buildDiagnostics({ error, screen: '日曆', now: NOW, version: '0.4.2' });
    expect(text).not.toContain('和醫生約診');
    expect(text).not.toContain('user@example.com');
    expect(text).not.toContain('eyJ');
    expect(text).not.toContain(error.message);
    expect(text).toContain('錯誤類型：Error');
  });

  it('reduces an unusual error name to a safe label', () => {
    // `name` is normally a constructor name, but code can set it to anything.
    const odd = new Error('x');
    odd.name = '和醫生約診 user@example.com';
    expect(buildDiagnostics({ error: odd, screen: '日曆', now: NOW, version: '0.4.2' })).toContain('錯誤類型：（其他）');
    const blank = new Error('x');
    blank.name = '';
    expect(buildDiagnostics({ error: blank, screen: '日曆', now: NOW, version: '0.4.2' })).toContain('錯誤類型：（其他）');
  });
});
