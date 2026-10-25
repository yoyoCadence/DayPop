import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PetLayer } from './PetLayer';

let host: HTMLDivElement;
let root: Root;
let height = 600;
let viewport: EventTarget & { offsetTop: number; height: number };
const key = 'daypop.pet-placement';
beforeEach(() => {
  localStorage.removeItem(key);
  height = 600;
  viewport = Object.assign(new EventTarget(), { offsetTop: 0, height: 900 });
  vi.stubGlobal('visualViewport', viewport);
  host = document.createElement('div');
  host.className = 'cal-screen';
  host.innerHTML = '<div class="cal-header"></div><button class="cal-fab"></button><div id="pet-test"></div><input aria-label="quick" />';
  document.body.append(host);
  root = createRoot(host.querySelector('#pet-test')!);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('cal-header')) return DOMRect.fromRect({ x: 0, y: 0, width: 390, height: 150 });
    if (this.classList.contains('cal-fab')) return DOMRect.fromRect({ x: 318, y: height - 72, width: 56, height: 56 });
    if (this.classList.contains('cal-pet-layer')) return DOMRect.fromRect({ x: 12, y: 0, width: 366, height: 0 });
    if (this.classList.contains('cal-pet')) return DOMRect.fromRect({ width: 60, height: 60 });
    return DOMRect.fromRect({ x: 12, y: 0, width: 366, height });
  });
  vi.stubGlobal('PointerEvent', MouseEvent);
  act(() => root.render(<PetLayer petName="摩卡" todos={[]} todayKey="2026-10-22" greeted onGreeted={() => {}} onAddTodo={() => {}} onToggleTodo={() => {}} onDeleteTodo={() => {}} />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const pet = () => host.querySelector<HTMLButtonElement>('.cal-pet')!;
const tab = () => host.querySelector<HTMLButtonElement>('.cal-pet-tab')!;
function clickText(text: string) {
  const button = [...host.querySelectorAll('button')].find(button => button.textContent === text);
  expect(button, text).toBeTruthy();
  act(() => button!.click());
}
function open() { act(() => { pet().focus(); pet().click(); }); }
function press(key: string) { act(() => pet().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))); }
function pointer(type: string, x: number, y: number) {
  act(() => pet().dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true })));
}
function completionPet() {
  let completed: (() => void) | undefined;
  const source = { subscribe(listener: () => void) { completed = listener; return () => { completed = undefined; }; } };
  act(() => root.render(<PetLayer petName="摩卡" todos={[]} todayKey="2026-10-25" greeted onGreeted={() => {}} onAddTodo={() => {}} onToggleTodo={() => {}} onDeleteTodo={() => {}} todoCompletions={source} />));
  return () => act(() => completed?.());
}
const completionImageSource = () => pet()?.querySelector('img')?.getAttribute('src');
it('plays confirmed completion once from idle, restores idle after decode, and interrupts it on drag', async () => {
  vi.useFakeTimers();
  const complete = completionPet();
  const before = localStorage.getItem('daypop.user-data');
  complete();
  expect(completionImageSource()).toMatch(/jump.*webp/);
  await act(async () => pet().querySelector('img')!.dispatchEvent(new Event('load')));
  act(() => vi.advanceTimersByTime(1000));
  expect(completionImageSource()).toMatch(/idle.*webp/);
  complete();
  pointer('pointerdown', 50, 550); pointer('pointermove', 150, 350);
  expect(completionImageSource()).toMatch(/grab.*png/);
  complete();
  pointer('pointerup', 150, 350);
  expect(completionImageSource()).toMatch(/idle.*webp/);
  expect(localStorage.getItem('daypop.user-data')).toBe(before);
});
it('drops completion during bubble, look, collapse and background without later replay', async () => {
  vi.useFakeTimers();
  const complete = completionPet();
  open(); complete();
  expect(completionImageSource()).toMatch(/idle.*png/);
  clickText('✕'); complete();
  expect(completionImageSource()).toMatch(/look.*webp/);
  await act(async () => pet().querySelector('img')!.dispatchEvent(new Event('load')));
  act(() => vi.advanceTimersByTime(1600));
  expect(completionImageSource()).toMatch(/idle.*webp/);
  open(); clickText('收起夥伴'); complete();
  act(() => tab().click());
  expect(completionImageSource()).toMatch(/idle.*webp/);
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  complete();
  hidden.mockRestore();
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(completionImageSource()).toMatch(/idle.*webp/);
});
it('wakes sleep for completion, restarts a new cue, and discards a covered pending jump', async () => {
  act(() => root.render(null));
  vi.useFakeTimers();
  const complete = completionPet();
  act(() => vi.advanceTimersByTime(120000));
  expect(completionImageSource()).toMatch(/sleep.*webp/);
  complete();
  await act(async () => pet().querySelector('img')!.dispatchEvent(new Event('load')));
  act(() => vi.advanceTimersByTime(500));
  complete();
  await act(async () => pet().querySelector('img')!.dispatchEvent(new Event('load')));
  act(() => vi.advanceTimersByTime(500));
  expect(completionImageSource()).toMatch(/jump.*webp/);
  await act(async () => host.querySelector('input')!.focus());
  expect(artwork()).toBeNull();
  complete();
  await act(async () => host.querySelector('input')!.blur());
  act(() => vi.advanceTimersByTime(5000));
  expect(completionImageSource()).toMatch(/idle.*webp/);
});
it('collapses to a focused edge tab and expands to the character, saving UI state only', () => {
  const data = localStorage.getItem('daypop.user-data');
  const resting = pet().style.transform.match(/-?[\d.]+/g)!.map(Number);
  open();
  clickText('收起夥伴');
  expect(pet()).toBeNull();
  expect(tab()).toBe(document.activeElement);
  expect(JSON.parse(localStorage.getItem(key)!).collapsed).toBe(true);
  act(() => tab().click());
  expect(tab()).toBeNull();
  expect(pet()).toBe(document.activeElement);
  const restored = pet().style.transform.match(/-?[\d.]+/g)!.map(Number);
  restored.forEach((coordinate, index) => expect(coordinate).toBeCloseTo(resting[index]!, 6));
  expect(JSON.parse(localStorage.getItem(key)!).collapsed).toBe(false);
  expect(localStorage.getItem('daypop.user-data')).toBe(data);
});
it('keyboard move previews without writes, Escape cancels, Enter saves and leaves focus on the pet', () => {
  open();
  clickText('移動夥伴');
  expect(pet()).toBe(document.activeElement);
  const before = pet().style.transform;
  press('ArrowUp'); press('ArrowRight');
  expect(pet().style.transform).not.toBe(before);
  expect(localStorage.getItem(key)).toBeNull();
  press('Escape');
  expect(pet().style.transform).toBe(before);
  open(); clickText('移動夥伴'); press('ArrowUp'); press('Enter');
  expect(localStorage.getItem(key)).not.toBeNull();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(pet()).toBe(document.activeElement);
});
it('drags without opening the bubble and cancels an interrupted drag without saving', () => {
  const initial = pet().style.transform;
  pointer('pointerdown', 50, 550); pointer('pointermove', 150, 350);
  expect(pet().style.transform).not.toBe(initial);
  expect(localStorage.getItem(key)).toBeNull();
  pointer('pointercancel', 150, 350);
  expect(pet().style.transform).toBe(initial);
  pointer('pointerdown', 50, 550); pointer('pointermove', 150, 350); pointer('pointerup', 150, 350);
  act(() => pet().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(JSON.parse(localStorage.getItem(key)!).x).toBeGreaterThan(0);
});
it('hides while a form is focused or space is insufficient, then restores without changing saved position', async () => {
  open(); clickText('移動夥伴'); press('ArrowUp'); press('Enter');
  const saved = localStorage.getItem(key);
  await act(async () => { host.querySelector('input')!.focus(); });
  expect(pet().hidden).toBe(true);
  await act(async () => { host.querySelector('input')!.blur(); });
  expect(pet().hidden).toBe(false);
  height = 100;
  act(() => window.dispatchEvent(new Event('resize')));
  expect(pet().hidden).toBe(true);
  height = 600;
  act(() => window.dispatchEvent(new Event('resize')));
  expect(pet().hidden).toBe(false);
  expect(localStorage.getItem(key)).toBe(saved);
});
it('returns focus after Escape closes a bubble whose input had hidden the pet', async () => {
  open();
  await act(async () => host.querySelector<HTMLInputElement>('input[aria-label="新增今日待辦"]')!.focus());
  expect(pet().hidden).toBe(true);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(pet().hidden).toBe(false);
  expect(pet()).toBe(document.activeElement);
});
it('uses visualViewport occlusion as a temporary hide without saving', () => {
  viewport.height = 300;
  act(() => viewport.dispatchEvent(new Event('resize')));
  expect(pet().hidden).toBe(true);
  viewport.height = 900;
  act(() => viewport.dispatchEvent(new Event('resize')));
  expect(pet().hidden).toBe(false);
  expect(localStorage.getItem(key)).toBeNull();
});
it('drops a pointer preview when an external form covers it, restoring the saved position', async () => {
  const before = pet().style.transform;
  pointer('pointerdown', 50, 550); pointer('pointermove', 150, 350);
  expect(pet().style.transform).not.toBe(before);
  await act(async () => host.querySelector('input')!.focus());
  await act(async () => host.querySelector('input')!.blur());
  expect(pet().style.transform).toBe(before);
  expect(localStorage.getItem(key)).toBeNull();
});
it('commits a horizontal-only drag in the zero-height passthrough layer', () => {
  pointer('pointerdown', 50, 550); pointer('pointermove', 150, 550); pointer('pointerup', 150, 550);
  expect(JSON.parse(localStorage.getItem(key) ?? 'null')?.x).toBeGreaterThan(0);
  act(() => pet().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

const artwork = () => host.querySelector<HTMLImageElement>('.cal-pet-art img')!;
async function decoded() {
  await act(async () => artwork().dispatchEvent(new Event('load')));
}
it('plays look once after a real bubble close, then idle, with the clock starting after decode', async () => {
  vi.useFakeTimers();
  try {
    expect(artwork()?.getAttribute('src')).toMatch(/moon-cat-idle.*webp/);
    open();
    expect(artwork().getAttribute('src')).toMatch(/idle.*png/);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="關閉"]')!.click());
    expect(artwork().getAttribute('src')).toMatch(/look.*webp/);
    act(() => vi.advanceTimersByTime(3000));
    expect(artwork().getAttribute('src')).toMatch(/look.*webp/);
    await decoded();
    act(() => vi.advanceTimersByTime(1599));
    expect(artwork().getAttribute('src')).toMatch(/look.*webp/);
    act(() => vi.advanceTimersByTime(1));
    expect(artwork().getAttribute('src')).toMatch(/idle.*webp/);
  } finally { vi.useRealTimers(); }
});
it('uses grab only after the pointer threshold or during keyboard movement, and cancels cleanly', () => {
  pointer('pointerdown', 50, 550); pointer('pointermove', 52, 550);
  expect(artwork()?.getAttribute('src')).toMatch(/idle.*webp/);
  pointer('pointermove', 150, 550);
  expect(artwork().getAttribute('src')).toMatch(/grab.*png/);
  pointer('pointercancel', 150, 550);
  expect(artwork().getAttribute('src')).toMatch(/idle.*webp/);
  expect(localStorage.getItem(key)).toBeNull();
  open(); clickText('移動夥伴');
  expect(artwork().getAttribute('src')).toMatch(/grab.*png/);
  press('Escape');
  expect(artwork().getAttribute('src')).toMatch(/idle.*webp/);
});
it('removes images while covered or in the background without saving position', async () => {
  await act(async () => host.querySelector('input')!.focus());
  expect(artwork()).toBeNull();
  await act(async () => host.querySelector('input')!.blur());
  expect(artwork().getAttribute('src')).toMatch(/idle.*webp/);
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(artwork()).toBeNull();
  expect(host.querySelector('.cal-pet-art')?.getAttribute('data-paused')).toBe('true');
  hidden.mockReturnValue(false);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(artwork().getAttribute('src')).toMatch(/idle.*webp/);
  expect(localStorage.getItem(key)).toBeNull();
});
it('unmounts assets when collapsed and expands to idle without a look cue', () => {
  open(); clickText('收起夥伴');
  expect(artwork()).toBeNull();
  act(() => tab().click());
  expect(artwork()?.getAttribute('src')).toMatch(/idle.*webp/);
});

function restartWithClock() {
  act(() => root.render(null));
  vi.useFakeTimers();
  act(() => root.render(<PetLayer petName="摩卡" todos={[]} todayKey="2026-10-22" greeted onGreeted={() => {}} onAddTodo={() => {}} onToggleTodo={() => {}} onDeleteTodo={() => {}} />));
}
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
it('sleeps only after 120 seconds, wakes for each input and never changes data or focus', () => {
  restartWithClock();
  const before = { ...localStorage };
  act(() => pet().focus());
  advance(119999);
  expect(artwork()?.getAttribute('src')).toMatch(/idle.*webp/);
  advance(1);
  expect(artwork()?.getAttribute('src')).toMatch(/sleep.*webp/);
  expect(document.activeElement).toBe(pet());
  for (const event of [new Event('pointerdown'), new KeyboardEvent('keydown', { key: 'a' }), new WheelEvent('wheel')]) {
    act(() => document.dispatchEvent(event));
    expect(artwork().getAttribute('src')).toMatch(/idle.*webp/);
    advance(119999);
    expect(artwork().getAttribute('src')).toMatch(/idle.*webp/);
    advance(1);
    expect(artwork().getAttribute('src')).toMatch(/sleep.*webp/);
  }
  expect({ ...localStorage }).toEqual(before);
  expect(document.activeElement).toBe(pet());
});
it('discards hidden and background idle time, restarting a full interval when visible', async () => {
  restartWithClock();
  advance(119000);
  await act(async () => host.querySelector('input')!.focus());
  advance(240000);
  expect(artwork()).toBeNull();
  await act(async () => host.querySelector('input')!.blur());
  advance(119999);
  expect(artwork()?.getAttribute('src')).toMatch(/idle.*webp/);
  advance(1);
  expect(artwork()?.getAttribute('src')).toMatch(/sleep.*webp/);
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  advance(240000);
  expect(artwork()).toBeNull();
  hidden.mockReturnValue(false);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  advance(119999);
  expect(artwork()?.getAttribute('src')).toMatch(/idle.*webp/);
  advance(1);
  expect(artwork()?.getAttribute('src')).toMatch(/sleep.*webp/);
  expect(localStorage.getItem(key)).toBeNull();
});
it('gives bubble, look, grab and collapse priority over sleep and restarts after each', async () => {
  restartWithClock(); advance(120000);
  expect(artwork()?.getAttribute('src')).toMatch(/sleep.*webp/);
  open(); advance(240000);
  expect(artwork().getAttribute('src')).toMatch(/idle.*png/);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="關閉"]')!.click());
  advance(120000);
  expect(artwork().getAttribute('src')).toMatch(/look.*webp/);
  await decoded(); advance(1600);
  expect(artwork().getAttribute('src')).toMatch(/idle.*webp/);
  advance(120000);
  expect(artwork().getAttribute('src')).toMatch(/sleep.*webp/);
  pointer('pointerdown', 50, 550); pointer('pointermove', 150, 550); advance(240000);
  expect(artwork().getAttribute('src')).toMatch(/grab.*png/);
  pointer('pointercancel', 150, 550); advance(119999);
  expect(artwork().getAttribute('src')).toMatch(/idle.*webp/);
  advance(1); open(); clickText('收起夥伴'); advance(240000);
  expect(artwork()).toBeNull();
  act(() => tab().click()); advance(119999);
  expect(artwork()?.getAttribute('src')).toMatch(/idle.*webp/);
  advance(1);
  expect(artwork()?.getAttribute('src')).toMatch(/sleep.*webp/);
});
it('uses the sleep PNG in reduced motion without postponing or replaying the idle deadline', () => {
  const media = Object.assign(new EventTarget(), { matches: true });
  vi.stubGlobal('matchMedia', () => media);
  restartWithClock(); advance(120000);
  expect(artwork()?.getAttribute('src')).toMatch(/sleep.*png/);
  act(() => { media.matches = false; media.dispatchEvent(new Event('change')); });
  expect(artwork().getAttribute('src')).toMatch(/sleep.*webp/);
  act(() => { media.matches = true; media.dispatchEvent(new Event('change')); });
  expect(artwork().getAttribute('src')).toMatch(/sleep.*png/);
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })));
  expect(artwork().getAttribute('src')).toMatch(/idle.*png/);
  advance(120000);
  expect(artwork().getAttribute('src')).toMatch(/sleep.*png/);
});
it('leaves no idle clock or input listener capable of restarting one after unmount', () => {
  restartWithClock(); advance(119999);
  act(() => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
  act(() => document.dispatchEvent(new Event('pointerdown')));
  expect(vi.getTimerCount()).toBe(0);
  advance(240000);
  expect(vi.getTimerCount()).toBe(0);
  expect(host.querySelector('.cal-pet-art')).toBeNull();
});
