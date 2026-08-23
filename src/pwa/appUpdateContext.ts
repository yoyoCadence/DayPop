import { createContext, useContext } from 'react';
import type { AppUpdateState } from './useAppUpdate';

/**
 * Publishes one `useAppUpdate()` instance to the whole app — DP-073.
 *
 * `App` used to own the hook, but it sits inside `SessionDataProvider`'s
 * `<DataProvider key={identity}>`. That key changes once on every cold start,
 * from `'auth-initializing'` to `'guest'` or an account id, which unmounts and
 * remounts the entire subtree — so the hook ran twice and `version.json` was
 * fetched twice, one millisecond apart. The keyed remount is a deliberate
 * safety boundary (guest and two different accounts must never share state)
 * and is not the thing to change.
 *
 * A version check has nothing to do with which account is signed in, so the
 * fix is to stop hosting it inside an account-scoped subtree. The provider is
 * mounted above the keyed one; the throttle DP-035 added lives in a ref that
 * now survives, because nothing unmounts it.
 */
export const AppUpdateContext = createContext<AppUpdateState | null>(null);

export function useAppUpdateState(): AppUpdateState {
  const value = useContext(AppUpdateContext);
  if (!value) throw new Error('useAppUpdateState 必須在 AppUpdateProvider 內使用。');
  return value;
}
