import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timedEventFromWallTime } from '../../domain/eventTime';
import { STICKER_GLYPHS } from '../../domain/stickerGlyphs';
import {
  resolveEventOccurrences,
  type OccurrenceWindow,
} from '../../domain/recurrence';
import type { CalendarEvent, Sticker, TodoItem } from '../../domain/types';
import { DayDetailSheet, type DayDetailSheetProps } from './DayDetailSheet';
/**
 * Stands in for the screen's `resolveOccurrences` — DP-081. Visibility
 * filtering happens upstream in production, so this expands the given events
 * exactly as the real pipeline does.
 */
function occurrenceResolver(events: CalendarEvent[]) {
  return (window: OccurrenceWindow) =>
    resolveEventOccurrences({ events, eventExceptions: [] }, window);
}

/**
 * The sticker row and picker are the DP-055 UI, so they are exercised through
 * real clicks rather than by asserting on props.
 */

const DATE = '2026-08-06';
const CALENDAR = '33333333-3333-4333-8333-333333333333';

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

function event(id: string, title: string, location: string | null): CalendarEvent {
  return timedEventFromWallTime(
    {
      id,
      calendarId: CALENDAR,
      title,
      location,
      notes: null,
      reminderMinutes: [],
      recurrence: null,
      sharingScope: 'inherit',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    { date: DATE, start: '09:00', end: '10:00' },
    'Asia/Taipei',
  );
}

function sticker(id: string, glyph: string, date = DATE): Sticker {
  return {
    id,
    calendarId: CALENDAR,
    date,
    glyph,
    assetKey: null,
    sortOrder: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function render(overrides: Partial<DayDetailSheetProps> = {}) {
  const props: DayDetailSheetProps = {
    dateKey: DATE,
    resolveOccurrences: occurrenceResolver([]),
    displayTimezone: 'Asia/Taipei',
    todayKey: DATE,
    todos: [],
    stickers: [],
    calendars: [],
    onClose: vi.fn(),
    onOpenEvent: vi.fn(),
    onNewEvent: vi.fn(),
    onAddTodo: vi.fn(),
    onToggleTodo: vi.fn(),
    onDeleteTodo: vi.fn(),
    onRenameTodo: vi.fn().mockResolvedValue(undefined),
    onSetTodoPriority: vi.fn().mockResolvedValue(undefined),
    onRescheduleTodo: vi.fn().mockResolvedValue(undefined),
    onAddSticker: vi.fn(),
    onDeleteSticker: vi.fn(),
    ...overrides,
  };
  act(() => root.render(<DayDetailSheet {...props} />));
  return props;
}

function click(element: Element | null | undefined) {
  if (!element) throw new Error('element not found');
  act(() => {
    (element as HTMLElement).click();
  });
}

const picker = () => container.querySelector('.cal-day-sticker-pick');
const options = () => [...container.querySelectorAll('.cal-day-sticker-option')];

describe('DayDetailSheet all-day spans (DP-126)', () => {
  const travel: CalendarEvent = {
    id: 'travel', calendarId: CALENDAR, title: '三天旅行', location: null, notes: null,
    reminderMinutes: [], recurrence: null, sharingScope: 'inherit',
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    allDay: true, startDate: '2026-08-05', endDate: '2026-08-07',
  };

  it.each(['2026-08-05', '2026-08-06', '2026-08-07'])('lists the inclusive occupied day %s and opens the complete occurrence', (dateKey) => {
    const props = render({ dateKey, resolveOccurrences: occurrenceResolver([travel]), displayTimezone: 'Pacific/Honolulu' });
    const row = container.querySelector('.cal-day-event');
    expect(row?.textContent).toContain('三天旅行');
    expect(row?.textContent).toContain(dateKey === '2026-08-05' ? '全天' : '續 全天');
    click(row);
    expect(props.onOpenEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      event: travel,
      occurrence: { kind: 'all-day', date: '2026-08-05' },
    }));
  });

  it.each(['2026-08-04', '2026-08-08'])('does not list a day outside the span: %s', (dateKey) => {
    render({ dateKey, resolveOccurrences: occurrenceResolver([travel]) });
    expect(container.querySelector('.cal-day-event')).toBeNull();
  });
});

describe('DayDetailSheet subtasks (DP-116)', () => {
  function changeDate(value: string) {
    const input = container.querySelector<HTMLInputElement>('.cal-day-date-editor input')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return input;
  }
  it.each(['Escape', '取消', '同日保存'])('date edit %s does not write and returns focus to its trigger', async (action) => {
    const props = render({ todos: [todo('parent', null, '旅行')] });
    click(container.querySelector('button[aria-label="修改 旅行 的日期"]'));
    const input = changeDate(action === '同日保存' ? DATE : '2026-08-08');
    expect(document.activeElement).toBe(input);
    if (action === 'Escape') act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    else if (action === '取消') click(container.querySelector('.cal-day-date-editor button[type="button"]'));
    else await act(async () => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(props.onRescheduleTodo).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(container.querySelector('.cal-day-date-editor')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('button[aria-label="修改 旅行 的日期"]'));
  });
  it.each(['', '0099-01-01', '2026-02-30'])('refuses the native date draft %s and leaves the editor open', async (value) => {
    const props = render({ todos: [todo('parent', null, '旅行')] });
    click(container.querySelector('button[aria-label="修改 旅行 的日期"]'));
    const input = changeDate(value);
    const draft = input.value; // A native date input normalizes impossible days to blank.
    await act(async () => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(props.onRescheduleTodo).not.toHaveBeenCalled();
    expect(input.value).toBe(draft);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('有效');
  });
  it('awaits a completed child date edit once, keeps the rejected draft, then retries without toggling completion', async () => {
    let fail!: (error: Error) => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject; })).mockResolvedValue(undefined);
    const props = render({ todos: [todo('parent', null, '旅行'), todo('child', 'parent', '訂房', true)], onRescheduleTodo: save });
    click(container.querySelector('[aria-label="展開 旅行 的子項"]'));
    click(container.querySelector('button[aria-label="修改 訂房 的日期"]'));
    const input = changeDate('2026-08-08');
    act(() => {
      input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(save).toHaveBeenCalledExactlyOnceWith('child', '2026-08-08');
    expect(input.disabled).toBe(true);
    expect(container.querySelectorAll('.cal-day-date-editor button:disabled')).toHaveLength(2);
    expect(container.querySelector('.cal-day-sub-count')?.textContent).toContain('1/1');
    await act(async () => { fail(new Error('offline')); });
    expect(input.disabled).toBe(false);
    expect(input.value).toBe('2026-08-08');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('尚未保存');
    await act(async () => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(props.onToggleTodo).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(container.querySelector('.cal-day-done'));
  });
  it('does not take focus from a different control opened while a date save is pending', async () => {
    let finish!: () => void;
    render({ todos: [todo('parent', null, '旅行')], onRescheduleTodo: () => new Promise<void>((resolve) => { finish = resolve; }) });
    click(container.querySelector('button[aria-label="修改 旅行 的日期"]'));
    const input = changeDate('2026-08-08');
    act(() => input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    const otherInput = container.querySelector<HTMLInputElement>('[aria-label="新增清單項目"]')!;
    otherInput.focus();
    await act(async () => { finish(); });
    expect(document.activeElement).toBe(otherInput);
  });
  it('allows only one date write in the sheet so a parent cannot re-mount a pending child editor', async () => {
    let fail!: (error: Error) => void;
    const save = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    render({ todos: [todo('parent', null, '旅行'), todo('child', 'parent', '訂房', true)], onRescheduleTodo: save });
    click(container.querySelector('[aria-label="展開 旅行 的子項"]'));
    click(container.querySelector('button[aria-label="修改 訂房 的日期"]'));
    const child = changeDate('2026-08-08');
    click(container.querySelector('button[aria-label="修改 旅行 的日期"]'));
    const parent = container.querySelector<HTMLInputElement>('[aria-label="旅行 的日期"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(parent, '2026-08-09');
      parent.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      child.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      parent.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(save).toHaveBeenCalledExactlyOnceWith('child', '2026-08-08');
    expect(parent.disabled).toBe(true);
    expect(child.disabled).toBe(true);
    await act(async () => { fail(new Error('offline')); });
    expect(parent.disabled).toBe(false);
    expect(parent.value).toBe('2026-08-09');
    expect(child.value).toBe('2026-08-08');
    expect(child.form!.querySelector('[role="alert"]')?.textContent).toContain('尚未保存');
  });
  it('does not focus a replacement day sheet when an old pending save finishes', async () => {
    let finish!: () => void;
    const props = render({ todos: [todo('parent', null, '旅行')], onRescheduleTodo: () => new Promise<void>((resolve) => { finish = resolve; }) });
    click(container.querySelector('button[aria-label="修改 旅行 的日期"]'));
    const input = changeDate('2026-08-08');
    act(() => input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    act(() => root.render(<DayDetailSheet {...props} dateKey="2026-08-07" />));
    expect(document.activeElement).toBe(document.body);
    await act(async () => { finish(); });
    expect(document.activeElement).toBe(document.body);
  });
  it.each(['取消', 'Escape'])('waits before %s in another date editor, preserving both drafts and returning focus after settlement', async (action) => {
    let fail!: (error: Error) => void;
    const save = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    const props = render({ todos: [todo('parent', null, '旅行'), todo('child', 'parent', '訂房', true)], onRescheduleTodo: save });
    click(container.querySelector('[aria-label="展開 旅行 的子項"]'));
    click(container.querySelector('button[aria-label="修改 訂房 的日期"]'));
    const child = changeDate('2026-08-08');
    click(container.querySelector('button[aria-label="修改 旅行 的日期"]'));
    const parent = container.querySelector<HTMLInputElement>('[aria-label="旅行 的日期"]')!;
    const parentForm = parent.form!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(parent, '2026-08-09');
      parent.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => child.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    const cancel = parentForm.querySelector<HTMLButtonElement>('button[type="button"]')!;
    if (action === '取消') click(cancel);
    else act(() => parent.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(parentForm.isConnected).toBe(true);
    expect(cancel.disabled).toBe(true);
    expect(parent.value).toBe('2026-08-09');
    expect(child.value).toBe('2026-08-08');
    expect(save).toHaveBeenCalledExactlyOnceWith('child', '2026-08-08');
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => { fail(new Error('offline')); });
    expect(cancel.disabled).toBe(false);
    if (action === '取消') click(cancel);
    else act(() => parent.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(parentForm.isConnected).toBe(false);
    expect(document.activeElement).toBe(container.querySelector('button[aria-label="修改 旅行 的日期"]'));
    expect(child.value).toBe('2026-08-08');
    expect(save).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
  });
  it('changes priority on the completed child only and leaves completion controls intact', async () => {
    const props = render({ todos: [todo('parent', null, '旅行'), todo('child', 'parent', '訂房', true)] });
    click(container.querySelector('[aria-label="展開 旅行 的子項"]'));
    const select = container.querySelector<HTMLSelectElement>('[aria-label="訂房 的優先度"]')!;
    await act(async () => {
      select.value = 'low';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(props.onSetTodoPriority).toHaveBeenCalledExactlyOnceWith('child', 'low');
    expect(props.onToggleTodo).not.toHaveBeenCalled();
    expect(container.querySelector('.cal-day-sub-count')?.textContent).toContain('1/1');
  });
  it('disables pending priority edits, rejects duplicate submissions and keeps confirmed selection after failure', async () => {
    let reject!: (error: Error) => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; })).mockResolvedValue(undefined);
    const row = todo('parent', null, '旅行');
    render({ todos: [row], onSetTodoPriority: save });
    const select = container.querySelector<HTMLSelectElement>('[aria-label="旅行 的優先度"]')!;
    act(() => {
      select.value = 'high';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      select.value = 'low';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(save).toHaveBeenCalledExactlyOnceWith('parent', 'high');
    expect(select.disabled).toBe(true);
    await act(async () => { reject(new Error('offline')); });
    expect(select.value).toBe(row.priority);
    expect(select.disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('尚未保存');
    await act(async () => {
      select.value = 'medium';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it('keeps an overlong rename draft, then allows 300 emoji', async () => {
    const props = render({ todos: [todo('parent', null, '旅行')] });
    click(container.querySelector('button[aria-label="修改 旅行 的標題"]'));
    let input = changeTitle('字'.repeat(301));
    await act(async () => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(input.value).toBe('字'.repeat(301));
    expect(props.onRenameTodo).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('最多 300');
    input = changeTitle('😀'.repeat(300));
    await act(async () => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(props.onRenameTodo).toHaveBeenCalledExactlyOnceWith('parent', '😀'.repeat(300));
  });
  it.each(['新增清單項目', '新增 旅行 的細項'])('retains an overlong %s draft without creating a todo', (label) => {
    const props = render({ todos: [todo('parent', null, '旅行')] });
    click(container.querySelector('[aria-label="展開 旅行 的子項"]'));
    const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '字'.repeat(301));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(props.onAddTodo).not.toHaveBeenCalled();
    expect(input.value).toBe('字'.repeat(301));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('最多 300');
  });
  function changeTitle(value: string) {
    const input = container.querySelector<HTMLInputElement>('[aria-label="待辦標題"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return input;
  }
  it('parent edit cancels with Escape, keeps the day sheet and restores focus without writing', () => {
    const props = render({ todos: [todo('parent', null, '旅行')] });
    click(container.querySelector('button[aria-label="修改 旅行 的標題"]'));
    const input = changeTitle('取消的草稿');
    expect(document.activeElement).toBe(input);
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(container.querySelector('[aria-label="待辦標題"]')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('button[aria-label="修改 旅行 的標題"]'));
    expect(props.onRenameTodo).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });
  it('child edit rejects blanks, trims the title and waits for confirmation before closing', async () => {
    let finish!: () => void;
    const rename = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render({ todos: [todo('parent', null, '旅行'), todo('child', 'parent', '訂房', true)], onRenameTodo: rename });
    click(container.querySelector('[aria-label="展開 旅行 的子項"]'));
    click(container.querySelector('button[aria-label="修改 訂房 的標題"]'));
    let input = changeTitle('  ');
    act(() => input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(rename).not.toHaveBeenCalled();
    input = changeTitle('  預訂飯店  ');
    act(() => input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(rename).toHaveBeenCalledExactlyOnceWith('child', '預訂飯店');
    expect(input.disabled).toBe(true);
    expect(container.querySelector('.cal-day-sub-count')?.textContent).toContain('1/1');
    await act(async () => { finish(); });
    expect(container.querySelector('[aria-label="待辦標題"]')).toBeNull();
  });
  it('failed title edit keeps the draft and can retry once the repository recovers', async () => {
    const rename = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    render({ todos: [todo('parent', null, '旅行')], onRenameTodo: rename });
    click(container.querySelector('button[aria-label="修改 旅行 的標題"]'));
    const input = changeTitle('新標題');
    await act(async () => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(input.value).toBe('新標題');
    expect(input.disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('尚未保存');
    await act(async () => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(rename).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[aria-label="待辦標題"]')).toBeNull();
  });
  function todo(id: string, parentId: string | null, title: string, done = false): TodoItem {
    return { id, parentId, title, calendarId: CALENDAR, dueDate: DATE, priority: 'none', completedAt: done ? '2026-08-01T00:00:00.000Z' : null, sortOrder: id === 'parent' ? 0 : 1, sharingScope: 'inherit', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' };
  }
  it('groups child rows, shows progress, expands and toggles only the named child', () => {
    const props = render({ todos: [todo('parent', null, '旅行'), todo('a', 'parent', '訂房'), todo('b', 'parent', '訂票', true)] });
    expect(container.querySelectorAll('.cal-day-todo')).toHaveLength(1);
    expect(container.querySelector('.cal-day-sub-count')?.textContent).toContain('1/2');
    expect(container.querySelector('.cal-day-subtasks')).toBeNull();
    click(container.querySelector('[aria-label="展開 旅行 的子項"]'));
    click(container.querySelector('[aria-label="完成 訂房"]'));
    expect(props.onToggleTodo).toHaveBeenCalledWith('a');
    expect(props.onToggleTodo).toHaveBeenCalledTimes(1);
    click(container.querySelector('[aria-label="刪除 訂票"]'));
    expect(props.onDeleteTodo).toHaveBeenCalledWith('b');
    click(container.querySelector('[aria-label="收合 旅行 的子項"]'));
    expect(container.querySelector('.cal-day-subtasks')).toBeNull();
  });
  it('creates a trimmed child for its root and clears the draft; blank submissions do nothing', () => {
    const props = render({ todos: [todo('parent', null, '旅行')] });
    click(container.querySelector('[aria-label="展開 旅行 的子項"]'));
    const input = container.querySelector<HTMLInputElement>('[aria-label="新增 旅行 的細項"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '  訂房  ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(props.onAddTodo).toHaveBeenCalledWith({ title: '訂房', date: DATE, parentId: 'parent' });
    expect(input.value).toBe('');
    act(() => input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(props.onAddTodo).toHaveBeenCalledTimes(1);
  });
  /** Opens the sublist and types into either add form — DP-137. */
  function typeNewTodo(label: string, value: string) {
    click(container.querySelector('[aria-label="展開 旅行 的子項"]'));
    const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    input.focus();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return input;
  }
  const submitForm = (input: HTMLInputElement) =>
    act(async () => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  const ADD_FORMS = [
    ['新增清單項目', { title: '訂車票', date: DATE }],
    ['新增 旅行 的細項', { title: '訂車票', date: DATE, parentId: 'parent' }],
  ] as const;

  it.each(ADD_FORMS)('%s keeps the typed title, focus and a single request until the add is confirmed (DP-137)', async (label, expected) => {
    let finish!: () => void;
    const add = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render({ todos: [todo('parent', null, '旅行')], onAddTodo: add });
    const input = typeNewTodo(label, '訂車票');
    await submitForm(input);
    expect(add).toHaveBeenCalledExactlyOnceWith(expected);
    expect(input.value).toBe('訂車票');
    expect(input.readOnly).toBe(true);
    expect(input.disabled).toBe(false);
    expect(input.form!.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(input);
    await submitForm(input);
    click(input.form!.querySelector('button[type="submit"]'));
    expect(add).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    expect(input.value).toBe('');
    expect(input.readOnly).toBe(false);
    expect(input.form!.getAttribute('aria-busy')).toBe('false');
    expect(document.activeElement).toBe(input);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it.each(ADD_FORMS)('%s keeps the typed title after a rejected add and sends it again only on an explicit retry (DP-137)', async (label, expected) => {
    const add = vi.fn<(input: unknown) => Promise<void>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    render({ todos: [todo('parent', null, '旅行')], onAddTodo: add });
    const input = typeNewTodo(label, '訂車票');
    await submitForm(input);
    expect(add).toHaveBeenCalledExactlyOnceWith(expected);
    expect(input.value).toBe('訂車票');
    expect(input.readOnly).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('待辦尚未確認新增，輸入內容已保留；請先確認清單再重試。');
    await submitForm(input);
    expect(add).toHaveBeenCalledTimes(2);
    expect(add.mock.calls[1]).toEqual(add.mock.calls[0]);
    expect(input.value).toBe('');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('a pending add settles quietly after the day sheet has closed (DP-137)', async () => {
    let finish!: () => void;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const props = render({ todos: [todo('parent', null, '旅行')], onAddTodo: () => new Promise<void>((resolve) => { finish = resolve; }) });
    await submitForm(typeNewTodo('新增清單項目', '訂車票'));
    act(() => root.render(<DayDetailSheet {...props} dateKey={null} />));
    await act(async () => { finish(); });
    expect(container.querySelector('.cal-day-sheet')).toBeNull();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('resets expansion when switching dates and keeps imported nested children operable', () => {
    const props = render({ todos: [todo('parent', null, '旅行'), todo('a', 'parent', '訂房'), todo('b', 'a', '付訂金')] });
    click(container.querySelector('[aria-label="展開 旅行 的子項"]'));
    expect(container.querySelectorAll('.cal-day-subtask')).toHaveLength(2);
    expect(container.querySelectorAll('.cal-day-sub-add')).toHaveLength(1);
    click(container.querySelector('[aria-label="完成 付訂金"]'));
    expect(props.onToggleTodo).toHaveBeenCalledWith('b');
    act(() => root.render(<DayDetailSheet {...props} dateKey="2026-08-07" />));
    act(() => root.render(<DayDetailSheet {...props} />));
    expect(container.querySelector('.cal-day-subtasks')).toBeNull();
  });
});

/**
 * DP-064. The month cell for the second day of an overnight event says 「續」;
 * opening that cell used to show 「這天沒有行程」, because this sheet still
 * filtered on the event's starting day.
 */
describe('DayDetailSheet cross-midnight events', () => {
  /** 23:00 on the 6th → 00:30 on the 7th, Taipei. */
  const overnight = timedEventFromWallTime(
    {
      id: 'overnight',
      calendarId: CALENDAR,
      title: '夜班',
      location: null,
      notes: null,
      reminderMinutes: [],
      recurrence: null,
      sharingScope: 'inherit' as const,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    { date: DATE, start: '23:00', end: '00:30' },
    'Asia/Taipei',
  );

  function rows(): string[] {
    return [...container.querySelectorAll('.cal-day-event')].map((el) =>
      (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
  }

  it('lists the first day with the segment that actually falls on it', () => {
    render({ dateKey: DATE, resolveOccurrences: occurrenceResolver([overnight]) });

    // 23:00–24:00, not 23:00–00:30: the sheet shows this day's part.
    expect(rows().join(' | ')).toContain('23:00–24:00');
    expect(rows().join(' | ')).toContain('夜班');
  });

  it('lists the second day as a continuation instead of showing nothing', () => {
    render({ dateKey: '2026-08-07', resolveOccurrences: occurrenceResolver([overnight]) });

    const text = rows().join(' | ');
    expect(text).toContain('夜班');
    expect(text).toContain('續');
    expect(text).toContain('00:00–00:30');
    expect(container.textContent).not.toContain('這天沒有行程');
  });

  it('leaves an unrelated day empty', () => {
    render({ dateKey: '2026-08-09', resolveOccurrences: occurrenceResolver([overnight]) });

    expect(rows()).toEqual([]);
    expect(container.textContent).toContain('這天沒有行程');
  });
});

describe('DayDetailSheet stickers', () => {
  it('keeps the picker closed until ＋ 貼圖 is tapped', () => {
    render();
    expect(picker()).toBeNull();

    click(container.querySelector('.cal-day-sticker-add'));

    expect(picker()).not.toBeNull();
    expect(options()).toHaveLength(STICKER_GLYPHS.length);
  });

  it('adds the tapped glyph for this day and closes the picker', () => {
    const props = render();
    click(container.querySelector('.cal-day-sticker-add'));

    click(options()[12]);

    expect(props.onAddSticker).toHaveBeenCalledWith({ date: DATE, glyph: STICKER_GLYPHS[12] });
    // The原檔 closes after one pick rather than staying open.
    expect(picker()).toBeNull();
  });

  it('shows only this day’s stickers and deletes the one tapped', () => {
    const props = render({
      stickers: [sticker('a', '🎂'), sticker('b', '✈️'), sticker('c', '❤️', '2026-08-07')],
    });

    const shown = [...container.querySelectorAll('.cal-day-sticker')];
    expect(shown.map((node) => node.textContent)).toEqual(['🎂', '✈️']);

    click(shown[1]);

    expect(props.onDeleteSticker).toHaveBeenCalledWith('b');
  });

  it('closes the picker when a different day is opened', () => {
    const props = render();
    click(container.querySelector('.cal-day-sticker-add'));
    expect(picker()).not.toBeNull();

    act(() => root.render(<DayDetailSheet {...props} dateKey="2026-08-07" />));

    expect(picker()).toBeNull();
  });
});

describe('DayDetailSheet event rows', () => {
  // The原檔 puts the location on a second line under the title. DP-058 had no
  // location to show; DP-060 stored one, so the line belongs back here.
  it('shows the location under the title when the event has one', () => {
    render({ resolveOccurrences: occurrenceResolver([event('e1', '客戶會議', '會議室A')]) });

    expect(container.querySelector('.cal-day-event-title')?.textContent).toBe('客戶會議');
    expect(container.querySelector('.cal-day-event-loc')?.textContent).toBe('會議室A');
  });

  it('leaves the second line out entirely when there is no location', () => {
    render({ resolveOccurrences: occurrenceResolver([event('e1', '客戶會議', null)]) });

    expect(container.querySelector('.cal-day-event-title')?.textContent).toBe('客戶會議');
    expect(container.querySelector('.cal-day-event-loc')).toBeNull();
  });
});
