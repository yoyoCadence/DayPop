import { expect, test, type Page } from '@playwright/test';
import { createEmptyUserData, type CalendarEvent, type CalendarGridMode } from '../src/domain/types';
import { monitorBrowser, openApp } from './support';

/**
 * DP-165 — a month cell draws whole chips, titles only, and puts the rest in
 * its `+N`.
 *
 * The原檔 always drew three chips and a `+N`. At 360×640 the rows are 73px, or
 * 61px in the fixed six-row grid, and the flex column crushed the chips to 6px
 * and the lunar line to 3px. `cellChipBudget()` now decides how many fit from
 * heights measured for calendar.css; this lays out real cells, so a change to
 * the CSS that the budget does not follow fails here.
 */

test.use({ timezoneId: 'Asia/Taipei' });
const NOW = new Date('2026-10-15T01:30:00.000Z');

async function seed(page: Page, gridMode: CalendarGridMode) {
  await page.clock.install({ time: NOW });
  const data = createEmptyUserData({ now: NOW.toISOString() });
  data.preferences.petEnabled = false;
  data.preferences.timezone = 'Asia/Taipei';
  data.preferences.calendarGridMode = gridMode;
  const calendarId = data.calendars[0]!.id;
  let next = 0;
  const event = (title: string, startsAt: string, endsAt: string): CalendarEvent => ({
    id: `16500000-0000-4000-8000-${String(++next).padStart(12, '0')}`,
    calendarId, title, location: null, notes: null, reminderMinutes: [], recurrence: null,
    sharingScope: 'inherit', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    allDay: false, startsAt, endsAt, timezone: 'Asia/Taipei',
  });
  const day = (date: string, titles: string[]) =>
    titles.map((title, index) =>
      event(title, `${date}T0${index + 1}:00:00.000Z`, `${date}T0${index + 1}:30:00.000Z`));
  data.events = [
    ...day('2026-10-15', ['團隊週會', '牙醫回診', '和阿姨晚餐', '健身']),
    ...day('2026-10-16', ['讀書會', '專案截止', '看電影']),
    ...day('2026-10-22', ['早會', '午餐', '面試', '晚會', '夜跑']),
  ];
  data.stickers = [{
    id: '16500000-0000-4000-8000-100000000001', calendarId, date: '2026-10-22', glyph: '🎂',
    assetKey: null, sortOrder: 0, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  }];
  await page.addInitScript((data) => {
    if (!localStorage.getItem('daypop.user-data')) {
      localStorage.setItem('daypop.user-data', JSON.stringify({ schemaVersion: 4, revision: 0, updatedAt: data.events[0]!.createdAt, data }));
    }
  }, data);
  await openApp(page);
  console.log('DP-165 browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
}

/** What a real cell drew, and whether anything was squeezed or cut off. */
async function cellLayout(page: Page, dateKey: string) {
  return page.locator(`[data-date-key="${dateKey}"]`).evaluate((cell) => {
    const style = getComputedStyle(cell);
    const clipBottom = cell.getBoundingClientRect().bottom - parseFloat(style.borderBottomWidth);
    const parts = [...cell.querySelectorAll<HTMLElement>('.cal-cell-day, .cal-cell-lunar, .cal-cell-event, .cal-cell-more')];
    // Only the parts that clip their own overflow can be squeezed below their
    // content; the others never shrink below it, and the day number's glyph is
    // taller than its 1.1 line box anyway.
    const clipping = [...cell.querySelectorAll<HTMLElement>('.cal-cell-lunar, .cal-cell-event')];
    return {
      rowHeight: cell.getBoundingClientRect().height,
      count: Number(/，(\d+) 個行程$/.exec(cell.getAttribute('aria-label') ?? '')?.[1]),
      chips: [...cell.querySelectorAll('.cal-cell-event')].map((chip) => chip.textContent ?? ''),
      more: cell.querySelector('.cal-cell-more')?.textContent ?? '',
      squeezed: clipping.filter((part) => part.scrollHeight > part.clientHeight + 1).map((part) => part.className),
      cutOff: parts.filter((part) => part.getBoundingClientRect().bottom > clipBottom + 0.01).map((part) => part.className),
    };
  });
}

async function expectWholeChips(page: Page) {
  for (const dateKey of ['2026-10-15', '2026-10-16', '2026-10-22']) {
    const cell = await cellLayout(page, dateKey);
    const hidden = cell.more ? Number(cell.more.slice(1)) : 0;
    expect(cell.squeezed, `${dateKey} at ${cell.rowHeight}px`).toEqual([]);
    expect(cell.cutOff, `${dateKey} at ${cell.rowHeight}px`).toEqual([]);
    expect(cell.chips.length + hidden, `${dateKey} at ${cell.rowHeight}px`).toBe(cell.count);
    // The 22nd also carries a sticker. In a 73px row or shorter, the sticker
    // and the `+5` are all that fit, and the count is what the cell keeps.
    if (dateKey !== '2026-10-22') expect(cell.chips.length).toBeGreaterThan(0);
    for (const chip of cell.chips) expect(chip).not.toMatch(/\d{2}:\d{2}/);
  }
}

for (const gridMode of ['adaptive', 'fixed-six'] as const) {
  test(`360×640 的月格只畫放得下的完整標籤，其餘算進 +N（${gridMode}）`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', '小螢幕只在手機專案量一次');
    await page.setViewportSize({ width: 360, height: 640 });
    const clean = monitorBrowser(page);
    await seed(page, gridMode);
    await expectWholeChips(page);
    clean();
  });

  test(`原生尺寸的月格同樣不擠壓標籤（${gridMode}）`, async ({ page }) => {
    const clean = monitorBrowser(page);
    await seed(page, gridMode);
    await expectWholeChips(page);
    clean();
  });
}
