import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePetAutonomy } from './usePetAutonomy';
import type { PetPoint } from './petPlacement';

let host: HTMLDivElement, button: HTMLButtonElement, root: Root;
let media: EventTarget & { matches: boolean }, background: boolean;
let point: PetPoint, sequence: number, renders: number;
let frames: Map<number, FrameRequestCallback>;
let control: { current: HTMLButtonElement | null };
const area = { width: 390, height: 620, top: 180, obstacle: { left: 310, top: 540, right: 370, bottom: 600 } };
const settle = vi.fn();
function Fixture({ blocked = false, enabled = true }: { blocked?: boolean; enabled?: boolean }) {
  renders++;
  const activity = usePetAutonomy({ area, control, enabled, blocked, currentPosition: () => point,
    paint: next => { point = next; button.style.transform = `translate(${point.x}px, ${point.y}px)`; }, settle });
  return <output>{activity.pose}</output>;
}
async function render(props = {}) { await act(async () => root.render(<StrictMode><Fixture {...props} /></StrictMode>)); }
function advance(ms: number, paint = true) {
  act(() => {
    vi.advanceTimersByTime(ms);
    if (paint) {
      const work = [...frames.values()]; frames.clear();
      for (const frame of work) frame(performance.now());
    }
  });
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.spyOn(Math, 'random').mockReturnValue(0);
  media = Object.assign(new EventTarget(), { matches: false }); background = false;
  vi.stubGlobal('matchMedia', () => media);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => background });
  host = document.createElement('div'); button = document.createElement('button'); document.body.append(host, button);
  root = createRoot(host); control = { current: button }; point = { x: 14, y: 550 }; renders = sequence = 0;
  frames = new Map(); settle.mockClear();
  vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => { frames.set(++sequence, frame); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); button.remove();
  delete (document as unknown as { hidden?: boolean }).hidden;
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
});

it('waits, walks through actual intermediate positions without per-frame renders, then rests', async () => {
  await render(); advance(7999); expect(host.textContent).toBe('idle');
  advance(1); expect(host.textContent).toBe('walk'); const count = renders;
  advance(500); expect(point.x).toBeGreaterThan(14); expect(point.x).toBeLessThan(50);
  expect(button.style.transform).toContain(String(point.x)); expect(renders).toBe(count);
  advance(1200); expect(point).toEqual({ x: 50, y: 550 }); expect(host.textContent).toBe('sit');
  expect(settle).toHaveBeenCalled();
});
it('sleeps after 120 foreground seconds and input wakes it without replaying missed walks', async () => {
  await render();
  for (let i = 0; i < 240; i++) advance(500);
  expect(host.textContent).toBe('sleep'); expect(frames.size).toBe(0);
  act(() => document.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(host.textContent).toBe('idle');
  const resting = { ...point }; advance(7999); expect(point).toEqual(resting);
});
it.each(['pointerdown', 'keydown', 'wheel'])('%s freezes before handlers and preserves normal input', async type => {
  await render(); advance(8500); advance(500); const at = { ...point };
  const input = new Event(type, { bubbles: true, cancelable: true });
  act(() => button.dispatchEvent(input));
  expect(input.defaultPrevented).toBe(false); expect(host.textContent).toBe('idle'); expect(frames.size).toBe(0);
  advance(7999); expect(point).toEqual(at);
});
it('stops for a modal/drag/focus interruption, resumes a fresh delay, and cleans up unmount', async () => {
  await render(); advance(8500); advance(500); const at = { ...point };
  await render({ blocked: true }); advance(180_000); expect(point).toEqual(at); expect(frames.size).toBe(0);
  await render(); advance(7999); expect(host.textContent).toBe('idle'); advance(1); expect(host.textContent).toBe('walk');
  await act(async () => root.render(null)); expect(frames.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
it('keeps a long or multi-pointer press paused until the last release/cancel', async () => {
  await render(); advance(8500); advance(500);
  const pointer = (type: string, id: number) => Object.assign(new Event(type, { bubbles: true }), { pointerId: id });
  act(() => { document.dispatchEvent(pointer('pointerdown', 1)); document.dispatchEvent(pointer('pointerdown', 2)); });
  const held = { ...point }; advance(60_000); expect(point).toEqual(held); expect(host.textContent).toBe('idle');
  act(() => document.dispatchEvent(pointer('pointerup', 1)));
  advance(30_000); expect(point).toEqual(held); expect(vi.getTimerCount()).toBe(0);
  act(() => document.dispatchEvent(pointer('pointercancel', 2)));
  advance(7999); expect(point).toEqual(held); advance(1); expect(host.textContent).toBe('walk');
});
it('recognizes focus already on a reused control and resumes only after it leaves', async () => {
  button.focus(); await render(); advance(30_000);
  expect(point).toEqual({ x: 14, y: 550 }); expect(vi.getTimerCount()).toBe(0);
  await render({ blocked: true }); await render(); advance(30_000);
  expect(point).toEqual({ x: 14, y: 550 }); expect(host.textContent).toBe('idle');
  await act(async () => button.blur()); advance(8000); expect(host.textContent).toBe('walk');
});
it('freezes on pointer approach, with no polling until the pointer leaves', async () => {
  await render(); advance(8500); advance(500);
  act(() => button.dispatchEvent(new Event('pointerenter')));
  const at = { ...point }; advance(30_000); expect(point).toEqual(at); expect(vi.getTimerCount()).toBe(0);
  act(() => button.dispatchEvent(new Event('pointerleave')));
  advance(8000); expect(host.textContent).toBe('walk');
});
it('pauses in the background and resets foreground idle time on return', async () => {
  await render(); advance(8500); advance(500); const at = { ...point };
  act(() => { background = true; document.dispatchEvent(new Event('visibilitychange')); });
  advance(240_000); expect(point).toEqual(at); expect(frames.size).toBe(0);
  await act(async () => { background = false; document.dispatchEvent(new Event('visibilitychange')); });
  advance(7999); expect(host.textContent).toBe('idle');
});
it('respects live reduced motion and never schedules legacy/no-layout pets', async () => {
  await render(); advance(8500);
  act(() => { media.matches = true; media.dispatchEvent(new Event('change')); });
  advance(120_000); expect(host.textContent).toBe('idle'); expect(frames.size).toBe(0);
  await render({ enabled: false }); expect(vi.getTimerCount()).toBe(0);
  control.current = null; media.matches = false;
  await render({ enabled: true }); advance(120_000); expect(frames.size).toBe(0);
});
