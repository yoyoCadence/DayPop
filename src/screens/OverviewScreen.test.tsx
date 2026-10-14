import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataProvider';
import { instantDateInZone } from '../domain/eventTime';
import { createEmptyUserData, type DayPopUserData, type TodoItem } from '../domain/types';
import { writeUserData } from '../storage/versionedStorage';
import { OverviewScreen } from './OverviewScreen';

/**
 * 綜覽's 未排日期 — DP-173 — through the guest adapter, so every action is
 * checked against what was actually stored.
 */

const NOW = '2026-08-01T00:00:00.000Z';
const PARENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHILD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

function todo(id: string, title: string, overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id,
    calendarId: '',
    parentId: null,
    title,
    dueDate: null,
    priority: 'none',
    completedAt: null,
    sortOrder: 0,
    sharingScope: 'inherit',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** An imported parent and subtask with no date, as only an import produces. */
function seed(): DayPopUserData {
  const data = createEmptyUserData({ now: NOW });
  const calendarId = data.calendars[0]!.id;
  data.todos = [
    todo(PARENT, '整理收據', { calendarId }),
    todo(CHILD, '拍照存檔', { calendarId, parentId: PARENT }),
  ];
  writeUserData(data, 0);
  return data;
}

const stored = (): DayPopUserData =>
  JSON.parse(window.localStorage.getItem('daypop.user-data')!).data;

async function render() {
  await act(async () => {
    root.render(
      <DataProvider>
        <OverviewScreen onOpenEvent={vi.fn()} onOpenDay={vi.fn()} />
      </DataProvider>,
    );
  });
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error('element not found');
  await act(async () => {
    (element as HTMLElement).click();
  });
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement | null | undefined) {
  if (!form) throw new Error('form not found');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

const section = () => container.querySelector('.overview-undated');
const button = (label: string) => container.querySelector(`button[aria-label="${label}"]`);
const showTodos = () =>
  click([...container.querySelectorAll('[aria-label="資料類型"] button')].find((b) => b.textContent === '待辦'));

describe('綜覽的未排日期（DP-173）', () => {
  it('lists undated todos under 待辦 only, with their subtasks', async () => {
    seed();
    await render();
    expect(section()).toBeNull();

    await showTodos();
    expect(section()?.textContent).toContain('未排日期');
    expect(section()?.textContent).toContain('(1)');
    expect(section()?.textContent).toContain('整理收據');

    await click(button('展開 整理收據 的子項'));
    expect(section()?.textContent).toContain('拍照存檔');
  });

  it('shows nothing when every todo has a date', async () => {
    const data = createEmptyUserData({ now: NOW });
    data.todos = [todo(PARENT, '繳費', { calendarId: data.calendars[0]!.id, dueDate: '2026-08-02' })];
    writeUserData(data, 0);
    await render();
    await showTodos();
    expect(section()).toBeNull();
  });

  it('moves a todo to the day it is given, leaving its subtask undated', async () => {
    const data = seed();
    const today = instantDateInZone(new Date().toISOString(), data.preferences.timezone);
    await render();
    await showTodos();

    await click(button('修改 整理收據 的日期'));
    const input = container.querySelector<HTMLInputElement>('[aria-label="整理收據 的日期"]')!;
    await type(input, today);
    await submit(input.form);

    expect(stored().todos.find((item) => item.id === PARENT)?.dueDate).toBe(today);
    // Dates are independent (DP-129): the subtask stays here, now on its own.
    expect(stored().todos.find((item) => item.id === CHILD)?.dueDate).toBeNull();
    expect(section()?.textContent).not.toContain('整理收據');
    expect(section()?.textContent).toContain('拍照存檔');
    // And the parent now shows on its day in the browsed month.
    const listed = [...container.querySelectorAll('.overview-item-title')].map((item) => item.textContent);
    expect(listed).toContain('整理收據');
    // Focus stays in the section rather than falling to the page.
    expect(document.activeElement).toBe(container.querySelector('.overview-undated-title'));
  });

  it('renames, completes and deletes, and a deleted parent takes its subtask with it', async () => {
    seed();
    await render();
    await showTodos();

    await click(button('修改 整理收據 的標題'));
    const title = container.querySelector<HTMLInputElement>('[aria-label="待辦標題"]')!;
    await type(title, '整理發票');
    await submit(title.form);
    expect(stored().todos.find((item) => item.id === PARENT)?.title).toBe('整理發票');

    await click(button('完成 整理發票'));
    expect(stored().todos.find((item) => item.id === PARENT)?.completedAt).not.toBeNull();

    await click(button('刪除 整理發票'));
    expect(stored().todos).toEqual([]);
    expect(section()).toBeNull();
  });
});
