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
