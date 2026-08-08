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
 * Writes are fire-and-forget to screens, but DataProvider must serialize the
 * repository calls. Remote mutations derive their next document from a shared
 * snapshot, so response-only stale-result filtering would not protect the
 * durable store from an older request finishing last.
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
  it('starts and applies writes in UI call order', async () => {
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
    const startedTitles: string[] = [];
    const pending = () =>
      new Promise<DayPopUserData>((resolve) => {
        resolvers.push(resolve);
      });
    const repository: DayPopRepository = {
      load: async () => base,
      addEvent: pending,
      updateEvent: pending,
      deleteEvent: pending,
      addTodo(input) {
        startedTitles.push(input.title);
        return pending();
      },
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
    expect(startedTitles).toEqual(['第一筆']);
    expect(resolvers).toHaveLength(1);

    // The second repository call cannot start until the first has settled.
    await act(async () => {
      resolvers[0]!(withTitle('第一筆'));
    });
    expect(startedTitles).toEqual(['第一筆', '第二筆']);
    expect(resolvers).toHaveLength(2);

    let state = latest().state;
    let shown = state.status === 'ready' ? state.data.todos[0]?.title : null;
    expect(shown).toBe('第一筆');

    await act(async () => {
      resolvers[1]!(withTitle('第二筆'));
    });

    state = latest().state;
    shown = state.status === 'ready' ? state.data.todos[0]?.title : null;
    expect(shown).toBe('第二筆');
  });

  it('continues with an already queued write after a rejection', async () => {
    const base = await new LocalDayPopRepository(new MemoryStorage()).load();
    const completed: DayPopUserData = {
      ...base,
      preferences: {
        ...base.preferences,
        weekStartsOn: 1,
      },
    };
    const resolvers: ((data: DayPopUserData) => void)[] = [];
    const rejectors: ((error: Error) => void)[] = [];
    const pending = () =>
      new Promise<DayPopUserData>((resolve, reject) => {
        resolvers.push(resolve);
        rejectors.push(reject);
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

    await act(async () => {
      latest().actions.updatePreferences({ weekStartsOn: 0 });
      latest().actions.updatePreferences({ weekStartsOn: 1 });
    });
    expect(resolvers).toHaveLength(1);

    await act(async () => {
      rejectors[0]!(new Error('第一筆失敗'));
    });
    expect(resolvers).toHaveLength(2);
    expect(latest().state).toEqual({ status: 'failed', message: '第一筆失敗' });

    await act(async () => {
      resolvers[1]!(completed);
    });
    const state = latest().state;
    expect(state.status === 'ready' ? state.data.preferences.weekStartsOn : null).toBe(1);
  });
});
