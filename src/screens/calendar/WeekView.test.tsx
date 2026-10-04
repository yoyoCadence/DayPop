import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timedEventFromWallTime } from '../../domain/eventTime';
import {
  resolveEventOccurrences,
  type OccurrenceWindow,
} from '../../domain/recurrence';
import type { AllDayCalendarEvent, CalendarEvent, TimedCalendarEvent } from '../../domain/types';
import { WeekView } from './WeekView';
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
 * 週檢視 was the last view still drawing cross-midnight events on a fixed
 * 07:00–22:00 rail — DP-064. A 23:00 event was clamped onto the 22:00 line,
 * which shows the wrong time, and the second day showed nothing at all while the
 * month cell for it said 「續」.
 */

const ZONE = 'Asia/Taipei';
const CALENDAR = '33333333-3333-4333-8333-333333333333';
/** Wednesday; the week (weekStartsOn 0) runs 2026-08-09 … 2026-08-15. */
const CURSOR = '2026-08-12';

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

function timed(
  id: string,
  title: string,
  wall: { date: string; start: string; end: string },
): TimedCalendarEvent {
  return timedEventFromWallTime(
    {
      id,
      calendarId: CALENDAR,
      title,
      location: null,
      notes: null,
      reminderMinutes: [],
      recurrence: null,
      sharingScope: 'inherit' as const,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    wall,
    ZONE,
  );
}

/** Builds an event straight from instants, for spans a wall time cannot express. */
function spanning(
  id: string,
  title: string,
  startsAt: string,
  endsAt: string,
): TimedCalendarEvent {
  return {
    ...timed(id, title, { date: CURSOR, start: '09:00', end: '10:00' }),
    startsAt,
    endsAt,
  };
}

const onOpenEvent = vi.fn();
const onDragEvent = vi.fn();

function render(events: CalendarEvent[]) {
  onOpenEvent.mockClear();
  onDragEvent.mockClear();
  act(() =>
    root.render(
      <WeekView
        weekStartsOn={0}
        displayTimezone={ZONE}
        cursor={CURSOR}
        todayKey={CURSOR}
        resolveOccurrences={occurrenceResolver(events)}
        calendars={[]}
        onDragEvent={onDragEvent}
        onOpenEvent={onOpenEvent}
      />,
    ),
  );
}

interface Block {
  element: HTMLElement;
  label: string;
  time: string;
  top: number;
  height: number;
  hasResizeHandle: boolean;
}

/** Blocks per weekday column, index 0 = the first column of the week. */
function blocksByColumn(): Block[][] {
  return Array.from(container.querySelectorAll('.cal-week-col')).map((column) =>
    Array.from(column.querySelectorAll<HTMLElement>('.cal-week-event')).map((element) => ({
      element,
      label: element.getAttribute('aria-label') ?? '',
      time: element.querySelector('.cal-week-event-time')?.textContent ?? '',
      top: Number.parseInt(element.style.top, 10),
      height: Number.parseInt(element.style.height, 10),
      hasResizeHandle: element.querySelector('.cal-week-event-resize') !== null,
    })),
  );
}

function railLabels(): string[] {
  return Array.from(container.querySelectorAll('.cal-week-hour-label')).map(
    (label) => label.textContent ?? '',
  );
}

function gridHeightPx(): number {
  const grid = container.querySelector<HTMLElement>('.cal-week-grid');
  return Number.parseInt(grid?.style.height ?? '0', 10);
}

function allDay(id: string, title: string, startDate: string, endDate = startDate): AllDayCalendarEvent {
  return {
    id, title, calendarId: CALENDAR, location: null, notes: null,
    reminderMinutes: [], recurrence: null, sharingScope: 'inherit',
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    allDay: true, startDate, endDate,
  };
}

describe('WeekView 全天列（DP-114）', () => {
  it('inclusive 多日事件只走本週七天，後續日標續，全天不延長 timed rail', () => {
    render([allDay('trip', '長假', '2020-01-01', '2030-12-31'), allDay('day', '週三休假', CURSOR)]);
    const cols = Array.from(container.querySelectorAll('.cal-week-all-day-col'));
    expect(cols.map((col) => col.querySelectorAll('button').length)).toEqual([1, 1, 1, 2, 1, 1, 1]);
    expect(cols[0]!.textContent).toBe('續 長假');
    expect(cols[3]!.querySelectorAll('button')[1]!.getAttribute('aria-label')).toBe('2026-08-12 全天 週三休假');
    expect(blocksByColumn().flat()).toHaveLength(0);
    expect(railLabels()[0]).toBe('07:00');
    expect(railLabels().at(-1)).toBe('22:00');
  });

  it('首日到 inclusive 結束日各出現一次，前後日不出現', () => {
    render([allDay('trip', '旅行', '2026-08-10', '2026-08-12')]);
    const cols = Array.from(container.querySelectorAll('.cal-week-all-day-col'));
    expect(cols.map((col) => col.querySelectorAll('button').length)).toEqual([0, 1, 1, 1, 0, 0, 0]);
    expect(cols[1]!.textContent).toBe('旅行');
    expect(cols[3]!.textContent).toBe('續 旅行');
    act(() => cols[3]!.querySelector<HTMLButtonElement>('button')!.click());
    expect(onOpenEvent).toHaveBeenCalledWith(expect.objectContaining({ sourceEventId: 'trip', event: expect.objectContaining({ startDate: '2026-08-10', endDate: '2026-08-12' }) }));
    expect(onDragEvent).not.toHaveBeenCalled();
  });

  it('同週多個 occurrence 分別開啟其日期，不使用系列錨點', () => {
    render([{ ...allDay('series', '休息日', '2026-08-07'), recurrence: { rule: 'FREQ=DAILY;INTERVAL=3;COUNT=4' } }]);
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.cal-week-all-day-event'));
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['2026-08-10 全天 休息日', '2026-08-13 全天 休息日']);
    act(() => buttons[1]!.click());
    expect(onOpenEvent).toHaveBeenCalledWith(expect.objectContaining({ sourceEventId: 'series', occurrence: { kind: 'all-day', date: '2026-08-13' } }));
  });

  it('沒有當週全天事件時不畫額外列，timed 格線仍存在', () => {
    render([allDay('outside', '下週休假', '2026-08-16'), timed('meeting', '會議', { date: CURSOR, start: '09:00', end: '10:00' })]);
    expect(container.querySelector('.cal-week-all-day')).toBeNull();
    expect(blocksByColumn()[3]![0]!.label).toBe('09:00–10:00 會議');
  });
});

describe('WeekView cross-midnight segments', () => {
  function pointer(element: HTMLElement | Window, type: string, x: number, y: number, pointerId = 1) {
    act(() => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerId', { value: pointerId });
      element.dispatchEvent(event);
    });
  }
  it('re-cuts the complete interval during a drag before sending any mutation', () => {
    render([timed('overnight', '夜班', { date: CURSOR, start: '23:00', end: '00:30' })]);
    pointer(blocksByColumn()[3]![0]!.element, 'pointerdown', 100, 100);
    pointer(window, 'pointermove', 100, 144);
    expect(blocksByColumn()[3]).toHaveLength(0);
    expect(blocksByColumn()[4]![0]!.label).toBe('00:00–01:30 夜班');
    expect(onDragEvent).not.toHaveBeenCalled();
    pointer(window, 'pointerup', 100, 144);
    expect(onDragEvent).toHaveBeenCalledWith(expect.objectContaining({ sourceEventId: 'overnight' }), {
      timedInterval: { startsAt: '2026-08-12T16:00:00.000Z', endsAt: '2026-08-12T17:30:00.000Z' },
    });
  });
  it('treats a 24:00 endpoint as a full interval even when only one day is occupied', () => {
    render([timed('midnight', '夜班', { date: CURSOR, start: '23:00', end: '00:00' })]);
    pointer(blocksByColumn()[3]![0]!.element, 'pointerdown', 100, 100);
    pointer(window, 'pointermove', 100, 144);
    pointer(window, 'pointerup', 100, 144);
    expect(onDragEvent.mock.calls[0]![1]).toEqual({ timedInterval: {
      startsAt: '2026-08-12T16:00:00.000Z', endsAt: '2026-08-12T17:00:00.000Z',
    } });
  });
  it('moves both endpoints when a continuation is dragged to another column', () => {
    render([timed('overnight', '夜班', { date: CURSOR, start: '23:00', end: '00:30' })]);
    pointer(blocksByColumn()[4]![0]!.element, 'pointerdown', 100, 100);
    pointer(window, 'pointermove', 160, 144);
    pointer(window, 'pointerup', 160, 144);
    expect(onDragEvent.mock.calls[0]![1]).toEqual({
      timedInterval: { startsAt: '2026-08-13T16:00:00.000Z', endsAt: '2026-08-13T17:30:00.000Z' },
    });
  });
  it('resizes the true ending endpoint from the final handle', () => {
    render([timed('overnight', '夜班', { date: CURSOR, start: '23:00', end: '00:30' })]);
    pointer(blocksByColumn()[4]![0]!.element.querySelector<HTMLElement>('.cal-week-event-resize')!, 'pointerdown', 100, 100);
    pointer(window, 'pointermove', 100, 144);
    pointer(window, 'pointerup', 100, 144);
    expect(onDragEvent.mock.calls[0]![1]).toEqual({
      timedInterval: { startsAt: '2026-08-12T15:00:00.000Z', endsAt: '2026-08-12T17:30:00.000Z' },
    });
  });
  it('pointercancel restores segments and a different pointer cannot commit the gesture', () => {
    render([timed('overnight', '夜班', { date: CURSOR, start: '23:00', end: '00:30' })]);
    pointer(blocksByColumn()[3]![0]!.element, 'pointerdown', 100, 100);
    pointer(window, 'pointermove', 100, 144);
    pointer(window, 'pointerup', 100, 144, 2);
    expect(onDragEvent).not.toHaveBeenCalled();
    pointer(window, 'pointercancel', 100, 144);
    pointer(window, 'pointerup', 100, 144);
    expect(onDragEvent).not.toHaveBeenCalled();
    expect(blocksByColumn()[3]![0]!.label).toBe('23:00–24:00 夜班');
    expect(blocksByColumn()[4]![0]!.label).toBe('續 00:00–00:30 夜班');
  });
  it('a tap opens the occurrence and does not submit an interval', () => {
    render([timed('overnight', '夜班', { date: CURSOR, start: '23:00', end: '00:30' })]);
    pointer(blocksByColumn()[4]![0]!.element, 'pointerdown', 100, 100);
    pointer(window, 'pointerup', 100, 100);
    expect(onOpenEvent).toHaveBeenCalledWith(expect.objectContaining({ sourceEventId: 'overnight' }));
    expect(onDragEvent).not.toHaveBeenCalled();
  });
  it('draws a block on both days, the second marked as a continuation', () => {
    render([timed('overnight', '夜班', { date: CURSOR, start: '23:00', end: '00:30' })]);

    const columns = blocksByColumn();
    // 2026-08-12 is the fourth column of a week starting Sunday 08-09.
    expect(columns[3]).toHaveLength(1);
    expect(columns[4]).toHaveLength(1);

    // The first night stops at 24:00 rather than wrapping to 00:00, which would
    // read as a zero-length event.
    expect(columns[3]![0]!.label).toBe('23:00–24:00 夜班');
    expect(columns[3]![0]!.time).toBe('23:00');
    expect(columns[4]![0]!.label).toBe('續 00:00–00:30 夜班');
    expect(columns[4]![0]!.time).toBe('續 00:00');
  });

  it('extends the rail to cover the segments instead of clamping them', () => {
    render([timed('overnight', '夜班', { date: CURSOR, start: '23:00', end: '00:30' })]);

    const rail = railLabels();
    // 00:00 … 24:00: the range grew from the baseline at both ends.
    expect(rail).toHaveLength(25);
    expect(rail[0]).toBe('00:00');
    expect(rail.at(-1)).toBe('24:00');

    const columns = blocksByColumn();
    const first = columns[3]![0]!;
    // 23:00 sits 23 hours down a midnight rail. Against the old fixed 07:00
    // rail it computed a top of 704px on a 676px grid — below the grid it was
    // supposedly inside.
    expect(first.top).toBe(23 * 44);
    expect(first.height).toBe(44);
    expect(first.top + first.height).toBeLessThanOrEqual(gridHeightPx());

    const second = columns[4]![0]!;
    expect(second.top).toBe(0);
  });

  it('keeps the原檔 rail when the week stays inside it', () => {
    render([timed('day', '晨會', { date: CURSOR, start: '09:00', end: '10:00' })]);

    const rail = railLabels();
    expect(rail).toHaveLength(16);
    expect(rail[0]).toBe('07:00');
    expect(rail.at(-1)).toBe('22:00');

    const block = blocksByColumn()[3]![0]!;
    expect(block.top).toBe(2 * 44);
    expect(block.time).toBe('09:00');
  });

  it('offers resize only on the final continuation, and keyboard opens its occurrence (DP-072)', () => {
    render([timed('overnight', '夜班', { date: CURSOR, start: '23:00', end: '00:30' })]);

    const columns = blocksByColumn();
    // Complete interval drags can move either segment, but resize is only at
    // the actual endpoint, not the first segment's midnight cut.
    expect(columns[3]![0]!.hasResizeHandle).toBe(false);
    expect(columns[4]![0]!.hasResizeHandle).toBe(true);

    act(() => {
      columns[4]![0]!.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    // DP-082: 帶回的是被點到的那一次 occurrence，不再只是事件 id。
    expect(onOpenEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sourceEventId: 'overnight' }),
    );
  });

  it('still offers drag and resize on a single-day event', () => {
    render([timed('day', '晨會', { date: CURSOR, start: '09:00', end: '10:00' })]);

    expect(blocksByColumn()[3]![0]!.hasResizeHandle).toBe(true);
  });

  it('draws every day an event covers, not just its ends', () => {
    // Taipei 08-11 20:00 → 08-14 02:00. A wall-time pair cannot express a span
    // of several days, so this one is built from instants.
    render([
      spanning('long', '出差', '2026-08-11T12:00:00.000Z', '2026-08-13T18:00:00.000Z'),
    ]);

    const counts = blocksByColumn().map((column) => column.length);
    // Columns are 08-09 … 08-15, so the event fills the third through sixth.
    expect(counts).toEqual([0, 0, 1, 1, 1, 1, 0]);

    const columns = blocksByColumn();
    expect(columns[2]![0]!.label).toBe('20:00–24:00 出差');
    // A middle day is a full 24 hours and still says 「續」.
    expect(columns[3]![0]!.label).toBe('續 00:00–24:00 出差');
    expect(columns[5]![0]!.label).toBe('續 00:00–02:00 出差');
  });
});

describe('WeekView 重複事件（DP-081）', () => {
  /** 每週三 09:00–10:00，涵蓋游標所在的那一週。 */
  function weekly(): TimedCalendarEvent {
    const base = timed('r1', '週會', { date: '2026-07-29', start: '09:00', end: '10:00' });
    return { ...base, recurrence: { rule: 'FREQ=WEEKLY;COUNT=8' } };
  }

  it('把落在這一週的那一次畫出來，而不是只畫系列的第一天', () => {
    render([weekly()]);

    const columns = blocksByColumn();
    // 這一週是 08-09～08-15，系列第一次在 07-29，所以畫出來的是 08-12 那一次。
    const withBlocks = columns.filter((column) => column.length > 0);
    expect(withBlocks).toHaveLength(1);
    expect(columns[3]![0]!.label).toBe('09:00–10:00 週會');
  });

  it('重複事件提供拖曳與縮放，也可用鍵盤開啟那一次', () => {
    render([weekly()]);

    const block = blocksByColumn()[3]![0]!;
    expect(block.hasResizeHandle).toBe(true);

    act(() => block.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    // 點開的是 08-12 那一次，不是系列本身 —— 這正是範圍對話框要用的資訊（DP-082）。
    expect(onOpenEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceEventId: 'r1',
        occurrence: { kind: 'timed', startsAt: '2026-08-12T01:00:00.000Z' },
      }),
    );
  });

  it('非重複事件仍然可拖曳，這條限制只針對重複', () => {
    render([timed('s1', '單次會議', { date: CURSOR, start: '09:00', end: '10:00' })]);

    expect(blocksByColumn()[3]![0]!.hasResizeHandle).toBe(true);
  });

  it('同一週出現兩次的系列會畫成兩個色塊', () => {
    const base = timed('r2', '雙週', { date: '2026-08-10', start: '09:00', end: '10:00' });
    render([{ ...base, recurrence: { rule: 'FREQ=DAILY;INTERVAL=3;COUNT=4' } }]);

    const columns = blocksByColumn();
    // 08-10、08-13 都在這一週內。
    expect(columns[1]![0]!.label).toBe('09:00–10:00 雙週');
    expect(columns[4]![0]!.label).toBe('09:00–10:00 雙週');
  });

  it('只展開這一週，不會把整個系列都算出來', () => {
    const windows: { startDate: string; endDate: string }[] = [];
    act(() =>
      root.render(
        <WeekView
          weekStartsOn={0}
          displayTimezone={ZONE}
          cursor={CURSOR}
          todayKey={CURSOR}
          resolveOccurrences={(window) => {
            windows.push(window);
            return [];
          }}
          calendars={[]}
          onDragEvent={vi.fn()}
          onOpenEvent={vi.fn()}
        />,
      ),
    );

    expect(windows).toEqual([{ startDate: '2026-08-09', endDate: '2026-08-15' }]);
  });
});
