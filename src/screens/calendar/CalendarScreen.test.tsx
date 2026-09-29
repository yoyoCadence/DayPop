import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../../data/DataProvider';
import { addDays, startOfWeek } from '../../domain/date';
import { instantDateInZone } from '../../domain/eventTime';
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

/**
 * Today as **the screen** reads it — DP-064.
 *
 * `toDateKey(new Date())` is the device's today, and the screen stopped using
 * that: it reads `preferences.timezone`, which the guest default sets to
 * Asia/Taipei. The two name different days for the eight hours a day when UTC
 * has not caught up, so expecting the device's day made these tests fail on CI
 * while passing on any machine already at UTC+8.
 *
 * The assertion below is a *week* label, so the mismatch only shows when those
 * two days also fall in different weeks — Saturday 16:00–24:00 UTC, about eight
 * hours a week rather than eight hours a day. Measured at 17:00 UTC: Wednesday,
 * Thursday and Friday all pass; Saturday fails with the exact CI message
 * (`expected '8/16 – 8/22' to be '8/9 – 8/15'`), which is why the red run was
 * the 2026-08-15 merge.
 */
function screenTodayKey(): string {
  return instantDateInZone(new Date().toISOString(), createEmptyUserData().preferences.timezone);
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
    expect(periodLabel()).toBe(weekLabelFor(screenTodayKey()));
  });

  it('starts on today when nothing sent it anywhere', async () => {
    await render(null);

    expect(daySheet()).toBeNull();

    await click(weekButton());
    expect(periodLabel()).toBe(weekLabelFor(screenTodayKey()));
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

/**
 * 覆驗抓到的第二個 blocking：Escape 關掉 sheet 之後，快速新增會重新打開舊事件。
 *
 * `editingTarget`（DP-082 加的）本來是獨立讀取的，而 Escape 與快速新增只清了
 * `editingId`，殘留的 target 就繼續代表 `editingEvent`，於是 sheet 停在「編輯行程」
 * 並顯示舊標題，解析出來的草稿被忽略。
 */
describe('CalendarScreen 離開編輯後的殘留狀態（DP-082 覆驗修正）', () => {
  const sheetHeading = () => container.querySelector('.cal-sheet-bar strong')?.textContent;
  const titleValue = () =>
    (container.querySelector('.cal-title-input') as HTMLInputElement | null)?.value;

  async function typeQuickAdd(text: string) {
    const input = container.querySelector('.cal-quick input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  }

  async function pressEscape() {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
  }

  it('Escape 關掉編輯後，快速新增開的是新事件而不是舊的那一筆', async () => {
    await render(null);

    // 先用 FAB 建一筆，再從列表點開它，讓 editingTarget 真的被設起來。
    await click(container.querySelector('.cal-fab'));
    const input = container.querySelector('.cal-title-input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '舊會議');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container.querySelector('.cal-sheet')?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });
    await click(container.querySelectorAll('.cal-segmented button')[2]);
    await click(container.querySelector('.cal-agenda-item'));
    expect(sheetHeading()).toBe('編輯行程');

    await pressEscape();
    expect(container.querySelector('.cal-sheet')).toBeNull();

    await typeQuickAdd('明天下午3點 新會議');

    expect(sheetHeading()).toBe('新增行程');
    expect(titleValue()).toBe('新會議');
  });
});
