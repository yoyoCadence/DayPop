import { INVITATION_TOKEN } from './familyService';

export const PENDING_INVITATION_KEY = 'daypop.pending-family-invitation';
const WEEK = 7 * 24 * 60 * 60 * 1000;
type IntentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type InvitationIntent = { kind: 'token'; token: string; persisted: boolean } | { kind: 'invalid' } | null;

/** Only the recipient's pending action goes in sessionStorage, to survive an
 * OAuth redirect. It is never accepted automatically or copied into user data.
 * The server still requires the matching current, verified Auth email. */
export function captureInvitationIntent(
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  storage: IntentStorage,
  replace: (url: string) => void,
  now = Date.now(),
): InvitationIntent {
  if (location.hash.startsWith('#family-invite=')) {
    const params = new URLSearchParams(location.hash.slice(1));
    const token = params.get('family-invite') ?? '';
    replace(location.pathname + location.search);
    if ([...params].length !== 1 || !INVITATION_TOKEN.test(token)) {
      clearInvitationIntent(storage);
      return { kind: 'invalid' };
    }
    let persisted = true;
    try { storage.setItem(PENDING_INVITATION_KEY, JSON.stringify({ token, capturedAt: now })); }
    catch { persisted = false; }
    return { kind: 'token', token, persisted };
  }
  try {
    const raw = storage.getItem(PENDING_INVITATION_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const saved = value as { token?: unknown; capturedAt?: unknown };
    if (typeof saved.token === 'string' && INVITATION_TOKEN.test(saved.token)
      && typeof saved.capturedAt === 'number' && Number.isFinite(saved.capturedAt)
      && now - saved.capturedAt >= 0 && now - saved.capturedAt < WEEK) {
      return { kind: 'token', token: saved.token, persisted: true };
    }
  } catch { /* An unavailable store cannot become an empty user document. */ }
  clearInvitationIntent(storage);
  return null;
}
export function clearInvitationIntent(storage: IntentStorage) {
  try { storage.removeItem(PENDING_INVITATION_KEY); } catch { /* session-only intent */ }
}
const blockedStorage: IntentStorage = { getItem: () => null, setItem: () => { throw Error('unavailable'); }, removeItem: () => {} };
export function invitationSessionStorage(): IntentStorage {
  try { return window.sessionStorage; } catch { return blockedStorage; }
}
export function readInvitationIntent(): InvitationIntent {
  return captureInvitationIntent(window.location, invitationSessionStorage(), url => window.history.replaceState(window.history.state, '', url));
}
export function invitationUrl(token: string): string {
  if (!INVITATION_TOKEN.test(token)) throw Error('Invalid invitation token');
  const url = new URL(import.meta.env.BASE_URL, window.location.origin);
  url.hash = `family-invite=${token}`;
  return url.toString();
}
