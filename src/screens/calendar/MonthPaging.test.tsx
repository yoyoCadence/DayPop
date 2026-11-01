import { act, createRef, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveEventOccurrences, type OccurrenceWindow } from '../../domain/recurrence';
import type { CalendarEvent, Sticker } from '../../domain/types';
import { isDateKey } from '../../domain/validation';
import { MonthView, type MonthViewHandle } from './MonthView';

let container: HTMLDivElement, root: Root;
const handle = createRef<MonthViewHandle>();
let onSelect: ReturnType<typeof vi.fn<(value: string) => void>>, label: ReturnType<typeof vi.fn<(value: string) => void>>;
beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  onSelect = vi.fn(); label = vi.fn();
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
function mount(extra: Partial<ComponentProps<typeof MonthView>> = {}) {
  act(() => root.render(<MonthView ref={handle} navigation="paged" weekStartsOn={0} displayTimezone="Asia/Taipei"
    calendarGridMode="adaptive" resolveOccurrences={() => []} stickers={[]} calendars={[]}
    selectedDate="2026-02-15" todayKey="2026-02-15" flashToday={false}
    onSelectDate={onSelect} onPeriodLabelChange={label} {...extra} />));
  return container.querySelector<HTMLDivElement>('.cal-month-scroll')!;
}
const cell = (key: string) => container.querySelector<HTMLButtonElement>(`[data-date-key="${key}"]`)!;
const rows = () => container.querySelectorAll('.cal-week-row').length;
const tabStops = () => container.querySelectorAll('.cal-cell[tabindex="0"]').length;
function press(key: string, value: string) {
  act(() => { cell(key).focus(); cell(key).dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); });
}
function pointer(element: HTMLElement, type: string, x: number, y: number, primary = true) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y }, pointerId: { value: 1 }, pointerType: { value: 'touch' }, isPrimary: { value: primary } });
  act(() => { element.dispatchEvent(event); });
}

describe('single-month navigation (DP-225)', () => {
  it.each([
    ['2026-02-15', 0, 'adaptive', 4], ['2026-11-15', 1, 'adaptive', 6],
    ['2026-12-15', 1, 'adaptive', 5], ['2026-02-15', 0, 'fixed-six', 6],
  ] as const)('fits %s with start %s / %s into %s rows', (todayKey, weekStartsOn, calendarGridMode, count) => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(540);
    mount({ todayKey, selectedDate: todayKey, weekStartsOn, calendarGridMode });
    expect(rows()).toBe(count); expect(tabStops()).toBe(1);
    expect(container.querySelector<HTMLElement>('.cal-week-row')!.style.height).toBe(`${Math.floor(540 / count)}px`);
    expect(container.querySelectorAll('.cal-cell')).toHaveLength(count * 7);
  });

  it('pages exactly one month across years without selecting or stealing toolbar focus', () => {
    const toolbar = document.createElement('button'); document.body.append(toolbar);
    try {
      mount({ initialDateKey: '2026-11-15' }); toolbar.focus();
      act(() => handle.current!.page(1)); expect(label).toHaveBeenLastCalledWith('2026年 12月');
      act(() => handle.current!.page(1)); expect(label).toHaveBeenLastCalledWith('2027年 1月');
      act(() => handle.current!.page(-1)); expect(label).toHaveBeenLastCalledWith('2026年 12月');
      expect(document.activeElement).toBe(toolbar); expect(onSelect).not.toHaveBeenCalled(); expect(tabStops()).toBe(1);
    } finally { toolbar.remove(); }
  });

  it.each(['0100-01-01', '9999-12-31'])('clamps month paging and resolver windows at %s', key => {
    const resolve = vi.fn<(window: OccurrenceWindow) => []>(() => []);
    mount({ initialDateKey: key, resolveOccurrences: resolve });
    const before = label.mock.lastCall;
    act(() => handle.current!.page(key.startsWith('0100') ? -1 : 1));
    expect(label.mock.lastCall).toEqual(before);
    for (const [window] of resolve.mock.calls) {
      expect(isDateKey(window.startDate)).toBe(true); expect(isDateKey(window.endDate)).toBe(true);
      expect(window.startDate <= window.endDate).toBe(true);
    }
    expect(tabStops()).toBe(1);
  });

  it('keeps a single keyboard stop while clamping Jan 31 and crossing month boundaries', () => {
    mount({ initialDateKey: '2026-01-31', weekStartsOn: 1 });
    press('2026-01-31', 'PageDown'); expect(document.activeElement).toBe(cell('2026-02-28'));
    press('2026-02-28', 'ArrowDown'); expect(document.activeElement).toBe(cell('2026-03-07'));
    expect(label).toHaveBeenLastCalledWith('2026年 3月');
    press('2026-03-07', 'Home'); expect(document.activeElement).toBe(cell('2026-03-02'));
    press('2026-03-02', 'End'); expect(document.activeElement).toBe(cell('2026-03-08'));
    expect(tabStops()).toBe(1); expect(onSelect).not.toHaveBeenCalled();
  });

  it('uses display-zone today, brings it into a short viewport, and hands off its month', () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(140);
    mount({ initialDateKey: '2027-01-15', todayKey: '2026-02-28', displayTimezone: 'America/New_York' });
    act(() => handle.current!.scrollToToday(true));
    expect(label).toHaveBeenLastCalledWith('2026年 2月');
    expect(handle.current!.getVisibleDate()).toBe('2026-02-04');
    expect(container.querySelector('.cal-month-scroll')!.scrollTop).toBe(92);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('opens an adjacent date without replacing the sheet trigger or changing month', () => {
    mount({ initialDateKey: '2026-11-15', weekStartsOn: 1 });
    const adjacent = cell('2026-10-26');
    act(() => { adjacent.focus(); adjacent.click(); });
    expect(onSelect).toHaveBeenCalledWith('2026-10-26');
    expect(label).toHaveBeenLastCalledWith('2026年 11月'); expect(document.activeElement).toBe(adjacent);
  });

  it('moves adjacent-cell focus into the destination month and reveals keyboard dates in short viewports', () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(140);
    const scroll = mount({ initialDateKey: '2026-11-15', weekStartsOn: 1 });
    act(() => { cell('2026-10-26').focus(); handle.current!.page(1); });
    expect(document.activeElement).toBe(cell('2026-12-26'));
    expect(scroll.scrollTop).toBeGreaterThan(0);
    press('2026-12-26', 'Home'); expect(document.activeElement).toBe(cell('2026-12-21'));
  });

  it('swipes once, suppresses its click, and accepts the next tap and keyboard click', () => {
    const scroll = mount();
    pointer(scroll, 'pointerdown', 260, 300); pointer(scroll, 'pointermove', 120, 302); pointer(scroll, 'pointerup', 100, 302);
    expect(label).toHaveBeenLastCalledWith('2026年 3月');
    act(() => { cell('2026-03-15').dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true, cancelable: true })); });
    expect(onSelect).not.toHaveBeenCalled();
    pointer(scroll, 'pointerdown', 150, 300); pointer(scroll, 'pointerup', 150, 300);
    act(() => { cell('2026-03-15').dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true })); });
    expect(onSelect).toHaveBeenLastCalledWith('2026-03-15');
    pointer(scroll, 'pointerdown', 100, 300); pointer(scroll, 'pointerup', 260, 300);
    act(() => { cell('2026-02-15').click(); });
    expect(onSelect).toHaveBeenLastCalledWith('2026-02-15');
  });

  it.each(['vertical', 'cancel', 'multitouch', 'short'])('does not flip for a %s gesture', kind => {
    const scroll = mount();
    pointer(scroll, 'pointerdown', 260, 300);
    if (kind === 'vertical') pointer(scroll, 'pointermove', 255, 400);
    if (kind === 'cancel') pointer(scroll, 'pointercancel', 200, 300);
    if (kind === 'multitouch') pointer(scroll, 'pointerdown', 200, 300, false);
    pointer(scroll, 'pointerup', kind === 'short' ? 230 : 100, 301);
    expect(label).toHaveBeenLastCalledWith('2026年 2月'); expect(tabStops()).toBe(1);
  });

  it('shares spanning-event continuation, sticker, and lunar content with continuous mode', () => {
    const now = '2026-02-01T00:00:00.000Z';
    const event: CalendarEvent = { id: 'event', calendarId: 'calendar', title: '跨日旅行', allDay: true, startDate: '2026-02-15', endDate: '2026-02-16',
      location: null, notes: null, reminderMinutes: [], recurrence: null, sharingScope: 'inherit', createdAt: now, updatedAt: now };
    const sticker: Sticker = { id: 'sticker', calendarId: 'calendar', date: '2026-02-16', glyph: '🎂', assetKey: null, sortOrder: 0, createdAt: now, updatedAt: now };
    const resolve: ComponentProps<typeof MonthView>['resolveOccurrences'] = window => resolveEventOccurrences({ events: [event], eventExceptions: [] }, window);
    mount({ resolveOccurrences: resolve, stickers: [sticker] });
    const content = cell('2026-02-16').textContent;
    expect(content).toContain('續 跨日旅行'); expect(content).toContain('🎂');
    mount({ navigation: 'continuous', resolveOccurrences: resolve, stickers: [sticker] });
    expect(cell('2026-02-16').textContent).toBe(content); expect(rows()).toBe(53);
  });
});
