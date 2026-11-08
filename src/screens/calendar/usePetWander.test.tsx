import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PetArea, PetPoint } from './petPlacement';
import { WANDER_SIT_MS } from './petWander';
import { usePetWander, type WanderState } from './usePetWander';

const area: PetArea = { width: 366, height: 640, top: 120 };
const home: PetPoint = { x: 14, y: 400 };
// random() = 0: first delay 30s, next 45s, prefer right, minimum distance 40px → 1,200ms legs.
const zero = () => 0;

let container: HTMLDivElement;
let root: Root;
let latest: WanderState;
/** Every phase committed, so a test can prove the pet never left its spot. */
let seen: WanderState['phase'][] = [];
let reduce = false;

function Probe({ enabled, point = home }: { enabled: boolean; point?: PetPoint }) {
  const state = usePetWander({ enabled, home: point, area, random: zero });
  // Record every committed state: that is what reaches the screen.
  useLayoutEffect(() => {
    latest = state;
    seen.push(state.phase);
  });
  return null;
}
function render(enabled = true, point?: PetPoint) {
  act(() => root.render(<Probe enabled={enabled} point={point} />));
}
/**
 * One act() around a long advance batches every state update into the last
 * one, so a whole excursion would render only as `rest`. Step in slices shorter
 * than the shortest phase (a 1,200ms leg) so every phase actually renders.
 */
const STEP_MS = 500;
function advance(ms: number) {
  for (let left = ms; left > 0; left -= STEP_MS) {
    act(() => { vi.advanceTimersByTime(Math.min(STEP_MS, left)); });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  reduce = false;
  seen = [];
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') ? reduce : false,
    addEventListener() {}, removeEventListener() {},
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('DP-240 usePetWander', () => {
  it('rests, walks out, sits, walks back and rests again on the saved position', () => {
    render();
    expect(latest).toEqual({ phase: 'rest', offset: 0, legMs: 0 });
    advance(29_999);
    expect(latest.phase).toBe('rest');
    advance(1);
    expect(latest).toEqual({ phase: 'out', offset: 40, legMs: 1_200 });
    advance(1_200);
    expect(latest).toEqual({ phase: 'sit', offset: 40, legMs: 0 });
    advance(WANDER_SIT_MS);
    expect(latest).toEqual({ phase: 'back', offset: 0, legMs: 1_200 });
    advance(1_200);
    expect(latest).toEqual({ phase: 'rest', offset: 0, legMs: 0 });
  });

  it('takes at most two excursions without input, then stays put until the next input', () => {
    render();
    advance(30_000 + 7_400); // first excursion done
    advance(45_000);
    expect(latest.phase).toBe('out'); // second
    advance(7_400);
    expect(latest.phase).toBe('rest');
    seen = [];
    advance(10 * 60_000);
    expect(seen.every(phase => phase === 'rest')).toBe(true);
    act(() => { document.dispatchEvent(new Event('keydown')); });
    advance(30_000);
    expect(latest.phase).toBe('out');
  });

  it.each(['pointerdown', 'keydown', 'wheel'])('%s anywhere ends an excursion at once and restarts the quiet period', name => {
    render();
    advance(30_000 + 1_200);
    expect(latest.phase).toBe('sit');
    act(() => { document.dispatchEvent(new Event(name)); });
    expect(latest).toEqual({ phase: 'rest', offset: 0, legMs: 0 });
    advance(29_999);
    expect(latest.phase).toBe('rest');
  });

  it('snaps back as soon as it is no longer enabled, and does not wander while disabled', () => {
    render();
    advance(30_000);
    expect(latest.phase).toBe('out');
    seen = [];
    render(false);
    // Not even one frame at the old offset once it is disabled.
    expect(seen.every(phase => phase === 'rest')).toBe(true);
    expect(latest).toEqual({ phase: 'rest', offset: 0, legMs: 0 });
    seen = [];
    advance(10 * 60_000);
    expect(seen.every(phase => phase === 'rest')).toBe(true);
  });

  it('restarts from the new saved position when the position changes mid-excursion', () => {
    render();
    advance(30_000 + 1_200);
    expect(latest.phase).toBe('sit');
    render(true, { x: 100, y: 300 });
    expect(latest).toEqual({ phase: 'rest', offset: 0, legMs: 0 });
  });

  it('never wanders with reduced motion', () => {
    reduce = true;
    render();
    advance(10 * 60_000);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(phase => phase === 'rest')).toBe(true);
  });

  it('never wanders in the background', () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    try {
      render();
      advance(10 * 60_000);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every(phase => phase === 'rest')).toBe(true);
    } finally {
      hidden.mockRestore();
    }
  });
});
