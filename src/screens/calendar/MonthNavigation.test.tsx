import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../../data/DataProvider';
import { getAppStorage } from '../../storage/browserStorage';
import { CalendarScreen } from './CalendarScreen';
import { MONTH_NAVIGATION_KEY } from './monthNavigation';

let container: HTMLDivElement, root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
async function mount(key = 'initial') {
  await act(async () => { root.render(<DataProvider><CalendarScreen key={key} onGoSearch={vi.fn()} petGreeted={false} onPetGreeted={vi.fn()} /></DataProvider>); });
}
async function click(element: Element) { await act(async () => { (element as HTMLElement).click(); }); }
const trigger = () => container.querySelector<HTMLButtonElement>('.cal-month-mode-button')!;
const dialog = () => document.querySelector('[role="dialog"][aria-label="月曆顯示方式"]');
async function choose(index: number) { await click(trigger()); await click(dialog()!.querySelectorAll('.cal-month-mode-choice')[index]!); }

describe('month display choice (DP-225)', () => {
  it('keeps the continuous default; explicitly chooses a page without writing user data', async () => {
    await mount();
    expect(container.querySelectorAll('.cal-week-row')).toHaveLength(53);
    expect(getAppStorage().getItem(MONTH_NAVIGATION_KEY)).toBeNull();
    const before = getAppStorage().getItem('daypop.user-data');
    trigger().focus(); await choose(1);
    expect(container.querySelector('.cal-month-paged')).not.toBeNull();
    expect(getAppStorage().getItem(MONTH_NAVIGATION_KEY)).toBe('paged');
    expect(getAppStorage().getItem('daypop.user-data')).toBe(before);
    expect(document.activeElement).toBe(trigger());
    const write = vi.spyOn(getAppStorage(), 'setItem');
    await choose(1);
    expect(write).not.toHaveBeenCalled(); expect(dialog()).toBeNull();
  });

  it('cancels with Escape and backdrop, restoring focus and preserving the mode', async () => {
    await mount(); await click(trigger());
    expect(dialog()).not.toBeNull(); expect(trigger().getAttribute('aria-expanded')).toBe('true');
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(dialog()).toBeNull(); expect(document.activeElement).toBe(trigger());
    await click(trigger()); await click(document.querySelector('.cal-scope-backdrop')!);
    expect(dialog()).toBeNull(); expect(getAppStorage().getItem(MONTH_NAVIGATION_KEY)).toBeNull();
    expect(container.querySelectorAll('.cal-week-row')).toHaveLength(53);
  });

  it('hands off the visible month in both directions without changing the selected date', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(540);
    await mount();
    const selected = container.querySelector('.cal-cell[aria-pressed="true"]')!.getAttribute('data-date-key');
    const scroll = container.querySelector<HTMLDivElement>('.cal-month-scroll')!;
    await act(async () => {
      const height = parseFloat(container.querySelector<HTMLElement>('.cal-week-row')!.style.height);
      scroll.scrollTop = 35.25 * height; scroll.dispatchEvent(new Event('scroll'));
    });
    const period = container.querySelector('.cal-period')!.textContent;
    const before = getAppStorage().getItem('daypop.user-data');
    await choose(1); expect(container.querySelector('.cal-period')!.textContent).toBe(period);
    await choose(0); expect(handlePeriod()).toBe(period);
    expect(container.querySelector('.cal-cell[aria-pressed="true"]')!.getAttribute('data-date-key')).toBe(selected);
    expect(getAppStorage().getItem('daypop.user-data')).toBe(before);
  });

  it('remembers pages across view tabs and screen remounts', async () => {
    await mount(); await choose(1);
    await click(container.querySelectorAll('.cal-segmented button')[1]!);
    await click(container.querySelectorAll('.cal-segmented button')[0]!);
    expect(container.querySelector('.cal-month-paged')).not.toBeNull();
    await mount('remounted');
    expect(container.querySelector('.cal-month-paged')).not.toBeNull();
    expect(trigger().getAttribute('aria-label')).toContain('單月翻頁');
  });

  it('falls back for an unknown device value without overwriting it', async () => {
    getAppStorage().setItem(MONTH_NAVIGATION_KEY, 'future-mode');
    await mount();
    expect(container.querySelectorAll('.cal-week-row')).toHaveLength(53);
    expect(getAppStorage().getItem(MONTH_NAVIGATION_KEY)).toBe('future-mode');
  });
});

function handlePeriod() {
  // jsdom does not generate a native scroll notification after mounting.
  const scroll = container.querySelector<HTMLDivElement>('.cal-month-scroll')!;
  act(() => { scroll.dispatchEvent(new Event('scroll')); });
  return container.querySelector('.cal-period')!.textContent;
}
