import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DayPopUserData } from '../domain/types';
import { LocalDataBlockedError, LocalDayPopRepository } from '../storage/localRepository';
import { MemoryStorage } from '../storage/browserStorage';
import { readUserData } from '../storage/versionedStorage';
import { DataProvider } from './DataProvider';
import { useDayPopDataState, type DataContextValue } from './dataContext';
import type { DayPopRepository } from './repository';

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
    addTodo: respond,
    toggleTodo: respond,
    deleteTodo: respond,
    addSticker: respond,
    deleteSticker: respond,
  };
}

describe('DataProvider', () => {
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
});
