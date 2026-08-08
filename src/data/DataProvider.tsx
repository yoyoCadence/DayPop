import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import type { DayPopUserData } from '../domain/types';
import { LocalDataBlockedError, LocalDayPopRepository } from '../storage/localRepository';
import { DataContext, type DataActions, type DataContextValue, type DataState } from './dataContext';
import { canLoadSync, type DayPopRepository } from './repository';

interface DataProviderProps {
  /** Injected by tests. Production uses the guest adapter — see below. */
  repository?: DayPopRepository;
}

/**
 * Owns the active repository and the one copy of the user's data.
 *
 * This is the seam the whole boundary exists for. Screens ask for data and
 * writes; only this component knows which adapter is answering.
 *
 * It is still always the guest adapter. Choosing `SupabaseDayPopRepository`
 * once a session exists — plus the device cache and transient-failure
 * handling that goes with it — is DP-026; doing it here would mean writing to
 * real accounts before that task has verified RLS and reload behaviour.
 */
export function DataProvider({ children, repository }: PropsWithChildren<DataProviderProps>) {
  const activeRepository = useMemo(
    () => repository ?? new LocalDayPopRepository(),
    [repository],
  );
  const [state, setState] = useState<DataState>(() => bootstrap(activeRepository));
  // Bumping this re-runs the async load; the recovery screen uses it after a reset.
  const [generation, setGeneration] = useState(0);
  const pendingWrite = useRef<Promise<void>>(Promise.resolve());

  const refresh = useCallback(() => {
    setState(bootstrap(activeRepository));
    setGeneration((current) => current + 1);
  }, [activeRepository]);

  // Only runs for adapters that cannot answer synchronously. The guest adapter
  // has already produced `ready` above, so the first paint shows real data.
  useEffect(() => {
    if (state.status !== 'loading') return;
    let active = true;
    void activeRepository.load().then(
      (data) => {
        if (active) setState({ status: 'ready', data });
      },
      (error: unknown) => {
        if (active) setState(toFailureState(error));
      },
    );
    return () => {
      active = false;
    };
  }, [activeRepository, state.status, generation]);

  const actions = useMemo<DataActions>(() => {
    /**
     * Writes stay fire-and-forget from the UI's point of view, but reach the
     * repository in call order. Remote methods read and replace their shared
     * snapshot, so merely ignoring a stale response would still allow an
     * earlier request to overwrite durable data after a later request.
     *
     * Both branches handle the result and therefore leave the queue tail
     * resolved. A rejected write reports its failure without poisoning the
     * queue or preventing a write the user already issued from running next.
     */
    function run(operation: () => Promise<DayPopUserData>) {
      pendingWrite.current = pendingWrite.current
        .then(operation)
        .then(
          (data) => setState({ status: 'ready', data }),
          (error: unknown) => setState(toFailureState(error)),
        );
    }

    return {
      addEvent(input) {
        if (!input.title.trim()) return;
        run(() => activeRepository.addEvent(input));
      },
      updateEvent(id, patch) {
        run(() => activeRepository.updateEvent(id, patch));
      },
      deleteEvent(id) {
        run(() => activeRepository.deleteEvent(id));
      },
      addTodo(input) {
        if (!input.title.trim()) return;
        run(() => activeRepository.addTodo(input));
      },
      toggleTodo(id) {
        run(() => activeRepository.toggleTodo(id));
      },
      deleteTodo(id) {
        run(() => activeRepository.deleteTodo(id));
      },
      addSticker(input) {
        if (!input.glyph.trim()) return;
        run(() => activeRepository.addSticker(input));
      },
      deleteSticker(id) {
        run(() => activeRepository.deleteSticker(id));
      },
      addCalendar(input) {
        run(() => activeRepository.addCalendar(input));
      },
      updateCalendar(id, patch) {
        run(() => activeRepository.updateCalendar(id, patch));
      },
      deleteCalendar(id) {
        run(() => activeRepository.deleteCalendar(id));
      },
      updatePreferences(patch) {
        run(() => activeRepository.updatePreferences(patch));
      },
    };
  }, [activeRepository]);

  const value = useMemo<DataContextValue>(
    () => ({ state, actions, refresh }),
    [actions, refresh, state],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

function bootstrap(repository: DayPopRepository): DataState {
  if (!canLoadSync(repository)) return { status: 'loading' };
  try {
    return { status: 'ready', data: repository.loadSync() };
  } catch (error) {
    return toFailureState(error);
  }
}

function toFailureState(error: unknown): DataState {
  if (error instanceof LocalDataBlockedError) {
    return { status: 'blocked', result: error.result };
  }
  return {
    status: 'failed',
    message: error instanceof Error ? error.message : '資料存取失敗。',
  };
}
