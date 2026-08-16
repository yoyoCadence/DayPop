import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timedEventFromWallTime } from '../../domain/eventTime';
import type { CalendarEvent, TimedCalendarEvent } from '../../domain/types';
import { WeekView } from './WeekView';

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

function render(events: CalendarEvent[]) {
  onOpenEvent.mockClear();
  act(() =>
    root.render(
      <WeekView
        weekStartsOn={0}
        displayTimezone={ZONE}
        cursor={CURSOR}
        todayKey={CURSOR}
        events={events}
        calendars={[]}
        onUpdateEvent={vi.fn()}
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

describe('WeekView cross-midnight segments', () => {
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

  it('opens the event from a continuation block, which cannot be dragged', () => {
    render([timed('overnight', '夜班', { date: CURSOR, start: '23:00', end: '00:30' })]);

    const columns = blocksByColumn();
    // A drag rewrites one wall-clock range on one day, so neither block of a
    // multi-day occurrence offers one (DP-072).
    expect(columns[3]![0]!.hasResizeHandle).toBe(false);
    expect(columns[4]![0]!.hasResizeHandle).toBe(false);

    act(() => {
      columns[4]![0]!.element.click();
    });
    expect(onOpenEvent).toHaveBeenCalledWith('overnight');
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
