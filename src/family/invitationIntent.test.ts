import { describe, expect, it } from 'vitest';
import { captureInvitationIntent, clearInvitationIntent, PENDING_INVITATION_KEY } from './invitationIntent';

const TOKEN = 'b'.repeat(64);
const NOW = Date.parse('2026-10-18T00:00:00Z');
function storage() {
  const entries = new Map<string, string>([['daypop.user-data', 'untouched']]);
  return { entries, getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
}
describe('invitation intent at the URL boundary', () => {
  it('keeps a bound token in session storage, removes it from the address, and never accepts it', () => {
    const cache = storage(); const replaced: string[] = [];
    const result = captureInvitationIntent({ hash: `#family-invite=${TOKEN}`, pathname: '/DayPop/', search: '?a=1' }, cache, url => replaced.push(url), NOW);
    expect(result).toEqual({ kind: 'token', token: TOKEN, persisted: true });
    expect(replaced).toEqual(['/DayPop/?a=1']);
    expect(cache.entries.get('daypop.user-data')).toBe('untouched');
    expect(captureInvitationIntent({ hash: '#access_token=auth-value', pathname: '/', search: '' }, cache, () => { throw Error('must not remove Auth hash'); }, NOW)).toEqual(result);
  });
  it('rejects invalid or compounded invitation fragments', () => {
    for (const hash of ['#family-invite=short', `#family-invite=${TOKEN}&role=owner`, `#family-invite=${TOKEN}&family-invite=${TOKEN}`]) {
      expect(captureInvitationIntent({ hash, pathname: '/', search: '' }, storage(), () => {}, NOW)).toEqual({ kind: 'invalid' });
    }
  });
  it('can keep the current link in memory if session storage is blocked', () => {
    const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
    expect(captureInvitationIntent({ hash: `#family-invite=${TOKEN}`, pathname: '/', search: '' }, blocked, () => {}, NOW)).toEqual({ kind: 'token', token: TOKEN, persisted: false });
  });
  it('does not restore corrupt or week-old intentions', () => {
    const cache = storage();
    for (const raw of ['{bad', JSON.stringify({ token: TOKEN, capturedAt: NOW - 8 * 86400000 }), JSON.stringify({ token: 'bad', capturedAt: NOW })]) {
      cache.setItem(PENDING_INVITATION_KEY, raw);
      expect(captureInvitationIntent({ hash: '', pathname: '/', search: '' }, cache, () => {}, NOW)).toBeNull();
    }
    clearInvitationIntent(cache);
    expect(cache.entries.get('daypop.user-data')).toBe('untouched');
  });
});
