import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STICKER_GLYPHS } from '../../domain/stickerGlyphs';
import type { Sticker } from '../../domain/types';
import { DayDetailSheet, type DayDetailSheetProps } from './DayDetailSheet';

/**
 * The sticker row and picker are the DP-055 UI, so they are exercised through
 * real clicks rather than by asserting on props.
 */

const DATE = '2026-08-06';

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

function sticker(id: string, glyph: string, date = DATE): Sticker {
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

function render(overrides: Partial<DayDetailSheetProps> = {}) {
  const props: DayDetailSheetProps = {
    dateKey: DATE,
    events: [],
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
