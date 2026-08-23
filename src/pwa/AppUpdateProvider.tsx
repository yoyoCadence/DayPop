import type { ReactNode } from 'react';
import { AppUpdateContext } from './appUpdateContext';
import { useAppUpdate } from './useAppUpdate';

export interface AppUpdateProviderProps {
  children: ReactNode;
}

/**
 * Owns the single `useAppUpdate()` instance — DP-073. See `appUpdateContext.ts`
 * for why it cannot live inside the account-keyed subtree.
 *
 * Mount this above `SessionDataProvider`. It depends on nothing else: the
 * release check reads `version.json` and the service worker registration, and
 * neither is account-scoped.
 */
export function AppUpdateProvider({ children }: AppUpdateProviderProps) {
  const updater = useAppUpdate();
  return <AppUpdateContext.Provider value={updater}>{children}</AppUpdateContext.Provider>;
}
