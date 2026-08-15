import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timedEventFromWallTime } from '../../domain/eventTime';
import { STICKER_GLYPHS } from '../../domain/stickerGlyphs';
import type { CalendarEvent, Sticker } from '../../domain/types';
import { DayDetailSheet, type DayDetailSheetProps } from './DayDetailSheet';

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
    events: [],
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
    render({ dateKey: DATE, events: [overnight] });

    // 23:00–24:00, not 23:00–00:30: the sheet shows this day's part.
    expect(rows().join(' | ')).toContain('23:00–24:00');
    expect(rows().join(' | ')).toContain('夜班');
  });

  it('lists the second day as a continuation instead of showing nothing', () => {
    render({ dateKey: '2026-08-07', events: [overnight] });

    const text = rows().join(' | ');
    expect(text).toContain('夜班');
    expect(text).toContain('續');
    expect(text).toContain('00:00–00:30');
    expect(container.textContent).not.toContain('這天沒有行程');
  });

  it('leaves an unrelated day empty', () => {
    render({ dateKey: '2026-08-09', events: [overnight] });

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
    render({ events: [event('e1', '客戶會議', '會議室A')] });

    expect(container.querySelector('.cal-day-event-title')?.textContent).toBe('客戶會議');
    expect(container.querySelector('.cal-day-event-loc')?.textContent).toBe('會議室A');
  });

  it('leaves the second line out entirely when there is no location', () => {
    render({ events: [event('e1', '客戶會議', null)] });

    expect(container.querySelector('.cal-day-event-title')?.textContent).toBe('客戶會議');
    expect(container.querySelector('.cal-day-event-loc')).toBeNull();
  });
});
