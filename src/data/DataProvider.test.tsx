import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataTransferError } from '../domain/dataTransfer';
import type { DayPopUserData } from '../domain/types';
import { LocalDataBlockedError, LocalDayPopRepository } from '../storage/localRepository';
import { MemoryStorage } from '../storage/browserStorage';
import { readUserData } from '../storage/versionedStorage';
import { DataProvider } from './DataProvider';
import { CachedRemoteLoadError } from './cachedSupabaseRepository';
import { useDayPopDataState, type DataContextValue } from './dataContext';
import type { DayPopRepository } from './repository';
import { RemoteDataError } from './supabaseRepository';

/**
 * Covers the seam itself: that screens get their data from the provider and
 * that a refused write reaches the recovery state. The adapters are unit
 * tested separately; what is checked here is the wiring between them and React.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const seen: DataContextValue[] = [];

function Probe() {
  const value = useDayPopDataState();
  seen.push(value);
  return <span data-testid="status">{value.state.status}</span>;
}

async function render(children: ReactNode) {
  seen.length = 0;
  await act(async () => {
    root.render(children);
  });
}

function latest(): DataContextValue {
  const value = seen.at(-1);
  if (!value) throw new Error('probe never rendered');
  return value;
}

/** A remote-shaped adapter: async only, no synchronous first paint. */
function asyncRepository(data: DayPopUserData): DayPopRepository {
  const respond = async () => structuredClone(data);
  return {
    load: respond,
    addEvent: respond,
    updateEvent: respond,
    deleteEvent: respond,
    cancelEventOccurrence: respond,
    replaceEventOccurrence: respond,
    addTodo: respond,
    toggleTodo: respond,
    renameTodo: respond,
    setTodoPriority: respond,
    deleteTodo: respond,
    addSticker: respond,
    deleteSticker: respond,
    addCalendar: respond,
    updateCalendar: respond,
    deleteCalendar: respond,
    updatePreferences: respond,
    importData: respond,
  };
}

describe('DataProvider', () => {
  it('orders delete before priority edit, refuses it without unmounting and continues the queue', async () => {
    const repository = new LocalDayPopRepository(new MemoryStorage());
    await repository.load();
    const todo = (await repository.addTodo({ title: '先刪除', date: '2026-08-08' })).todos[0]!;
    await render(<DataProvider repository={repository}><Probe /></DataProvider>);
    await act(async () => {
      latest().actions.deleteTodo(todo.id);
      await expect(latest().actions.setTodoPriority(todo.id, 'high')).rejects.toThrow('找不到待辦');
    });
    expect(latest().state).toMatchObject({ status: 'ready', data: { todos: [] }, warning: { kind: 'refused' } });
    await act(async () => { latest().actions.addTodo({ title: '後續正常', date: '2026-08-08' }); });
    expect(latest().state).toMatchObject({ status: 'ready', data: { todos: [{ title: '後續正常', priority: 'none' }] } });
  });
  it('refuses an invalid all-day range without unmounting or poisoning the queue', async () => {
    const repository = new LocalDayPopRepository(new MemoryStorage());
    await render(<DataProvider repository={repository}><Probe /></DataProvider>);
    const before = latest().state;
    await act(async () => { latest().actions.addEvent({ title: '拒絕', date: '2026-08-06', endDate: '2026-08-05', allDay: true, start: '', end: '' }); });
    expect(latest().state).toMatchObject({ ...before, warning: { kind: 'refused', message: expect.stringContaining('不能早於') } });
    await act(async () => { latest().actions.addEvent({ title: '假期', date: '2026-08-06', endDate: '2026-08-08', allDay: true, start: '', end: '' }); });
    expect(latest().state).toMatchObject({ status: 'ready', data: { events: [{ title: '假期', endDate: '2026-08-08' }] } });
  });
  it('refuses an overlong command while retaining the app and allowing the next write', async () => {
    const repository = new LocalDayPopRepository(new MemoryStorage());
    await render(<DataProvider repository={repository}><Probe /></DataProvider>);
    const before = latest().state;
    await act(async () => { latest().actions.addTodo({ title: '字'.repeat(301), date: '2026-10-04' }); });
    expect(latest().state).toMatchObject({ ...before, warning: { kind: 'refused', message: expect.stringContaining('最多 300') } });
    await act(async () => { latest().actions.addTodo({ title: '正常', date: '2026-10-04' }); });
    expect(latest().state).toMatchObject({ status: 'ready', data: { todos: [{ title: '正常' }] } });
  });
  it('serializes deletion before awaited rename, reports refusal and continues the queue', async () => {
    const repository = new LocalDayPopRepository(new MemoryStorage());
    await repository.load();
    const todo = (await repository.addTodo({ title: '先刪除', date: '2026-08-08' })).todos[0]!;
    await render(<DataProvider repository={repository}><Probe /></DataProvider>);
    await act(async () => {
      latest().actions.deleteTodo(todo.id);
      await expect(latest().actions.renameTodo(todo.id, '不能復活')).rejects.toThrow('找不到待辦');
    });
    const refused = latest().state;
    expect(refused.status).toBe('ready');
    expect(refused.status === 'ready' ? refused.data.todos : null).toEqual([]);
    expect(refused.status === 'ready' ? refused.warning?.kind : null).toBe('refused');
    await act(async () => { latest().actions.addTodo({ title: '後續正常', date: '2026-08-08' }); });
    const saved = latest().state;
    expect(saved.status === 'ready' ? saved.data.todos[0]?.title : null).toBe('後續正常');
    expect(saved.status === 'ready' ? saved.warning : null).toBeUndefined();
  });
  it('paints the first frame with real data instead of a loading state', async () => {
    await render(
      <DataProvider>
        <Probe />
      </DataProvider>,
    );

    // The guest adapter reads synchronously, so no screen ever sees `loading`.
    expect(seen[0]?.state.status).toBe('ready');
    expect(seen.every((value) => value.state.status === 'ready')).toBe(true);
  });

  it('gives every consumer the same document after a write', async () => {
    await render(
      <DataProvider>
        <Probe />
      </DataProvider>,
    );

    await act(async () => {
      latest().actions.addTodo({ title: '買菜', date: '2026-08-06' });
    });

    const state = latest().state;
    expect(state.status === 'ready' && state.data.todos[0]?.title).toBe('買菜');
    // …and it really reached storage, not just React state.
    const stored = readUserData();
    expect(stored.status === 'ready' && stored.envelope.data.todos[0]?.title).toBe('買菜');
  });

  it('ignores a blank title without touching storage', async () => {
    await render(
      <DataProvider>
        <Probe />
      </DataProvider>,
    );

    await act(async () => {
      latest().actions.addTodo({ title: '   ', date: '2026-08-06' });
    });

    const state = latest().state;
    expect(state.status === 'ready' && state.data.todos).toHaveLength(0);
  });

  it('shows the recovery state when the stored bytes cannot be read', async () => {
    localStorage.setItem('daypop.user-data', 'not-json');

    await render(
      <DataProvider>
        <Probe />
      </DataProvider>,
    );

    const state = latest().state;
    expect(state.status).toBe('blocked');
    expect(state.status === 'blocked' && state.result.status).toBe('corrupt');
    expect(localStorage.getItem('daypop.user-data')).toBe('not-json');
  });

  it('falls into recovery when a write is refused mid-session', async () => {
    await render(
      <DataProvider>
        <Probe />
      </DataProvider>,
    );
    expect(latest().state.status).toBe('ready');

    // Another tab — or a manual edit — damaged the key after this one started.
    localStorage.setItem('daypop.user-data', '{{{');
    await act(async () => {
      latest().actions.addTodo({ title: '第二筆', date: '2026-08-06' });
    });

    expect(latest().state.status).toBe('blocked');
    expect(localStorage.getItem('daypop.user-data')).toBe('{{{');
  });

  it('awaits an adapter that cannot answer synchronously', async () => {
    const seedRepository = new LocalDayPopRepository(new MemoryStorage());
    const data = await seedRepository.load();

    await render(
      <DataProvider repository={asyncRepository(data)}>
        <Probe />
      </DataProvider>,
    );

    // Remote adapters do start at `loading`, then resolve without the app
    // having to know which adapter it was given.
    expect(seen[0]?.state.status).toBe('loading');
    expect(latest().state.status).toBe('ready');
  });

  it('reports an unexpected load failure instead of hanging on loading', async () => {
    const failing: DayPopRepository = {
      ...asyncRepository(await new LocalDayPopRepository(new MemoryStorage()).load()),
      load: () => Promise.reject(new Error('network down')),
    };

    await render(
      <DataProvider repository={failing}>
        <Probe />
      </DataProvider>,
    );

    const state = latest().state;
    expect(state.status).toBe('failed');
    expect(state.status === 'failed' && state.message).toBe('network down');
  });

  it('keeps a blocked read blocked rather than reporting a generic failure', async () => {
    const blocked: DayPopRepository = {
      ...asyncRepository(await new LocalDayPopRepository(new MemoryStorage()).load()),
      load: () =>
        Promise.reject(
          new LocalDataBlockedError({ status: 'future', raw: '{}', schemaVersion: 99 }),
        ),
    };

    await render(
      <DataProvider repository={blocked}>
        <Probe />
      </DataProvider>,
    );

    const state = latest().state;
    expect(state.status).toBe('blocked');
    expect(state.status === 'blocked' && state.result.status).toBe('future');
  });

  it('shows a validated account cache with a persistent warning after a transient load failure', async () => {
    const data = await new LocalDayPopRepository(new MemoryStorage()).load();
    let loadCount = 0;
    const repository: DayPopRepository = {
      ...asyncRepository(data),
      load: () => {
        loadCount += 1;
        return loadCount === 1
          ? Promise.reject(
              new CachedRemoteLoadError(
                data,
                new RemoteDataError('讀取帳號資料', new Error('network down')),
              ),
            )
          : Promise.resolve(structuredClone(data));
      },
    };

    await render(
      <DataProvider repository={repository}>
        <Probe />
      </DataProvider>,
    );

    expect(latest().state).toMatchObject({
      status: 'ready',
      warning: { kind: 'cached' },
    });

    await act(async () => {
      latest().refresh();
    });

    const refreshed = latest().state;
    expect(refreshed.status).toBe('ready');
    expect(refreshed.status === 'ready' ? refreshed.warning : null).toBeUndefined();
  });

  it('keeps the last confirmed remote snapshot when a write fails', async () => {
    const data = await new LocalDayPopRepository(new MemoryStorage()).load();
    const repository: DayPopRepository = {
      ...asyncRepository(data),
      addTodo: () =>
        Promise.reject(new RemoteDataError('新增待辦', new Error('network down'))),
    };

    await render(
      <DataProvider repository={repository}>
        <Probe />
      </DataProvider>,
    );

    await act(async () => {
      latest().actions.addTodo({ title: '不應樂觀落地', date: '2026-08-08' });
    });

    const state = latest().state;
    expect(state.status).toBe('ready');
    expect(state.status === 'ready' ? state.data.todos : []).toHaveLength(0);
    expect(state.status === 'ready' ? state.warning?.kind : null).toBe('write-failed');
    expect(state.status === 'ready' ? state.saving : null).toBe(false);
  });

  it.each([false, true])('keeps an import refusal in the caller without discarding ready data (cached warning: %s)', async (cached) => {
    const data = await new LocalDayPopRepository(new MemoryStorage()).load();
    const refusal = new DataTransferError('帳號仍有附件，不能取代');
    const next = { ...data, preferences: { ...data.preferences, petName: '繼續編輯' } };
    const repository: DayPopRepository = {
      ...asyncRepository(data),
      ...(cached ? {
        load: () => Promise.reject(new CachedRemoteLoadError(
          data, new RemoteDataError('讀取帳號資料', new Error('network down')),
        )),
      } : {}),
      importData: () => Promise.reject(refusal),
      updatePreferences: async () => next,
    };
    await render(<DataProvider repository={repository}><Probe /></DataProvider>);
    const before = latest().state;
    const renderCount = seen.length;

    await act(async () => {
      await expect(latest().actions.importData({ kind: 'replace', data })).rejects.toBe(refusal);
    });

    expect(latest().state).toEqual({ ...before, saving: false });
    expect(seen.slice(renderCount).every((value) => value.state.status === 'ready')).toBe(true);
    await act(async () => {
      latest().actions.updatePreferences({ petName: '繼續編輯' });
    });
    expect(latest().state).toEqual({ status: 'ready', data: next });
  });

  it('keeps saving after an import refusal until the already queued write settles', async () => {
    const data = await new LocalDayPopRepository(new MemoryStorage()).load();
    let rejectImport!: (error: Error) => void;
    let resolveWrite!: (data: DayPopUserData) => void;
    const repository: DayPopRepository = {
      ...asyncRepository(data),
      importData: () => new Promise((_resolve, reject) => { rejectImport = reject; }),
      updatePreferences: () => new Promise((resolve) => { resolveWrite = resolve; }),
    };
    await render(<DataProvider repository={repository}><Probe /></DataProvider>);
    let rejection!: Promise<unknown>;
    await act(async () => {
      // Attach a rejection handler immediately; the dialog also awaits this promise.
      rejection = latest().actions.importData({ kind: 'replace', data }).catch((error) => error);
      latest().actions.updatePreferences({ petName: '排隊編輯' });
    });
    expect(resolveWrite).toBeUndefined();
    const refusal = new DataTransferError('帳號仍有附件，不能取代');
    await act(async () => {
      rejectImport(refusal);
      expect(await rejection).toBe(refusal);
    });
    expect(resolveWrite).toBeTypeOf('function');
    expect(latest().state).toEqual({ status: 'ready', data, saving: true });
    const next = { ...data, preferences: { ...data.preferences, petName: '排隊編輯' } };
    await act(async () => { resolveWrite(next); });
    expect(latest().state).toEqual({ status: 'ready', data: next });
  });

  it('reports saving until every queued repository write has settled', async () => {
    const data = await new LocalDayPopRepository(new MemoryStorage()).load();
    let resolveWrite: ((value: DayPopUserData) => void) | null = null;
    const repository: DayPopRepository = {
      ...asyncRepository(data),
      addTodo: () =>
        new Promise<DayPopUserData>((resolve) => {
          resolveWrite = resolve;
        }),
    };

    await render(
      <DataProvider repository={repository}>
        <Probe />
      </DataProvider>,
    );

    await act(async () => {
      latest().actions.addTodo({ title: '保存中', date: '2026-08-08' });
      await Promise.resolve();
    });
    const saving = latest().state;
    expect(saving.status === 'ready' ? saving.saving : false).toBe(true);

    const completeWrite = resolveWrite as ((value: DayPopUserData) => void) | null;
    expect(completeWrite).not.toBeNull();
    await act(async () => {
      completeWrite?.(structuredClone(data));
    });
    const saved = latest().state;
    expect(saved.status === 'ready' ? saved.saving : null).toBeUndefined();
  });
});
