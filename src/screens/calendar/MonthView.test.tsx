import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fromDateKey, toDateKey } from '../../domain/date';
import { lunarCell } from '../../domain/lunar';
import type { CalendarEvent, Sticker } from '../../domain/types';
import { MonthView } from './MonthView';

/**
 * The month cell is where the sticker sizing rule lives, and it is the one
 * part of DP-055 that is a layout rule rather than an interaction.
 */

const TODAY = toDateKey(new Date());

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

function sticker(id: string, glyph: string, date = TODAY): Sticker {
  return {
    id,
    calendarId: '33333333-3333-4333-8333-333333333333',
    date,
    glyph,
    assetKey: null,
    sortOrder: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function render(stickers: Sticker[], weekStartsOn: 0 | 1 = 0) {
  act(() =>
    root.render(
      <MonthView
        weekStartsOn={weekStartsOn}
        displayTimezone="Asia/Taipei"
        calendarGridMode="fixed-six"
        events={[]}
        stickers={stickers}
        calendars={[]}
        selectedDate={TODAY}
        todayKey={TODAY}
        flashToday={false}
        onSelectDate={vi.fn()}
        onPeriodLabelChange={vi.fn()}
      />,
    ),
  );
}

function cell(dateKey: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`[data-date-key="${dateKey}"]`);
}

/** The one cell in the tab order. */
function tabbableKeys(): string[] {
  return [...container.querySelectorAll<HTMLButtonElement>('[data-date-key]')]
    .filter((button) => button.tabIndex === 0)
    .map((button) => button.dataset.dateKey ?? '');
}

function pressOn(dateKey: string, key: string) {
  const button = cell(dateKey);
  if (!button) throw new Error(`no cell for ${dateKey}`);
  act(() => {
    button.focus();
    button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

/** The sticker row inside today's cell, whatever else the grid renders. */
function todayStickerRow(): HTMLElement | null {
  const cell = container.querySelector(`[aria-label^="${TODAY}"]`);
  return cell?.querySelector('.cal-cell-stickers') ?? null;
}

describe('MonthView stickers', () => {
  it('renders no sticker row for a day without stickers', () => {
    render([]);
    expect(todayStickerRow()).toBeNull();
  });

  it('sizes the glyphs by how many share the day', () => {
    render([sticker('a', '🎂')]);
    expect(todayStickerRow()?.style.fontSize).toBe('19px');

    render([sticker('a', '🎂'), sticker('b', '✈️')]);
    expect(todayStickerRow()?.style.fontSize).toBe('15px');

    render([sticker('a', '🎂'), sticker('b', '✈️'), sticker('c', '❤️')]);
    expect(todayStickerRow()?.style.fontSize).toBe('12px');

    render([
      sticker('a', '🎂'),
      sticker('b', '✈️'),
      sticker('c', '❤️'),
      sticker('d', '⭐'),
      sticker('e', '🏆'),
    ]);
    const row = todayStickerRow();
    expect(row?.style.fontSize).toBe('10px');
    expect(row?.textContent).toBe('🎂✈️❤️⭐🏆');
  });

  it('keeps another day’s stickers out of this cell', () => {
    render([sticker('a', '🎂'), sticker('b', '✈️', '2000-01-01')]);
    expect(todayStickerRow()?.textContent).toBe('🎂');
  });
});

/**
 * DP-064. A grid can only be drawn in one timezone. Placement used to come from
 * `event.timezone`, so an event created in another zone landed in *its own*
 * day's cell — two events at the same instant could sit in different cells.
 */
describe('MonthView display timezone', () => {
  function crossZoneEvent(): CalendarEvent {
    // 20:00 on the 6th in New York is 08:00 on the 7th in Taipei.
    return {
      id: '88888888-8888-4888-8888-888888888888',
      calendarId: '11111111-1111-4111-8111-111111111111',
      title: '跨時區會議',
      location: null,
      notes: null,
      reminderMinutes: [],
      recurrence: null,
      sharingScope: 'inherit',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      allDay: false,
      startsAt: '2026-08-07T00:00:00.000Z',
      endsAt: '2026-08-07T01:00:00.000Z',
      timezone: 'America/New_York',
    };
  }

  function renderWithZone(displayTimezone: string) {
    act(() =>
      root.render(
        <MonthView
          weekStartsOn={0}
          displayTimezone={displayTimezone}
          calendarGridMode="fixed-six"
          events={[crossZoneEvent()]}
          stickers={[]}
          calendars={[]}
          selectedDate="2026-08-06"
          todayKey="2026-08-06"
          flashToday={false}
          onSelectDate={vi.fn()}
          onPeriodLabelChange={vi.fn()}
        />,
      ),
    );
  }

  function cellText(dateKey: string): string {
    return container.querySelector(`[data-date-key="${dateKey}"]`)?.textContent ?? '';
  }

  it('places the event on the display timezone’s day, not the event’s own', () => {
    renderWithZone('Asia/Taipei');
    expect(cellText('2026-08-07')).toContain('跨時區會議');
    expect(cellText('2026-08-06')).not.toContain('跨時區會議');

    renderWithZone('America/New_York');
    expect(cellText('2026-08-06')).toContain('跨時區會議');
    expect(cellText('2026-08-07')).not.toContain('跨時區會議');
  });

  it('labels the event with the display timezone’s clock', () => {
    renderWithZone('Asia/Taipei');
    expect(cellText('2026-08-07')).toContain('08:00');

    renderWithZone('America/New_York');
    expect(cellText('2026-08-06')).toContain('20:00');
  });
});

/**
 * DP-070. The colour split is a product decision: ordinary days moved to the
 * AA-compliant `--lunar-muted`, festivals deliberately stayed on `--accent`.
 *
 * `lunarContrast.test.ts` can only check that the two tokens hold different
 * values — it cannot see which one the cell actually uses. Without this test,
 * pointing festivals at `--lunar-muted` would keep every other test green
 * while quietly undoing the decision.
 */
describe('MonthView 農曆顏色接線', () => {
  function lunarStyleOf(dateKey: string): string {
    const lunar = container
      .querySelector(`[data-date-key="${dateKey}"]`)
      ?.querySelector('.cal-cell-lunar');
    return lunar?.getAttribute('style') ?? '';
  }

  /** Classified by the domain, not by the colour under test. */
  function findDays() {
    const keys = [...container.querySelectorAll<HTMLElement>('[data-date-key]')].map(
      (element) => element.dataset.dateKey ?? '',
    );
    return {
      festival: keys.find((key) => lunarCell(fromDateKey(key)).isFestival),
      ordinary: keys.find((key) => !lunarCell(fromDateKey(key)).isFestival),
    };
  }

  it('draws festivals in --accent and ordinary days in --lunar-muted', () => {
    render([]);
    const { festival, ordinary } = findDays();

    expect(festival).toBeDefined();
    expect(ordinary).toBeDefined();
    expect(lunarStyleOf(festival!)).toContain('var(--accent)');
    expect(lunarStyleOf(festival!)).not.toContain('var(--lunar-muted)');
    expect(lunarStyleOf(ordinary!)).toContain('var(--lunar-muted)');
    expect(lunarStyleOf(ordinary!)).not.toContain('var(--accent)');
  });

  it('never falls back to the shared --faint the原檔 used', () => {
    render([]);
    const styles = [...container.querySelectorAll('.cal-cell-lunar')].map(
      (element) => element.getAttribute('style') ?? '',
    );

    expect(styles.length).toBeGreaterThan(300);
    expect(styles.filter((style) => style.includes('var(--faint)'))).toEqual([]);
  });
});

/**
 * DP-069. The buffer renders hundreds of day cells and grows while scrolling,
 * so every cell being tabbable put the bottom tab bar 382 Tab presses away.
 */
describe('MonthView keyboard navigation', () => {
  it('leaves exactly one day cell in the tab order', () => {
    render([]);

    const cells = container.querySelectorAll('[data-date-key]');
    expect(cells.length).toBeGreaterThan(300);
    expect(tabbableKeys()).toEqual([TODAY]);
  });

  it('moves focus by day, week and month without changing the selection', () => {
    const onSelectDate = vi.fn();
    act(() =>
      root.render(
        <MonthView
          weekStartsOn={0}
          displayTimezone="Asia/Taipei"
          calendarGridMode="fixed-six"
          events={[]}
          stickers={[]}
          calendars={[]}
          selectedDate="2026-08-13"
          todayKey="2026-08-13"
          flashToday={false}
          onSelectDate={onSelectDate}
          onPeriodLabelChange={vi.fn()}
        />,
      ),
    );

    pressOn('2026-08-13', 'ArrowRight');
    expect(document.activeElement).toBe(cell('2026-08-14'));

    pressOn('2026-08-14', 'ArrowDown');
    expect(document.activeElement).toBe(cell('2026-08-21'));

    pressOn('2026-08-21', 'ArrowLeft');
    expect(document.activeElement).toBe(cell('2026-08-20'));

    pressOn('2026-08-20', 'ArrowUp');
    expect(document.activeElement).toBe(cell('2026-08-13'));

    pressOn('2026-08-13', 'PageDown');
    expect(document.activeElement).toBe(cell('2026-09-13'));

    pressOn('2026-09-13', 'PageUp');
    expect(document.activeElement).toBe(cell('2026-08-13'));

    // Arrow keys move the focus only; activating a day is still a click/Enter.
    expect(onSelectDate).not.toHaveBeenCalled();
  });

  it('moves the tab stop with the focus so Tab returns where the user left off', () => {
    render([]);

    pressOn(TODAY, 'ArrowRight');
    const next = tabbableKeys();

    expect(next).toHaveLength(1);
    expect(next[0]).not.toBe(TODAY);
    expect(document.activeElement).toBe(cell(next[0]!));
  });

  it('sends Home and End to the ends of the row for both week starts', () => {
    // 2026-08-13 is a Thursday.
    render([], 0);
    pressOn('2026-08-13', 'Home');
    expect(document.activeElement).toBe(cell('2026-08-09')); // Sunday
    pressOn('2026-08-13', 'End');
    expect(document.activeElement).toBe(cell('2026-08-15')); // Saturday

    render([], 1);
    pressOn('2026-08-13', 'Home');
    expect(document.activeElement).toBe(cell('2026-08-10')); // Monday
    pressOn('2026-08-13', 'End');
    expect(document.activeElement).toBe(cell('2026-08-16')); // Sunday
  });

  it('grows the buffer when the keyboard walks past its edge', () => {
    render([]);

    const keys = [...container.querySelectorAll<HTMLButtonElement>('[data-date-key]')].map(
      (button) => button.dataset.dateKey ?? '',
    );
    const lastKey = keys[keys.length - 1]!;
    expect(cell(lastKey)).not.toBeNull();

    pressOn(lastKey, 'ArrowRight');

    const dayAfter = toDateKey(new Date(fromDateKey(lastKey).getTime() + 86_400_000));
    expect(cell(dayAfter)).not.toBeNull();
    expect(document.activeElement).toBe(cell(dayAfter));
  });

  it('ignores keys it does not own', () => {
    render([]);
    const before = document.activeElement;

    pressOn(TODAY, 'a');
    expect(document.activeElement).toBe(cell(TODAY));
    expect(before).not.toBeUndefined();
  });
});
