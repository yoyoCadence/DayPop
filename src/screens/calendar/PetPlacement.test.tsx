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
