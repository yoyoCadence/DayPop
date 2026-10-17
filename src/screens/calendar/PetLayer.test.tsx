import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewTodoInput } from '../../domain/mutations';
import type { TodoItem, TodoPriority } from '../../domain/types';
import { PetLayer, type PetLayerProps } from './PetLayer';

/**
 * The pet and its speech bubble — DP-169, ported from the原檔's
 * `petTap()`／`showTodosBubble()`／`petClose()` (`:1153-1157`) and the bubble
 * markup (`:488-530`).
 */

const TODAY = '2026-10-17';
const TOMORROW = '2026-10-18';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

function todo(
  id: string,
  title: string,
  dueDate: string | null,
  options: { done?: boolean; priority?: TodoPriority; sortOrder?: number } = {},
): TodoItem {
  return {
    id,
    calendarId: 'calendar',
    parentId: null,
    title,
    dueDate,
    priority: options.priority ?? 'none',
    completedAt: options.done ? '2026-10-17T01:00:00.000Z' : null,
    sortOrder: options.sortOrder ?? 0,
    sharingScope: 'inherit',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

const SAMPLE = [
  todo('overdue', '繳電費', '2026-10-16', { priority: 'high', sortOrder: 1 }),
  todo('today', '買牛奶', TODAY, { sortOrder: 2 }),
  todo('done', '倒垃圾', TODAY, { done: true, sortOrder: 3 }),
  todo('tomorrow', '寄包裹', TOMORROW, { sortOrder: 4 }),
  todo('later', '看牙醫', '2026-10-20', { sortOrder: 5 }),
];

type Callbacks = Pick<PetLayerProps, 'onAddTodo' | 'onToggleTodo' | 'onDeleteTodo'>;

/** Holds `greeted` the way `App` does, so a session's first and later taps differ. */
function Harness({ todos, greeted: initial = false, ...callbacks }: Callbacks & { todos: TodoItem[]; greeted?: boolean }) {
  const [greeted, setGreeted] = useState(initial);
  return (
    <PetLayer
      petName="摩卡"
      todos={todos}
      todayKey={TODAY}
      greeted={greeted}
      onGreeted={() => setGreeted(true)}
      {...callbacks}
    />
  );
}

function render(options: Partial<Callbacks> & { todos?: TodoItem[]; greeted?: boolean } = {}) {
  const callbacks: Callbacks = {
    onAddTodo: vi.fn<(input: NewTodoInput) => Promise<void>>().mockResolvedValue(undefined),
    onToggleTodo: vi.fn(),
    onDeleteTodo: vi.fn(),
    ...options,
  };
  act(() => root.render(<Harness todos={options.todos ?? SAMPLE} greeted={options.greeted} {...callbacks} />));
  return callbacks;
}

const pet = () => container.querySelector<HTMLButtonElement>('button.cal-pet')!;
const bubble = () => container.querySelector('[role="dialog"]');
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const buttonByText = (text: string) =>
  Array.from(container.querySelectorAll('button')).find((element) => element.textContent === text) ?? null;
const titles = (section: number) =>
  Array.from(container.querySelectorAll('.cal-pet-section')[section]!.querySelectorAll('.cal-pet-todo-title')).map(
    (element) => element.textContent,
  );

function click(element: Element | null | undefined) {
  if (!element) throw new Error('element not found');
  act(() => (element as HTMLElement).click());
}

function open() {
  pet().focus();
  click(pet());
}

function type(label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  input.focus();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

const submit = (input: HTMLInputElement) =>
  act(async () => {
    input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

describe('the pet (DP-169)', () => {
  it('is a button named after the pet and what is left today, with the原檔 badge', () => {
    render();
    expect(pet().getAttribute('aria-label')).toBe('摩卡，今天還有 2 件待辦');
    expect(pet().getAttribute('aria-haspopup')).toBe('dialog');
    expect(container.querySelector('.cal-pet-badge')?.textContent).toBe('2');
    expect(container.querySelector('.cal-pet-layer')?.hasAttribute('aria-hidden')).toBe(false);
    expect(container.querySelector('.cal-pet-body')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('drops the badge and says so when nothing is left today', () => {
    render({ todos: [todo('done', '倒垃圾', TODAY, { done: true })] });
    expect(pet().getAttribute('aria-label')).toBe('摩卡，今天沒有未完成的待辦');
    expect(container.querySelector('.cal-pet-badge')).toBeNull();
  });
});

describe('the speech bubble (DP-169)', () => {
  it('greets the first time with the count and the important ones, then opens on the lists', () => {
    render();
    open();
    expect(bubble()?.getAttribute('aria-modal')).toBe('true');
    expect(bubble()?.getAttribute('aria-label')).toBe('摩卡');
    const greeting = container.querySelector('.cal-pet-greeting')!;
    expect(greeting.textContent).toBe('嗨，我是摩卡！今天還有 2 件待辦，其中 1 件重要，要一起看看嗎？');
    expect(bubble()?.getAttribute('aria-describedby')).toBe(greeting.id);
    expect(document.activeElement).toBe(buttonByText('看待辦'));
    // No assistant exists yet (DP-043), so its button is not drawn.
    expect(buttonByText('給我建議')).toBeNull();

    click(button('關閉'));
    expect(bubble()).toBeNull();
    open();
    expect(container.querySelector('.cal-pet-greeting')).toBeNull();
    expect(container.querySelector('.cal-pet-heading')?.textContent).toBe('📋 今日待辦');
  });

  it('asks about tomorrow when today is clear', () => {
    render({ todos: [todo('tomorrow', '寄包裹', TOMORROW)] });
    open();
    expect(container.querySelector('.cal-pet-greeting')?.textContent).toBe(
      '嗨，我是摩卡！今天的待辦都清光啦，要看看明天的安排嗎？',
    );
  });

  it('看待辦 shows today with what is overdue, and tomorrow, and keeps focus in the bubble', () => {
    render();
    open();
    click(buttonByText('看待辦'));
    const headings = Array.from(container.querySelectorAll('.cal-pet-heading'));
    expect(headings.map((heading) => heading.textContent)).toEqual(['📋 今日待辦', '🗓 明日待辦']);
    expect(document.activeElement).toBe(headings[0]);
    expect(titles(0)).toEqual(['繳電費', '買牛奶', '倒垃圾']);
    expect(titles(1)).toEqual(['寄包裹']);
    expect(container.querySelector('.cal-pet-overdue')?.textContent).toBe('逾期・原10/16');
    expect(button('完成 倒垃圾')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('完成 買牛奶')?.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('.cal-pet-empty')).toBeNull();
  });

  it('says today is clear, and adds nothing for tomorrow, when the lists are empty', () => {
    render({ todos: [], greeted: true });
    open();
    expect(container.querySelector('.cal-pet-empty')?.textContent).toBe('今天清空啦，太棒了！');
    expect(container.querySelectorAll('.cal-pet-todo')).toHaveLength(0);
  });

  it('ticks and deletes through the data actions, keeping focus inside when a row goes away', () => {
    const callbacks = render({ greeted: true });
    open();
    // A real click focuses the button first; `element.click()` does not.
    const press = (label: string) => {
      button(label)!.focus();
      click(button(label));
    };
    press('完成 買牛奶');
    expect(callbacks.onToggleTodo).toHaveBeenCalledWith('today');
    // Today's row stays when done, so focus stays on its checkbox.
    expect(document.activeElement).toBe(button('完成 買牛奶'));
    // An overdue todo leaves 今日 once done, so focus moves before it does.
    press('完成 繳電費');
    expect(callbacks.onToggleTodo).toHaveBeenLastCalledWith('overdue');
    expect(document.activeElement?.textContent).toBe('📋 今日待辦');
    press('刪除 寄包裹');
    expect(callbacks.onDeleteTodo).toHaveBeenCalledWith('tomorrow');
    expect(document.activeElement?.textContent).toBe('🗓 明日待辦');
  });

  it.each([
    ['新增今日待辦', TODAY],
    ['新增明日待辦', TOMORROW],
  ])('%s adds a trimmed todo on that day and clears once confirmed', async (label, date) => {
    const callbacks = render({ greeted: true });
    open();
    const input = type(label, '  買麵包  ');
    await submit(input);
    expect(callbacks.onAddTodo).toHaveBeenCalledExactlyOnceWith({ id: expect.stringMatching(UUID), title: '買麵包', date });
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    await submit(input);
    expect(callbacks.onAddTodo).toHaveBeenCalledTimes(1);
  });

  it('keeps the typed title after a rejected add and retries only when asked (DP-137)', async () => {
    const add = vi.fn<(input: NewTodoInput) => Promise<void>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    render({ greeted: true, onAddTodo: add });
    open();
    const input = type('新增今日待辦', '買麵包');
    await submit(input);
    expect(input.value).toBe('買麵包');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('待辦尚未確認新增，輸入內容已保留；請先確認清單再重試。');
    await submit(input);
    expect(add).toHaveBeenCalledTimes(2);
    expect(add.mock.calls[1]).toEqual(add.mock.calls[0]);
    expect(input.value).toBe('');
  });

  it('refuses a title over the limit before any write', async () => {
    const callbacks = render({ greeted: true });
    open();
    const input = type('新增明日待辦', '長'.repeat(301));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('300');
    expect(button('加入明日待辦')?.disabled).toBe(true);
    await submit(input);
    expect(callbacks.onAddTodo).not.toHaveBeenCalled();
  });

  it.each([
    ['✕', () => click(button('關閉'))],
    ['tapping outside', () => click(container.querySelector('.cal-pet-bubble-catcher'))],
    ['Escape', () => act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))],
  ])('%s closes it and gives focus back to the pet', (_, close) => {
    render({ greeted: true });
    open();
    expect(document.activeElement).not.toBe(pet());
    close();
    expect(bubble()).toBeNull();
    expect(document.activeElement).toBe(pet());
  });

  it('keeps the rest of the App out of reach while open', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    render({ greeted: true });
    open();
    expect(outside.hasAttribute('inert')).toBe(true);
    click(button('關閉'));
    expect(outside.hasAttribute('inert')).toBe(false);
    outside.remove();
  });
});
