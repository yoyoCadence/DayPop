import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../../data/DataProvider';
import { addDays, startOfWeek, toDateKey } from '../../domain/date';
import { createEmptyUserData } from '../../domain/types';
import { writeUserData } from '../../storage/versionedStorage';
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

/**
 * DP-064. "Today" is a day on this grid, so every use of it has to be read in
 * the grid's zone. They were moved one at a time and drifted apart: the
 * highlight sat on one day while 今天 selected and scrolled to another.
 *
 * The zone here is deliberately far from any machine the suite runs on, so the
 * assertions fail if any single site goes back to reading the device clock.
 */
describe('CalendarScreen today sources', () => {
  // Pinned so the two readings of "today" are guaranteed to disagree; without
  // that the test could pass on a machine where both zones share the date.
  const INSTANT = new Date('2026-08-15T12:00:00.000Z');

  function dateIn(timeZone: string): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(INSTANT);
  }

  /** Whichever extreme zone is on a different date than this machine is. */
  const FAR_ZONE = (() => {
    const device = dateIn(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const candidate = ['Etc/GMT-14', 'Etc/GMT+12'].find((zone) => dateIn(zone) !== device);
    if (!candidate) throw new Error('no zone differs from the device date');
    return candidate;
  })();

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(INSTANT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function expectedToday(): string {
    return dateIn(FAR_ZONE);
  }

  async function renderInZone() {
    const data = createEmptyUserData();
    data.preferences.timezone = FAR_ZONE;
    writeUserData(data, 0);
    await render(null);
  }

  it('is a meaningful test: the display zone is a different day than the device', () => {
    expect(dateIn(FAR_ZONE)).not.toBe(dateIn(Intl.DateTimeFormat().resolvedOptions().timeZone));
  });

  it('reads the header date, the highlight and 今天 from one source', async () => {
    await renderInZone();
    const today = expectedToday();
    const date = new Date(`${today}T00:00:00`);

    // Header date line.
    expect(container.querySelector('.cal-today-full')?.textContent).toContain(
      `${date.getFullYear()} / ${date.getMonth() + 1} / ${date.getDate()}`,
    );

    // 今天 must land on the same day, in the week view where the label shows it.
    await click(weekButton());
    await click([...container.querySelectorAll('.cal-chip-button')].find((b) => b.textContent === '今天'));
    expect(periodLabel()).toBe(weekLabelFor(today));
  });

  it('opens the month label on the display zone’s month', async () => {
    await renderInZone();
    const date = new Date(`${expectedToday()}T00:00:00`);

    expect(periodLabel()).toBe(`${date.getFullYear()}年 ${date.getMonth() + 1}月`);
  });
});
