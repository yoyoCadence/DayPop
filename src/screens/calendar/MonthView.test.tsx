import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toDateKey } from '../../domain/date';
import type { Sticker } from '../../domain/types';
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

function render(stickers: Sticker[]) {
  act(() =>
    root.render(
      <MonthView
        weekStartsOn={0}
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
