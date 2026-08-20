import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import type { DayPopUserData } from '../domain/types';
import { LocalDataBlockedError, LocalDayPopRepository } from '../storage/localRepository';
import { CachedRemoteLoadError } from './cachedSupabaseRepository';
import { DataContext, type DataActions, type DataContextValue, type DataState } from './dataContext';
import {
  canLoadSync,
  canManageEventAttachments,
  type DayPopRepository,
} from './repository';
import { RemoteDataError } from './supabaseRepository';

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
 * `SessionDataProvider` chooses the guest or authenticated adapter after Auth
 * resolves. Keeping that decision one level above this component lets an
 * identity change remount the data boundary and discard both the previous
 * snapshot and its pending mutation queue.
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
  const pendingWriteCount = useRef(0);

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
    function enqueue(operation: () => Promise<DayPopUserData>): Promise<DayPopUserData> {
      pendingWriteCount.current += 1;
      setState((current) =>
        current.status === 'ready' ? { ...current, saving: true } : current,
      );

      const finishWrite = () => {
        pendingWriteCount.current = Math.max(0, pendingWriteCount.current - 1);
        return pendingWriteCount.current > 0;
      };

      const scheduled = pendingWrite.current.then(operation);
      pendingWrite.current = scheduled.then(
          (data) => {
            const saving = finishWrite();
            setState({ status: 'ready', data, ...(saving ? { saving: true } : {}) });
          },
          (error: unknown) => {
            const saving = finishWrite();
            setState((current) => {
              const failure = toWriteFailureState(error, current);
              return failure.status === 'ready' && saving
                ? { ...failure, saving: true }
                : failure;
            });
          },
        );
      return scheduled;
    }

    function run(operation: () => Promise<DayPopUserData>) {
      void enqueue(operation);
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
      async importData(command) {
        // Awaited so the preview sheet can report the outcome, and queued so it
        // cannot overtake an edit already in flight.
        await enqueue(() => activeRepository.importData(command));
      },
      async uploadEventAttachment(eventId, file) {
        if (!canManageEventAttachments(activeRepository)) {
          throw new Error('附件只會保存到登入帳號的私人雲端空間。');
        }
        await enqueue(() => activeRepository.uploadEventAttachment(eventId, file));
      },
      async deleteEventAttachment(id) {
        if (!canManageEventAttachments(activeRepository)) {
          throw new Error('附件只會保存到登入帳號的私人雲端空間。');
        }
        await enqueue(() => activeRepository.deleteEventAttachment(id));
      },
      createEventAttachmentUrl(id) {
        if (!canManageEventAttachments(activeRepository)) {
          return Promise.reject(new Error('附件只會保存到登入帳號的私人雲端空間。'));
        }
        return activeRepository.createEventAttachmentUrl(id);
      },
    };
  }, [activeRepository]);

  const value = useMemo<DataContextValue>(
    () => ({
      state,
      actions,
      capabilities: { eventAttachments: canManageEventAttachments(activeRepository) },
      refresh,
    }),
    [actions, activeRepository, refresh, state],
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
  if (error instanceof CachedRemoteLoadError) {
    return {
      status: 'ready',
      data: error.cachedData,
      warning: { kind: 'cached', message: error.message },
    };
  }
  if (error instanceof LocalDataBlockedError) {
    return { status: 'blocked', result: error.result };
  }
  return {
    status: 'failed',
    message: error instanceof Error ? error.message : '資料存取失敗。',
  };
}

function toWriteFailureState(error: unknown, current: DataState): DataState {
  if (error instanceof LocalDataBlockedError) {
    return { status: 'blocked', result: error.result };
  }
  if (error instanceof RemoteDataError && current.status === 'ready') {
    return {
      ...current,
      warning: {
        kind: 'write-failed',
        message: '剛才的變更沒有保存。' + error.message,
      },
    };
  }
  return toFailureState(error);
}
