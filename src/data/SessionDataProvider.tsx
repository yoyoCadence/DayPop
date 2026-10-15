import { useMemo, type PropsWithChildren } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useAuth } from '../auth/authContext';
import type { DayPopUserData } from '../domain/types';
import type { Database } from '../lib/database.types';
import { getSupabaseClient } from '../lib/supabase';
import { LegacyImportProvider } from '../legacy/LegacyImportProvider';
import { LocalDayPopRepository } from '../storage/localRepository';
import type { StorageLike } from '../storage/browserStorage';
import { readAccountCache } from '../storage/accountCache';
import { CachedRemoteLoadError, CachedSupabaseDayPopRepository } from './cachedSupabaseRepository';
import { RemoteDataError } from './supabaseRepository';
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
  const { session, initializing, sessionUnconfirmed } = useAuth();
  const accountId = session?.user.id ?? null;
  // The stored account before supabase-js confirms it (DP-176). Its own
  // identity, so confirmation remounts onto the real repository and loads.
  const unconfirmed = Boolean(accountId && sessionUnconfirmed);
  const identity = initializing
    ? 'auth-initializing'
    : accountId
      ? unconfirmed
        ? `${accountId}:unconfirmed`
        : accountId
      : 'guest';

  const repository = useMemo<DayPopRepository>(() => {
    if (initializing) return AUTH_INITIALIZING_REPOSITORY;
    if (!accountId) return new LocalDayPopRepository(storage);
    if (unconfirmed) return unconfirmedAccountRepository(accountId, storage);
    return new CachedSupabaseDayPopRepository(
      client ?? getSupabaseClient(),
      accountId,
      storage,
    );
  }, [accountId, client, initializing, storage, unconfirmed]);

  // No legacy import while unconfirmed: its RPC would wait on supabase-js too.
  const importAccountId = unconfirmed ? null : accountId;
  return (
    <DataProvider key={identity} repository={repository}>
      <LegacyImportProvider
        accountId={importAccountId}
        client={importAccountId ? (client ?? getSupabaseClient()) : undefined}
        storage={storage}
      >
        {children}
      </LegacyImportProvider>
    </DataProvider>
  );
}

/**
 * The account this device stored, before supabase-js confirms it — DP-176.
 *
 * Every request the Supabase client makes first waits for it to finish
 * restoring the session, so a refresh that hangs or keeps retrying at launch
 * would leave the calendar on 載入中 and a save on 保存中 for as long as it
 * takes. This answers from the account's own cache straight away, with the
 * same "無法連上雲端" notice a failed load shows, and refuses writes at once so
 * a form keeps its draft and says why. Nothing is sent and nothing is written
 * to the cache. When the session is confirmed, `SessionDataProvider`
 * remounts onto the real repository and loads from Supabase.
 */
function unconfirmedAccountRepository(accountId: string, storage?: StorageLike): DayPopRepository {
  const notConfirmed = () =>
    new RemoteDataError('確認登入狀態', new Error('還無法連上雲端確認登入，請連上網路後再試'));
  const refuse = () => Promise.reject(notConfirmed());
  return {
    async load() {
      const cached = readAccountCache(accountId, storage);
      if (cached.status === 'ready') {
        throw new CachedRemoteLoadError(cached.envelope.data, notConfirmed());
      }
      throw notConfirmed();
    },
    addEvent: refuse,
    updateEvent: refuse,
    deleteEvent: refuse,
    cancelEventOccurrence: refuse,
    replaceEventOccurrence: refuse,
    addTodo: refuse,
    toggleTodo: refuse,
    renameTodo: refuse,
    setTodoPriority: refuse,
    rescheduleTodo: refuse,
    deleteTodo: refuse,
    addSticker: refuse,
    deleteSticker: refuse,
    addCalendar: refuse,
    updateCalendar: refuse,
    deleteCalendar: refuse,
    importData: refuse,
    updatePreferences: refuse,
  };
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
  cancelEventOccurrence: unavailable,
  replaceEventOccurrence: unavailable,
  addTodo: unavailable,
  toggleTodo: unavailable,
  renameTodo: unavailable,
  setTodoPriority: unavailable,
  rescheduleTodo: unavailable,
  deleteTodo: unavailable,
  addSticker: unavailable,
  deleteSticker: unavailable,
  addCalendar: unavailable,
  updateCalendar: unavailable,
  deleteCalendar: unavailable,
  importData: unavailable,
  updatePreferences: unavailable,
};
