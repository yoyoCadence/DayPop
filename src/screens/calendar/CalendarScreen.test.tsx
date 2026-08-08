import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../../data/DataProvider';
import { addDays, startOfWeek, toDateKey } from '../../domain/date';
import { CalendarScreen, type CalendarFocus } from './CalendarScreen';

/**
 * What 日曆 does with the focus 搜尋 and 綜覽 hand it when they send the user
 * here. The guest adapter backs this, so it is the real boot path.
 */

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

async function render(focus: CalendarFocus | null) {
  await act(async () => {
    root.render(
      <DataProvider>
        <CalendarScreen focus={focus} onGoSearch={vi.fn()} />
      </DataProvider>,
    );
  });
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error('element not found');
  await act(async () => {
    (element as HTMLElement).click();
  });
}

/** The 週 button of the 月／週／列表 control. */
const weekButton = () => container.querySelectorAll('.cal-segmented button')[1];
const periodLabel = () => container.querySelector('.cal-period')?.textContent;
const daySheet = () => container.querySelector('.cal-day-sheet');

function weekLabelFor(dateKey: string): string {
  const start = startOfWeek(new Date(`${dateKey}T00:00:00`), 0);
  const end = addDays(start, 6);
  return `${start.getMonth() + 1}/${start.getDate()} – ${end.getMonth() + 1}/${end.getDate()}`;
}

describe('CalendarScreen focus', () => {
  it('opens the day it was sent to and moves the week with it', async () => {
    await render({ kind: 'day', dateKey: '2026-08-06' });

    expect(daySheet()?.getAttribute('aria-label')).toBe('8月6日 週四');

    await click(weekButton());
    expect(periodLabel()).toBe('8/2 – 8/8');
  });

  /**
   * Regression: an unusable date key used to be taken at face value.
   * `fromDateKey('')` resolves to 1900-01-01, so a 搜尋 result for a todo with
   * no due date left 日曆 sitting in January 1900 with nothing to explain it.
   */
  it('falls back to today when the focus does not name a real day', async () => {
    await render({ kind: 'day', dateKey: '' });

    expect(daySheet()).toBeNull();

    await click(weekButton());
    expect(periodLabel()).toBe(weekLabelFor(toDateKey(new Date())));
  });

  it('starts on today when nothing sent it anywhere', async () => {
    await render(null);

    expect(daySheet()).toBeNull();

    await click(weekButton());
    expect(periodLabel()).toBe(weekLabelFor(toDateKey(new Date())));
  });
});
