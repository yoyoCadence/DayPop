import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DayPopUserData } from '../domain/types';
import { MemoryStorage } from '../storage/browserStorage';
import { LocalDayPopRepository } from '../storage/localRepository';
import { DataProvider } from './DataProvider';
import { useDayPopDataState, type DataContextValue } from './dataContext';
import type { DayPopRepository } from './repository';

/**
 * Writes are fire-and-forget, so two in flight at once resolve in whatever
 * order the adapter finishes them. This pins down what the screen shows when
 * that order is not the call order — the case DP-026's remote adapter will
 * actually hit.
 */

const seen: DataContextValue[] = [];

function Probe() {
  seen.push(useDayPopDataState());
  return null;
}

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

function latest() {
  const value = seen.at(-1);
  if (!value) throw new Error('probe never rendered');
  return value;
}

describe('DataProvider concurrent writes', () => {
  it('shows the later-resolving write, even when it started first', async () => {
    const base = await new LocalDayPopRepository(new MemoryStorage()).load();
    const withTitle = (title: string): DayPopUserData => ({
      ...base,
      todos: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          calendarId: base.calendars[0]!.id,
          parentId: null,
          title,
          dueDate: '2026-08-06',
          priority: 'none',
          completedAt: null,
          sortOrder: 0,
          sharingScope: 'inherit',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    });

    const resolvers: ((data: DayPopUserData) => void)[] = [];
    const pending = () =>
      new Promise<DayPopUserData>((resolve) => {
        resolvers.push(resolve);
      });
    const repository: DayPopRepository = {
      load: async () => base,
      addEvent: pending,
      updateEvent: pending,
      deleteEvent: pending,
      addTodo: pending,
      toggleTodo: pending,
      deleteTodo: pending,
      addSticker: pending,
      deleteSticker: pending,
      addCalendar: pending,
      updateCalendar: pending,
      deleteCalendar: pending,
      updatePreferences: pending,
    };

    seen.length = 0;
    await act(async () => {
      root.render(
        <DataProvider repository={repository}>
          <Probe />
        </DataProvider>,
      );
    });

    // Two writes in flight.
    await act(async () => {
      latest().actions.addTodo({ title: '第一筆', date: '2026-08-06' });
      latest().actions.addTodo({ title: '第二筆', date: '2026-08-06' });
    });
    expect(resolvers).toHaveLength(2);

    // The second one comes back first, then the first — the out-of-order case.
    await act(async () => {
      resolvers[1]!(withTitle('第二筆'));
    });
    await act(async () => {
      resolvers[0]!(withTitle('第一筆'));
    });

    const state = latest().state;
    const shown = state.status === 'ready' ? state.data.todos[0]?.title : null;
    // Documents current behaviour: last-resolved wins, so a slow earlier write
    // can overwrite a newer one. Harmless for the local adapter, which resolves
    // in call order; DP-026 must not ship the remote adapter without ordering.
    expect(shown).toBe('第一筆');
  });
});
