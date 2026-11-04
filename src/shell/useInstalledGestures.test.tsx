import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInstalledGestures } from './useInstalledGestures';

let root: Root, container: HTMLDivElement, viewport: HTMLDivElement, meta: HTMLMetaElement;
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
  meta = document.createElement('meta'); meta.name = 'viewport';
  meta.content = 'width=device-width, initial-scale=1, viewport-fit=cover'; document.head.append(meta);
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); viewport.remove();
  meta.remove();
  delete (navigator as Navigator & { standalone?: boolean }).standalone;
  vi.unstubAllGlobals();
});
describe('installed viewport gestures', () => {
  it('leaves ordinary browser zoom and touch input available', () => {
    act(() => root.render(<Fixture />));
    expect(viewport.hasAttribute('data-installed')).toBe(false);
    expect(document.documentElement.hasAttribute('data-daypop-installed')).toBe(false);
    expect(meta.content).toBe('width=device-width, initial-scale=1, viewport-fit=cover');
    expect(dispatch('gesturestart')).toBe(false);
    expect(dispatch('gesturechange')).toBe(false);
    expect(dispatch('touchmove')).toBe(false);
  });
  it('cancels installed pinch gestures from nested dialogs while preserving single-touch events', () => {
    display.matches = true;
    act(() => root.render(<StrictMode><Fixture /></StrictMode>));
    const field = document.createElement('input'); viewport.append(field);
    expect(viewport.hasAttribute('data-installed')).toBe(true);
    expect(document.documentElement.hasAttribute('data-daypop-installed')).toBe(true);
    expect(meta.content).toContain('maximum-scale=1, user-scalable=no');
    expect(dispatch('gesturestart', field)).toBe(true);
    expect(dispatch('gesturechange', field)).toBe(true);
    for (const type of ['touchstart', 'touchmove', 'touchend', 'pointermove', 'click']) expect(dispatch(type, field)).toBe(false);
    act(() => root.render(null));
    expect(viewport.hasAttribute('data-installed')).toBe(false);
    expect(document.documentElement.hasAttribute('data-daypop-installed')).toBe(false);
    expect(meta.content).toBe('width=device-width, initial-scale=1, viewport-fit=cover');
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
    expect(meta.content).toBe('width=device-width, initial-scale=1, viewport-fit=cover');
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
  it('restores an existing scale policy exactly after display mode changes', () => {
    meta.content = 'width=device-width, maximum-scale=5, user-scalable=yes';
    display.matches = true;
    act(() => root.render(<Fixture />));
    expect(meta.content).toBe('width=device-width, maximum-scale=1, user-scalable=no');
    display.matches = false; display.dispatchEvent(new Event('change'));
    expect(meta.content).toBe('width=device-width, maximum-scale=5, user-scalable=yes');
  });
  it('cleans up a temporary viewport meta when none existed', () => {
    meta.remove(); display.matches = true;
    act(() => root.render(<StrictMode><Fixture /></StrictMode>));
    expect(document.querySelectorAll('meta[name="viewport"]')).toHaveLength(1);
    act(() => root.render(null));
    expect(document.querySelector('meta[name="viewport"]')).toBeNull();
  });
});
