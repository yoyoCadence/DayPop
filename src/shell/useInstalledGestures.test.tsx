import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInstalledGestures } from './useInstalledGestures';

let root: Root, container: HTMLDivElement, viewport: HTMLDivElement;
let display: EventTarget & { matches: boolean };
function Fixture() { useInstalledGestures(viewport); return null; }
function dispatch(type: string, target: HTMLElement = viewport) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}
beforeEach(() => {
  container = document.createElement('div'); viewport = document.createElement('div');
  document.body.append(container, viewport); root = createRoot(container);
  display = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', vi.fn(() => display));
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); viewport.remove();
  delete (navigator as Navigator & { standalone?: boolean }).standalone;
  vi.unstubAllGlobals();
});
describe('installed viewport gestures', () => {
  it('leaves ordinary browser zoom and touch input available', () => {
    act(() => root.render(<Fixture />));
    expect(viewport.hasAttribute('data-installed')).toBe(false);
    expect(dispatch('gesturestart')).toBe(false);
    expect(dispatch('gesturechange')).toBe(false);
    expect(dispatch('touchmove')).toBe(false);
  });
  it('cancels installed pinch gestures from nested dialogs while preserving single-touch events', () => {
    display.matches = true;
    act(() => root.render(<StrictMode><Fixture /></StrictMode>));
    const field = document.createElement('input'); viewport.append(field);
    expect(viewport.hasAttribute('data-installed')).toBe(true);
    expect(dispatch('gesturestart', field)).toBe(true);
    expect(dispatch('gesturechange', field)).toBe(true);
    for (const type of ['touchstart', 'touchmove', 'touchend', 'pointermove', 'click']) expect(dispatch(type, field)).toBe(false);
    act(() => root.render(null));
    expect(viewport.hasAttribute('data-installed')).toBe(false);
    expect(dispatch('gesturestart', field)).toBe(false);
    expect(dispatch('gesturechange', field)).toBe(false);
  });
  it('follows display mode changes without leaving a restriction in the browser', () => {
    act(() => root.render(<Fixture />));
    display.matches = true; display.dispatchEvent(new Event('change'));
    expect(viewport.hasAttribute('data-installed')).toBe(true);
    expect(dispatch('gesturestart')).toBe(true);
    display.matches = false; display.dispatchEvent(new Event('change'));
    expect(viewport.hasAttribute('data-installed')).toBe(false);
    expect(dispatch('gesturestart')).toBe(false);
    act(() => root.render(null));
    display.matches = true; display.dispatchEvent(new Event('change'));
    expect(viewport.hasAttribute('data-installed')).toBe(false);
  });
  it('recognizes iOS standalone when the display media API is absent', () => {
    vi.stubGlobal('matchMedia', undefined);
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    act(() => root.render(<Fixture />));
    expect(viewport.hasAttribute('data-installed')).toBe(true);
    expect(dispatch('gesturechange')).toBe(true);
  });
});
