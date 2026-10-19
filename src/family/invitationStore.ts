import { useSyncExternalStore } from 'react';
import { clearInvitationIntent, invitationSessionStorage, readInvitationIntent, type InvitationIntent } from './invitationIntent';

let current: InvitationIntent = null;
let initialized = false;
const listeners = new Set<() => void>();
function capture() {
  if (!initialized || window.location.hash.startsWith('#family-invite=')) {
    initialized = true;
    current = readInvitationIntent();
    for (const listener of listeners) listener();
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('hashchange', capture);
  capture();
  return () => { listeners.delete(listener); window.removeEventListener('hashchange', capture); };
}
export function dismissInvitationIntent() {
  current = null;
  clearInvitationIntent(invitationSessionStorage());
  for (const listener of listeners) listener();
}
/** Capture outside React render; the in-memory value survives account-keyed
 * remounts even when sessionStorage is unavailable. OAuth needs that store. */
export function useInvitationIntent() { return useSyncExternalStore(subscribe, () => current, () => null); }
