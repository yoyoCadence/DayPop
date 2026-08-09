import { useMemo, type PropsWithChildren } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useAuth } from '../auth/authContext';
import type { DayPopUserData } from '../domain/types';
import type { Database } from '../lib/database.types';
import { getSupabaseClient } from '../lib/supabase';
import { LegacyImportProvider } from '../legacy/LegacyImportProvider';
import { LocalDayPopRepository } from '../storage/localRepository';
import type { StorageLike } from '../storage/browserStorage';
import { CachedSupabaseDayPopRepository } from './cachedSupabaseRepository';
import { DataProvider } from './DataProvider';
import type { DayPopRepository } from './repository';

export interface SessionDataProviderProps {
  /** Tests inject a stub; production uses the singleton publishable-key client. */
  client?: SupabaseClient<Database>;
  /** Tests inject isolated memory storage. */
  storage?: StorageLike;
}

/**
 * Chooses exactly one data identity after Supabase Auth resolves its session.
 *
 * The keyed DataProvider remount is a security boundary: guest, account A and
 * account B never share a React snapshot or pending mutation queue. Token
 * refreshes keep the same user id and therefore keep the same repository.
 */
export function SessionDataProvider({
  children,
  client,
  storage,
}: PropsWithChildren<SessionDataProviderProps>) {
  const { session, initializing } = useAuth();
  const accountId = session?.user.id ?? null;
  const identity = initializing ? 'auth-initializing' : accountId ?? 'guest';

  const repository = useMemo<DayPopRepository>(() => {
    if (initializing) return AUTH_INITIALIZING_REPOSITORY;
    if (!accountId) return new LocalDayPopRepository(storage);
    return new CachedSupabaseDayPopRepository(
      client ?? getSupabaseClient(),
      accountId,
      storage,
    );
  }, [accountId, client, initializing, storage]);

  return (
    <DataProvider key={identity} repository={repository}>
      <LegacyImportProvider
        accountId={accountId}
        client={accountId ? (client ?? getSupabaseClient()) : undefined}
        storage={storage}
      >
        {children}
      </LegacyImportProvider>
    </DataProvider>
  );
}

function neverLoads(): Promise<DayPopUserData> {
  return new Promise(() => {});
}

function unavailable(): Promise<DayPopUserData> {
  return Promise.reject(new Error('Auth session 尚未初始化。'));
}

const AUTH_INITIALIZING_REPOSITORY: DayPopRepository = {
  load: neverLoads,
  addEvent: unavailable,
  updateEvent: unavailable,
  deleteEvent: unavailable,
  addTodo: unavailable,
  toggleTodo: unavailable,
  deleteTodo: unavailable,
  addSticker: unavailable,
  deleteSticker: unavailable,
  addCalendar: unavailable,
  updateCalendar: unavailable,
  deleteCalendar: unavailable,
  updatePreferences: unavailable,
};
