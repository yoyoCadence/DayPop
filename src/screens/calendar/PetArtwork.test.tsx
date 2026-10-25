import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PetArtwork } from './PetArtwork';
import { PET_ASSETS, type PetPose } from './petAssets';

let host: HTMLDivElement;
let root: Root;
let media: EventTarget & { matches: boolean };
const done = vi.fn();
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', () => media);
  done.mockClear();
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function render(pose: PetPose = 'idle', cue: number | null = null, paused = false, hidden = false) {
  act(() => root.render(<PetArtwork pose={pose} cue={cue} paused={paused} hidden={hidden} onLookDone={done} />));
}
const image = () => host.querySelector<HTMLImageElement>('img')!;
async function load() { await act(async () => image().dispatchEvent(new Event('load'))); }
it('registers the mixed five-state package for both keys; unmade poses keep CSS', () => {
  for (const kind of ['moon_cat', 'orbit_ufo'] as const) {
    expect(Object.keys(PET_ASSETS[kind]).sort()).toEqual(['grab', 'idle', 'jump', 'look', 'sleep']);
    expect(PET_ASSETS[kind].look?.still).toBe(PET_ASSETS[kind].idle?.still);
    expect(PET_ASSETS[kind].look?.durationMs).toBe(1600);
    expect(PET_ASSETS[kind].jump?.still).toBe(PET_ASSETS[kind].idle?.still);
    expect(PET_ASSETS[kind].jump?.durationMs).toBe(1000);
  }
  render('walk');
  expect(image()).toBeNull();
  expect(host.querySelector('.cal-pet-body')).not.toBeNull();
});
for (const kind of ['moon_cat', 'orbit_ufo'] as const) {
  it(`${kind} jump decodes, shares idle PNG, removes hidden images and falls back on failure`, async () => {
    const jump = (paused = false, hidden = false) => act(() => root.render(
      <PetArtwork kind={kind} pose="jump" cue={null} paused={paused} hidden={hidden} onLookDone={done} />,
    ));
    jump();
    expect(image()?.getAttribute('src')).toMatch(/jump.*webp/);
    expect(host.querySelector('.cal-pet-body')).not.toBeNull();
    await load();
    expect(image().hidden).toBe(false);
    jump(true);
    expect(image().getAttribute('src')).toMatch(/idle.*png/);
    await load();
    jump();
    act(() => { media.matches = true; media.dispatchEvent(new Event('change')); });
    expect(image().getAttribute('src')).toMatch(/idle.*png/);
    jump(false, true);
    expect(image()).toBeNull();
    jump();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    try {
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      expect(image()).toBeNull();
    } finally { hidden.mockRestore(); }
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => image().dispatchEvent(new Event('error')));
    expect(image()).toBeNull();
    expect(host.querySelector('.cal-pet-body')).not.toBeNull();
    expect(done).not.toHaveBeenCalled();
  });
  it(`${kind} sleep decodes, uses its actual PNG when stopped, removes hidden images and falls back on failure`, async () => {
    const sleep = (paused = false, hidden = false) => act(() => root.render(
      <PetArtwork kind={kind} pose="sleep" cue={null} paused={paused} hidden={hidden} onLookDone={done} />,
    ));
    sleep();
    expect(image()?.getAttribute('src')).toMatch(/sleep.*webp/);
    expect(host.querySelector('.cal-pet-body')).not.toBeNull();
    await load();
    expect(image().hidden).toBe(false);
    sleep(true);
    expect(image().getAttribute('src')).toMatch(/sleep.*png/);
    await load();
    sleep();
    act(() => { media.matches = true; media.dispatchEvent(new Event('change')); });
    expect(image().getAttribute('src')).toMatch(/sleep.*png/);
    sleep(false, true);
    expect(image()).toBeNull();
    sleep();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    try {
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      expect(image()).toBeNull();
    } finally { hidden.mockRestore(); }
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => image().dispatchEvent(new Event('error')));
    expect(image()).toBeNull();
    expect(host.querySelector('.cal-pet-body')).not.toBeNull();
    expect(done).not.toHaveBeenCalled();
  });
}
it('keeps CSS until decode finishes, and an actual decode failure keeps that fallback', async () => {
  render();
  expect(image().hidden).toBe(true);
  expect(host.querySelector('.cal-pet-body')).not.toBeNull();
  Object.defineProperty(image(), 'decode', { value: () => Promise.reject(new Error('invalid image')) });
  await load();
  expect(image()).toBeNull();
  expect(host.querySelector('.cal-pet-body')).not.toBeNull();
});
it('ignores an old pending decode and never starts an obsolete look clock', async () => {
  vi.useFakeTimers();
  render('look', 1);
  let resolve!: () => void;
  Object.defineProperty(image(), 'decode', { value: () => new Promise<void>(ready => { resolve = ready; }) });
  await load();
  render('grab');
  await act(async () => resolve());
  expect(image().hidden).toBe(true);
  act(() => vi.advanceTimersByTime(5000));
  expect(done).not.toHaveBeenCalled();
  await load();
  expect(image().hidden).toBe(false);
});
it('reacts to reduced motion by replacing the native animation, including before decode', async () => {
  render();
  const url = image().getAttribute('src');
  act(() => { media.matches = true; media.dispatchEvent(new Event('change')); });
  expect(image().getAttribute('src')).toMatch(/idle.*png/);
  expect(host.querySelector('.cal-pet-art')?.getAttribute('data-paused')).toBe('true');
  await load();
  act(() => { media.matches = false; media.dispatchEvent(new Event('change')); });
  expect(image().getAttribute('src')).toBe(url);
});
it('does not let an earlier look or an unmounted clock complete a later cue', async () => {
  vi.useFakeTimers();
  render('look', 1); await load();
  act(() => vi.advanceTimersByTime(800));
  render('look', 2); await load();
  act(() => vi.advanceTimersByTime(800));
  expect(done).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(800));
  expect(done).toHaveBeenCalledExactlyOnceWith(2);
  render('look', 3); await load();
  act(() => root.render(null));
  act(() => vi.advanceTimersByTime(5000));
  expect(done).toHaveBeenCalledTimes(1);
});
it('finishes a reduced-motion look as a still cue instead of keeping a deferred animation', async () => {
  vi.useFakeTimers(); media.matches = true;
  render('look', 7); await load();
  expect(image().getAttribute('src')).toMatch(/idle.*png/);
  act(() => vi.advanceTimersByTime(1600));
  expect(done).toHaveBeenCalledExactlyOnceWith(7);
});
it('falls back after a network error without removing the surrounding button or adding a message', () => {
  render();
  act(() => image().dispatchEvent(new Event('error')));
  expect(image()).toBeNull();
  expect(host.querySelector('.cal-pet-body')).not.toBeNull();
  expect(host.textContent).toBe('');
});
it('completes a failed look so a healthy idle asset can resume', async () => {
  render('look', 8);
  act(() => image().dispatchEvent(new Event('error')));
  expect(done).toHaveBeenCalledExactlyOnceWith(8);
  render('look', 9);
  Object.defineProperty(image(), 'decode', { value: () => Promise.reject(new Error('invalid look')) });
  await load();
  expect(done).toHaveBeenLastCalledWith(9);
  expect(done).toHaveBeenCalledTimes(2);
});
it('discards a look hidden before decoding instead of replaying it on return', () => {
  render('look', 10);
  render('look', 10, false, true);
  expect(image()).toBeNull();
  expect(done).toHaveBeenCalledExactlyOnceWith(10);
});
it('discards a background look before decoding and removes its image request', () => {
  render('look', 11);
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  try {
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(image()).toBeNull();
    expect(done).toHaveBeenCalledExactlyOnceWith(11);
  } finally { hidden.mockRestore(); }
});
