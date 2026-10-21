import { act, createRef, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, daysBetween, fromDateKey, toDateKey } from '../../domain/date';
import { lunarCell } from '../../domain/lunar';
import {
  resolveEventOccurrences,
  type OccurrenceWindow,
} from '../../domain/recurrence';
import type { CalendarEvent, Sticker } from '../../domain/types';
import { MonthView, type MonthViewHandle } from './MonthView';
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
        resolveOccurrences={occurrenceResolver([])}
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

describe('MonthView all-day spans (DP-126)', () => {
  it('keeps inclusive continuation cells, including an occurrence starting outside the visible month', () => {
    const travel: CalendarEvent = {
      id: 'travel', calendarId: 'calendar', title: '長假', location: null, notes: null,
      reminderMinutes: [], recurrence: null, sharingScope: 'inherit',
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
      allDay: true, startDate: '2026-01-01', endDate: '2026-08-07',
    };
    act(() => root.render(<MonthView
      weekStartsOn={0} displayTimezone="Pacific/Honolulu" calendarGridMode="fixed-six"
      resolveOccurrences={occurrenceResolver([travel])} stickers={[]} calendars={[]}
      selectedDate="2026-08-06" todayKey="2026-08-06" flashToday={false}
      onSelectDate={vi.fn()} onPeriodLabelChange={vi.fn()}
    />));
    expect(cell('2026-08-06')?.textContent).toContain('續 長假');
    expect(cell('2026-08-07')?.textContent).toContain('續 長假');
    expect(cell('2026-08-08')?.textContent).not.toContain('長假');
  });
});

describe('MonthView display conversion lifetime (DP-182)', () => {
  it('shares segment/label fields only within a grouping and redraws a changed or revoked source', () => {
    const event: CalendarEvent = {
      id: 'display-reuse', calendarId: 'calendar', title: '跨夜', location: null, notes: null,
      reminderMinutes: [], recurrence: null, sharingScope: 'inherit',
      createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
      allDay: false, startsAt: '2026-08-06T15:17:00Z', endsAt: '2026-08-06T16:23:00Z', timezone: 'Asia/Taipei',
    };
    const instants = new Set([Date.parse(event.startsAt), Date.parse(event.endsAt)]);
    const resolved = resolveEventOccurrences({ events: [event], eventExceptions: [] }, {
      startDate: '2026-08-06', endDate: '2026-08-07',
    });
    const input = JSON.stringify(resolved);
    const formatter = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts');
    const calls = () => formatter.mock.calls.filter(([date]) => date instanceof Date && instants.has(date.getTime())).length;
    const draw = (items = resolved, zone = 'Asia/Taipei') => act(() => root.render(<MonthView
      weekStartsOn={0} displayTimezone={zone} calendarGridMode="fixed-six"
      resolveOccurrences={() => items} stickers={[]} calendars={[]}
      selectedDate="2026-08-06" todayKey="2026-08-06" flashToday={false}
      onSelectDate={vi.fn()} onPeriodLabelChange={vi.fn()}
    />));
    try {
      draw();
      expect(calls()).toBe(2);
      expect(cell('2026-08-06')?.querySelector('.cal-cell-event')?.getAttribute('title')).toBe('23:17 跨夜');
      expect(cell('2026-08-07')?.textContent).toContain('續 跨夜');
      const changed = resolved.map((item) => ({ ...item, event: { ...item.event, title: '新名稱' } }));
      draw(changed);
      expect(calls()).toBe(4); // A new calculation must not reuse the previous reader.
      expect(cell('2026-08-06')?.textContent).toContain('新名稱');
      draw(changed, 'UTC');
      expect(calls()).toBe(6);
      expect(cell('2026-08-06')?.querySelector('.cal-cell-event')?.getAttribute('title')).toBe('15:17 新名稱');
      expect(cell('2026-08-07')?.textContent).not.toContain('新名稱');
      draw(changed);
      expect(calls()).toBe(8);
      draw([]); // Upstream access/visibility changes remove received occurrences.
      expect(container.querySelector('.cal-cell-event')).toBeNull();
      expect(calls()).toBe(8);
      expect(JSON.stringify(resolved)).toBe(input);
    } finally { formatter.mockRestore(); }
  });
});

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
          resolveOccurrences={occurrenceResolver([crossZoneEvent()])}
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

  it('draws an event longer than the buffer instead of failing on it', () => {
    // The database only requires `ends_at > starts_at`, so a two-year block is
    // valid. Cutting it without a window threw past 400 days, and this grid
    // walks every event — so one such event blanked the whole month.
    const base = crossZoneEvent();
    if (base.allDay) throw new Error('expected a timed fixture');
    const long: CalendarEvent = {
      ...base,
      title: '長期專案',
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2028-01-01T00:00:00.000Z',
      timezone: 'Asia/Taipei',
    };
    act(() =>
      root.render(
        <MonthView
          weekStartsOn={0}
          displayTimezone="Asia/Taipei"
          calendarGridMode="fixed-six"
          resolveOccurrences={occurrenceResolver([long])}
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

    expect(cellText('2026-08-06')).toContain('續 長期專案');
    expect(cellText('2026-08-07')).toContain('續 長期專案');
  });

  it('shows a cross-midnight event on both days, the second marked 續', () => {
    // 23:00 → 00:30 in Taipei on the 6th/7th.
    const base = crossZoneEvent();
    if (base.allDay) throw new Error('expected a timed fixture');
    const overnight: CalendarEvent = {
      ...base,
      title: '夜班',
      startsAt: '2026-08-06T15:00:00.000Z',
      endsAt: '2026-08-06T16:30:00.000Z',
      timezone: 'Asia/Taipei',
    };
    act(() =>
      root.render(
        <MonthView
          weekStartsOn={0}
          displayTimezone="Asia/Taipei"
          calendarGridMode="fixed-six"
          resolveOccurrences={occurrenceResolver([overnight])}
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

    // Without segments the 7th showed nothing at all, which is what made a
    // 23:00–隔天 14:00 event vanish for the whole of its second morning.
    expect(chips('2026-08-06')).toEqual([{ text: '夜班', title: '23:00 夜班' }]);
    expect(chips('2026-08-07')).toEqual([{ text: '續 夜班', title: '續 夜班' }]);
  });

  it('gives the tooltip the display timezone’s clock', () => {
    renderWithZone('Asia/Taipei');
    expect(chips('2026-08-07')).toEqual([{ text: '跨時區會議', title: '08:00 跨時區會議' }]);

    renderWithZone('America/New_York');
    expect(chips('2026-08-06')).toEqual([{ text: '跨時區會議', title: '20:00 跨時區會議' }]);
  });
});

/** Each chip in a cell: what it shows, and the tooltip that keeps the clock. */
function chips(dateKey: string): Array<{ text: string; title: string }> {
  return [...(cell(dateKey)?.querySelectorAll<HTMLElement>('.cal-cell-event') ?? [])].map((chip) => ({
    text: chip.textContent ?? '',
    title: chip.title,
  }));
}

/**
 * DP-165. A phone cell is about 50px wide; at 8.5px the clock alone filled a
 * chip, so every one read `10:00 …`. Chips now carry the title, the order still
 * follows the clock, and the day sheet lists the times.
 */
describe('MonthView chip labels (DP-165)', () => {
  const base = {
    calendarId: 'calendar', location: null, notes: null, reminderMinutes: [], recurrence: null,
    sharingScope: 'inherit' as const,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  };
  const timed = (id: string, title: string, startsAt: string, endsAt: string): CalendarEvent => ({
    ...base, id, title, allDay: false, startsAt, endsAt, timezone: 'Asia/Taipei',
  });

  it('shows titles only, all-day first and then by start time, with the clock in the tooltip', () => {
    const events: CalendarEvent[] = [
      timed('dentist', '牙醫回診', '2026-08-06T07:30:00.000Z', '2026-08-06T08:30:00.000Z'),
      timed('standup', '團隊週會', '2026-08-06T02:00:00.000Z', '2026-08-06T03:00:00.000Z'),
      { ...base, id: 'birthday', title: '小美生日', allDay: true, startDate: '2026-08-06', endDate: '2026-08-06' },
    ];
    act(() => root.render(<MonthView
      weekStartsOn={0} displayTimezone="Asia/Taipei" calendarGridMode="fixed-six"
      resolveOccurrences={occurrenceResolver(events)} stickers={[]} calendars={[]}
      selectedDate="2026-08-06" todayKey="2026-08-06" flashToday={false}
      onSelectDate={vi.fn()} onPeriodLabelChange={vi.fn()}
    />));

    expect(chips('2026-08-06')).toEqual([
      { text: '小美生日', title: '小美生日' },
      { text: '團隊週會', title: '10:00 團隊週會' },
      { text: '牙醫回診', title: '15:30 牙醫回診' },
    ]);
  });

  it('still collapses a fourth event into +1', () => {
    const events = ['一', '二', '三', '四'].map((label, index) =>
      timed(`e${index}`, `會議${label}`, `2026-08-06T0${index + 1}:00:00.000Z`, `2026-08-06T0${index + 1}:30:00.000Z`));
    act(() => root.render(<MonthView
      weekStartsOn={0} displayTimezone="Asia/Taipei" calendarGridMode="fixed-six"
      resolveOccurrences={occurrenceResolver(events)} stickers={[]} calendars={[]}
      selectedDate="2026-08-06" todayKey="2026-08-06" flashToday={false}
      onSelectDate={vi.fn()} onPeriodLabelChange={vi.fn()}
    />));

    expect(chips('2026-08-06').map((chip) => chip.text)).toEqual(['會議一', '會議二', '會議三']);
    expect(cell('2026-08-06')?.querySelector('.cal-cell-more')?.textContent).toBe('+1');
    expect(cell('2026-08-06')?.getAttribute('aria-label')).toBe('2026-08-06，4 個行程');
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
    expect(lunarStyleOf(festival!)).toContain('var(--accent-text)');
    expect(lunarStyleOf(festival!)).not.toContain('var(--lunar-muted)');
    expect(lunarStyleOf(ordinary!)).toContain('var(--lunar-muted)');
    expect(lunarStyleOf(ordinary!)).not.toContain('var(--accent-text)');
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
          resolveOccurrences={occurrenceResolver([])}
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

  it('slides a bounded buffer when the keyboard walks past its edge', () => {
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
    expect(container.querySelectorAll('.cal-week-row')).toHaveLength(53);
  });

  it('ignores keys it does not own', () => {
    render([]);
    const before = document.activeElement;

    pressOn(TODAY, 'a');
    expect(document.activeElement).toBe(cell(TODAY));
    expect(before).not.toBeUndefined();
  });
});

describe('MonthView bounded window (DP-180)', () => {
  const today = '2026-10-20';
  const onSelectDate = vi.fn();
  const handle = createRef<MonthViewHandle>();
  let resolve: ReturnType<typeof vi.fn<(window: OccurrenceWindow) => []>>;

  function mount(extra: Partial<ComponentProps<typeof MonthView>> = {}) {
    resolve = vi.fn(() => []);
    act(() => root.render(<MonthView
      ref={handle} weekStartsOn={0} displayTimezone="Asia/Taipei" calendarGridMode="fixed-six"
      resolveOccurrences={resolve} stickers={[]} calendars={[]} selectedDate={today} todayKey={today}
      flashToday={false} onSelectDate={onSelectDate} onPeriodLabelChange={vi.fn()} {...extra}
    />));
    return container.querySelector<HTMLDivElement>('.cal-month-scroll')!;
  }

  function keys() {
    return [...container.querySelectorAll<HTMLElement>('[data-date-key]')].map((el) => el.dataset.dateKey!);
  }

  function scroll(element: HTMLDivElement, week: number, fraction = 0.25) {
    const row = container.querySelector<HTMLElement>('.cal-week-row')!;
    const height = parseFloat(row.style.height);
    act(() => { element.scrollTop = (week + fraction) * height; element.dispatchEvent(new Event('scroll')); });
    return height;
  }

  it.each([1, -1] as const)('keeps DOM and occurrence bounds at 53 weeks during repeated direction %s shifts', (direction) => {
    const element = mount();
    for (let step = 0; step < 6; step += 1) {
      const before = keys();
      const week = direction === 1 ? 46 : 3;
      const visible = before[week * 7];
      const height = scroll(element, week);
      const after = keys();
      expect(after).toHaveLength(53 * 7);
      expect(daysBetween(fromDateKey(before[0]!), fromDateKey(after[0]!))).toBe(direction * 12 * 7);
      expect(after[Math.floor(element.scrollTop / height) * 7]).toBe(visible);
      expect(element.scrollTop / height % 1).toBeCloseTo(0.25);
      expect(resolve).toHaveBeenLastCalledWith({ startDate: after[0], endDate: after.at(-1) });
      expect(tabbableKeys()).toHaveLength(1);
    }
  });

  it('retains the actual focused node until its week is trimmed, then focuses a visible date without selecting', () => {
    const element = mount();
    onSelectDate.mockClear();
    const original = cell(today)!;
    act(() => original.focus());
    scroll(element, 46); // today is still inside the retained 41 weeks.
    expect(cell(today)).toBe(original);
    expect(document.activeElement).toBe(original);
    scroll(element, 46);
    scroll(element, 46); // today is now outside the window.
    expect(cell(today)).toBeNull();
    const focused = document.activeElement as HTMLButtonElement;
    expect(focused.matches('.cal-cell')).toBe(true);
    const index = keys().indexOf(focused.dataset.dateKey!);
    expect(Math.floor(index / 7)).toBeGreaterThanOrEqual(Math.ceil(element.scrollTop / 96));
    expect(Math.floor(index / 7)).toBeLessThan(Math.ceil(element.scrollTop / 96) + 6);
    expect(tabbableKeys()).toEqual([focused.dataset.dateKey]);
    expect(element.scrollTop).toBe(34.25 * 96);
    expect(onSelectDate).not.toHaveBeenCalled();
  });

  it('does not take focus from an external control when a roving date is trimmed', () => {
    const element = mount();
    const external = document.createElement('button');
    document.body.append(external);
    try {
      act(() => { cell(today)!.focus(); external.focus(); });
      for (let step = 0; step < 3; step += 1) scroll(element, 46);
      expect(document.activeElement).toBe(external);
      expect(cell(today)).toBeNull();
      expect(tabbableKeys()).toHaveLength(1);
    } finally { external.remove(); }
  });

  it('re-centres today after browsing years without growing a gap or stealing toolbar focus', () => {
    const element = mount();
    for (let step = 0; step < 10; step += 1) scroll(element, 46);
    expect(cell(today)).toBeNull();
    act(() => handle.current!.scrollToToday(false));
    expect(keys()).toHaveLength(53 * 7);
    expect(cell(today)).not.toBeNull();
    const row = Math.floor(keys().indexOf(today) / 7);
    expect(element.scrollTop).toBe(row * 96);
  });

  it('keeps keyboard navigation bounded at both edges and preserves selection', () => {
    mount();
    onSelectDate.mockClear();
    for (const direction of [-1, 1] as const) {
      const before = keys();
      const from = direction === -1 ? before[0]! : before.at(-1)!;
      const target = toDateKey(addDays(fromDateKey(from), direction));
      pressOn(from, direction === -1 ? 'ArrowLeft' : 'ArrowRight');
      expect(document.activeElement).toBe(cell(target));
      expect(keys()).toHaveLength(53 * 7);
      expect(tabbableKeys()).toEqual([target]);
    }
    expect(onSelectDate).not.toHaveBeenCalled();
    expect(cell(today)?.getAttribute('aria-pressed')).toBe('true');
  });

  it('positions once even when the measured row is exactly the initial 96px, then preserves the logical top on resize', () => {
    let height = 576;
    const size = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
    let resize: (() => void) | undefined;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe() {} disconnect() {}
    });
    try {
      const element = mount();
      expect(element.scrollTop).toBe(26 * 96);
      scroll(element, 27, 0.4);
      height = 420;
      act(() => resize!());
      expect(element.scrollTop).toBeCloseTo(27.4 * 70);
      expect(keys()).toHaveLength(371);
    } finally { size.mockRestore(); vi.unstubAllGlobals(); }
  });

  it.each(['0100-01-01', '9999-12-31'])('opens a fresh search window at %s and prevents navigation outside supported years', (target) => {
    const element = mount({ initialDateKey: target, selectedDate: target });
    expect(cell(target)).not.toBeNull();
    expect(cell(target)?.disabled).toBe(false);
    expect(keys()).toHaveLength(371);
    const window = resolve.mock.calls.at(-1)![0];
    expect(window.startDate >= '0100-01-01' && window.endDate <= '9999-12-31').toBe(true);
    pressOn(target, target === '0100-01-01' ? 'ArrowLeft' : 'ArrowRight');
    expect(document.activeElement).toBe(cell(target));
    expect(tabbableKeys()).toEqual([target]);
    const before = keys();
    scroll(element, target === '0100-01-01' ? 0 : 47, 0);
    expect(keys()).toEqual(before);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('compensates a trim and an adaptive four-to-five-row height change in the same commit', () => {
    const size = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(540);
    try {
      const element = mount({ calendarGridMode: 'adaptive', todayKey: '2026-02-15', selectedDate: '2026-02-15' });
      expect(container.querySelector<HTMLElement>('.cal-week-row')!.style.height).toBe('135px');
      const visible = keys()[46 * 7];
      scroll(element, 46);
      const height = parseFloat(container.querySelector<HTMLElement>('.cal-week-row')!.style.height);
      expect(height).toBe(108);
      expect(keys()[Math.floor(element.scrollTop / height) * 7]).toBe(visible);
      expect(element.scrollTop / height).toBeCloseTo(34.25);
      expect(keys()).toHaveLength(371);
    } finally { size.mockRestore(); }
  });
});

describe('MonthView 重複事件（DP-081）', () => {
  function weekly(rule: string): CalendarEvent {
    return {
      id: 'r1',
      calendarId: '44444444-4444-4444-8444-444444444444',
      title: '每週站會',
      location: null,
      notes: null,
      reminderMinutes: [],
      recurrence: { rule },
      sharingScope: 'inherit',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      allDay: false,
      startsAt: '2026-08-03T01:00:00.000Z',
      endsAt: '2026-08-03T01:30:00.000Z',
      timezone: 'Asia/Taipei',
    };
  }

  function renderEvents(events: CalendarEvent[]) {
    act(() =>
      root.render(
        <MonthView
          weekStartsOn={0}
          displayTimezone="Asia/Taipei"
          calendarGridMode="fixed-six"
          resolveOccurrences={occurrenceResolver(events)}
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

  const cellText = (dateKey: string) =>
    container.querySelector(`[data-date-key="${dateKey}"]`)?.textContent ?? '';

  it('每一次都畫在自己的格子裡，不是只畫第一次', () => {
    renderEvents([weekly('FREQ=WEEKLY;COUNT=6')]);

    // 8/3 是系列第一次；8/10、8/17、8/24 是後續。修正前只有 8/3 畫得出來。
    for (const dateKey of ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24']) {
      expect(cellText(dateKey)).toContain('每週站會');
    }
    // COUNT=6 到 9/7 為止；9/14 已經超出，不該出現。
    expect(cellText('2026-09-14')).not.toContain('每週站會');
  });

  it('同一系列的兩次不會被當成互相衝突', () => {
    // 同一天連兩次的規則：兩個 entry 的 key 不同，但時間不重疊，
    // 所以不該有衝突標記；重點是它們也沒有被當成「自己跟自己衝突」。
    renderEvents([weekly('FREQ=DAILY;COUNT=3')]);

    expect(cellText('2026-08-04')).toContain('每週站會');
    expect(container.querySelector('.cal-cell-conflict')).toBeNull();
  });
});
