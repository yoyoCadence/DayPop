import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PetArtwork } from './PetArtwork';
import { forgetDecodedPetArtwork } from './petArtworkMemory';
import { PET_ASSETS, type PetKind, type PetPose } from './petAssets';

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
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); forgetDecodedPetArtwork(); });
function render(pose: PetPose = 'idle', cue: number | null = null, paused = false, hidden = false) {
  act(() => root.render(<PetArtwork pose={pose} cue={cue} paused={paused} hidden={hidden} onCueDone={done} />));
}
const image = () => host.querySelector<HTMLImageElement>('img')!;
async function load() { await act(async () => image().dispatchEvent(new Event('load'))); }
it.each(['marshmallow_cat', 'honey_bear', 'peach_bunny'] as const)('%s has seven native poses and a static reduced-motion walking alternative', async kind => {
  expect(Object.keys(PET_ASSETS[kind]).sort()).toEqual(['grab', 'idle', 'jump', 'look', 'sit', 'sleep', 'walk']);
  act(() => root.render(<PetArtwork kind={kind} pose="walk" paused={false} cue={null} onCueDone={done} />));
  expect(image().getAttribute('src')).toMatch(/walk.*webp/);
  await load();
  expect(image().hidden).toBe(false);
  act(() => { media.matches = true; media.dispatchEvent(new Event('change')); });
  expect(image().getAttribute('src')).toMatch(/idle.*png/);
  expect(done).not.toHaveBeenCalled();
});
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
it('ends a jump once, one second after decode, and discards an invisible undecoded jump', async () => {
  vi.useFakeTimers();
  render('jump', 71);
  act(() => vi.advanceTimersByTime(5000));
  expect(done).not.toHaveBeenCalled();
  await load();
  act(() => vi.advanceTimersByTime(999));
  expect(done).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(done).toHaveBeenCalledExactlyOnceWith(71);
  done.mockClear();
  render('jump', 72);
  render('jump', 72, false, true);
  expect(done).toHaveBeenCalledExactlyOnceWith(72);
  expect(image()).toBeNull();
});
for (const kind of ['moon_cat', 'orbit_ufo'] as const) {
  it(`${kind} jump decodes, shares idle PNG, removes hidden images and falls back on failure`, async () => {
    const jump = (paused = false, hidden = false) => act(() => root.render(
      <PetArtwork kind={kind} pose="jump" cue={null} paused={paused} hidden={hidden} onCueDone={done} />,
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
      <PetArtwork kind={kind} pose="sleep" cue={null} paused={paused} hidden={hidden} onCueDone={done} />,
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
it.each(['look', 'jump'] as const)('does not let an earlier %s or an unmounted clock complete a later cue', async pose => {
  vi.useFakeTimers();
  const half = pose === 'look' ? 800 : 500;
  render(pose, 1); await load();
  act(() => vi.advanceTimersByTime(half));
  render(pose, 2); await load();
  act(() => vi.advanceTimersByTime(half));
  expect(done).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(half));
  expect(done).toHaveBeenCalledExactlyOnceWith(2);
  render(pose, 3); await load();
  act(() => root.render(null));
  act(() => vi.advanceTimersByTime(5000));
  expect(done).toHaveBeenCalledTimes(1);
});
it.each(['look', 'jump'] as const)('finishes a reduced-motion %s as a still cue instead of keeping a deferred animation', async pose => {
  vi.useFakeTimers(); media.matches = true;
  render(pose, 7); await load();
  expect(image().getAttribute('src')).toMatch(/idle.*png/);
  act(() => vi.advanceTimersByTime(pose === 'look' ? 1600 : 1000));
  expect(done).toHaveBeenCalledExactlyOnceWith(7);
});
it('falls back after a network error without removing the surrounding button or adding a message', () => {
  render();
  act(() => image().dispatchEvent(new Event('error')));
  expect(image()).toBeNull();
  expect(host.querySelector('.cal-pet-body')).not.toBeNull();
  expect(host.textContent).toBe('');
});
it.each(['look', 'jump'] as const)('completes a failed %s so a healthy idle asset can resume', async pose => {
  render(pose, 8);
  act(() => image().dispatchEvent(new Event('error')));
  expect(done).toHaveBeenCalledExactlyOnceWith(8);
  render(pose, 9);
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
it.each(['look', 'jump'] as const)('discards a background %s before decoding and removes its image request', pose => {
  render(pose, 11);
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  try {
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(image()).toBeNull();
    expect(done).toHaveBeenCalledExactlyOnceWith(11);
  } finally { hidden.mockRestore(); }
});

// DP-248: every pose change mounts a new image (idle even swaps component), so
// the character must not flash the CSS fallback while the next pose decodes.
const previous = () => host.querySelector<HTMLElement>('.cal-pet-previous');
function mount(key: string, props: { kind?: PetKind; pose: PetPose; cue?: number | null; paused?: boolean }) {
  act(() => root.render(<PetArtwork key={key} kind={props.kind} pose={props.pose} cue={props.cue ?? null}
    paused={props.paused ?? false} onCueDone={done} />));
}
it('holds the last decoded image, not the CSS pet, while a remounted pose decodes', async () => {
  mount('a', { pose: 'idle' });
  expect(host.querySelector('.cal-pet-body')).not.toBeNull();
  expect(previous()).toBeNull();
  const idle = image().getAttribute('src')!;
  await load();
  mount('b', { pose: 'look', cue: 1 });
  expect(host.querySelector('.cal-pet-body')).toBeNull();
  expect(previous()?.style.backgroundImage).toBe(`url("${idle}")`);
  expect(host.querySelectorAll('img')).toHaveLength(1);
  expect(image().hidden).toBe(true);
  expect(image().getAttribute('src')).toMatch(/look.*webp/);
  await load();
  expect(previous()).toBeNull();
  expect(image().hidden).toBe(false);
  // The next one holds the look it just decoded.
  mount('c', { pose: 'grab' });
  expect(previous()?.style.backgroundImage).toMatch(/look.*webp/);
  expect(host.querySelector('.cal-pet-body')).toBeNull();
});
it('never shows another partner while a newly chosen one decodes', async () => {
  mount('a', { kind: 'moon_cat', pose: 'idle' });
  await load();
  mount('b', { kind: 'orbit_ufo', pose: 'idle' });
  expect(previous()).toBeNull();
  expect(host.querySelector('.cal-pet-body')).not.toBeNull();
});
it('falls back to CSS, without the held image, when the next pose fails', async () => {
  mount('a', { pose: 'idle' });
  await load();
  mount('b', { pose: 'sleep' });
  expect(previous()).not.toBeNull();
  act(() => image().dispatchEvent(new Event('error')));
  expect(previous()).toBeNull();
  expect(image()).toBeNull();
  expect(host.querySelector('.cal-pet-body')).not.toBeNull();
  // A failed decode is never remembered as something to hold.
  mount('c', { pose: 'sleep' });
  Object.defineProperty(image(), 'decode', { value: () => Promise.reject(new Error('invalid')) });
  await load();
  mount('d', { pose: 'grab' });
  expect(previous()?.style.backgroundImage).toMatch(/idle.*webp/);
});
