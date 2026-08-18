import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataProvider';
import type { DayPopRepository, SyncLoadCapable } from '../data/repository';
import { createEmptyUserData, type DayPopUserData, type TodoItem } from '../domain/types';
import { timedEventFromWallTime } from '../domain/eventTime';
import { SearchScreen } from './SearchScreen';

/**
 * 搜尋 through the real provider: what the field finds, and what a result does
 * when it is tapped. The repository is a fixed document rather than the local
 * adapter, because these cases need a todo shape the UI cannot create yet.
 */

const NOW = '2026-08-01T00:00:00.000Z';

function seeded(): DayPopUserData {
  const data = createEmptyUserData({ now: NOW });
  const calendarId = data.calendars[0]!.id;
  data.events = [
    timedEventFromWallTime(
      {
        id: '77777777-7777-4777-8777-777777777777',
        calendarId,
        title: '客戶簡報',
        location: '會議室A',
        notes: '記得帶合約',
        reminderMinutes: [],
        recurrence: null,
        sharingScope: 'inherit',
        createdAt: NOW,
        updatedAt: NOW,
      },
      { date: '2026-08-06', start: '14:00', end: '15:00' },
      'Asia/Taipei',
    ),
  ];
  data.todos = [
    todo('88888888-8888-4888-8888-888888888888', '整理照片', '2026-08-08', calendarId),
    // Nothing in the UI creates this yet, but the domain allows a todo with no
    // due date and the Supabase adapter will read one back (DP-026).
    todo('99999999-9999-4999-8999-999999999999', '有空再做', null, calendarId),
  ];
  return data;
}

function todo(id: string, title: string, dueDate: string | null, calendarId: string): TodoItem {
  return {
    id,
    calendarId,
    parentId: null,
    title,
    dueDate,
    priority: 'none',
    completedAt: null,
    sortOrder: 0,
    sharingScope: 'inherit',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** Read-only stand-in: 搜尋 never writes. */
function fixedRepository(data: DayPopUserData): DayPopRepository & SyncLoadCapable {
  const respond = async () => structuredClone(data);
  return {
    loadSync: () => structuredClone(data),
    load: respond,
    addEvent: respond,
    updateEvent: respond,
    deleteEvent: respond,
    addTodo: respond,
    toggleTodo: respond,
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

async function render() {
  const onOpenEvent = vi.fn();
  const onOpenDay = vi.fn();
  await act(async () => {
    root.render(
      <DataProvider repository={fixedRepository(seeded())}>
        <SearchScreen onOpenEvent={onOpenEvent} onOpenDay={onOpenDay} />
      </DataProvider>,
    );
  });
  return { onOpenEvent, onOpenDay };
}

async function search(query: string) {
  const field = container.querySelector('[aria-label="搜尋"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, query);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error('element not found');
  await act(async () => {
    (element as HTMLElement).click();
  });
}

const results = () => [...container.querySelectorAll('.search-result')];
const titles = () => results().map((row) => row.querySelector('.search-result-title')?.textContent);

describe('搜尋', () => {
  it('finds an event by its location and by its notes, not only by its title', async () => {
    await render();

    await search('會議室');
    expect(titles()).toEqual(['客戶簡報']);

    await search('合約');
    expect(titles()).toEqual(['客戶簡報']);
  });

  it('shows the location that matched on the result line', async () => {
    await render();

    await search('會議室');

    expect(results()[0]?.querySelector('.search-result-sub')?.textContent)
      .toBe('14:00 · 會議室A · 8月6日');
  });

  it('opens the day a todo is due on', async () => {
    const { onOpenDay } = await render();

    await search('照片');
    await click(results()[0]);

    expect(onOpenDay).toHaveBeenCalledWith('2026-08-08');
  });

  /**
   * Regression: the result used to fall back to an empty date key, and
   * `fromDateKey('')` resolves to 1900-01-01 — so tapping this row switched to
   * 日曆 and sent the period label and the week grid to January 1900.
   */
  it('cannot be tapped through to a day when the todo has no due date', async () => {
    const { onOpenDay } = await render();

    await search('有空');
    expect(titles()).toEqual(['有空再做']);
    expect(results()[0]?.querySelector('.search-result-sub')?.textContent).toBe('待辦 · 無到期日');
    expect((results()[0] as HTMLButtonElement).disabled).toBe(true);

    await click(results()[0]);

    expect(onOpenDay).not.toHaveBeenCalled();
  });

  it('opens an event result on the 日曆 tab', async () => {
    const { onOpenEvent, onOpenDay } = await render();

    await search('客戶');
    await click(results()[0]);

    expect(onOpenEvent).toHaveBeenCalledWith('77777777-7777-4777-8777-777777777777');
    expect(onOpenDay).not.toHaveBeenCalled();
  });
});
