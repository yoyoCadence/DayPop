import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PET_ASSETS, type PetKind, type PetPose } from './petAssets';

const motionQuery = '(prefers-reduced-motion: reduce)';
function subscribeMotion(change: () => void) {
  const media = window.matchMedia?.(motionQuery);
  media?.addEventListener('change', change);
  return () => media?.removeEventListener('change', change);
}
function subscribeVisibility(change: () => void) {
  document.addEventListener('visibilitychange', change);
  return () => document.removeEventListener('visibilitychange', change);
}

export function PetArtwork({ kind = 'moon_cat', pose, paused, hidden = false, cue, onCueDone }: {
  kind?: PetKind; pose: PetPose; paused: boolean; hidden?: boolean; cue: number | null; onCueDone(cue: number): void;
}) {
  const reduce = useSyncExternalStore(subscribeMotion, () => window.matchMedia?.(motionQuery).matches ?? false);
  const background = useSyncExternalStore(subscribeVisibility, () => document.hidden);
  const stopped = paused || hidden || reduce || background;
  const asset = PET_ASSETS[kind][pose];
  const singlePlay = pose === 'look' || pose === 'jump';
  // An invisible pet needs no image request, including during initial geometry measurement.
  const src = hidden || background ? undefined : stopped ? asset?.still : asset?.animation ?? asset?.still;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A single completion clock belongs to this cue, not to a loading image.
  // Pausing swaps the actual URL; an already-started clock can expire silently.
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, [cue]);
  // Invisible cues are discarded even when their image has not decoded yet.
  useEffect(() => {
    if ((hidden || background) && singlePlay && cue !== null) onCueDone(cue);
  }, [hidden, background, singlePlay, cue, onCueDone]);
  function ready() {
    if (singlePlay && cue !== null && asset?.durationMs && timer.current === null) {
      timer.current = setTimeout(() => onCueDone(cue), asset.durationMs);
    }
  }
  function unavailable() {
    if (singlePlay && cue !== null) onCueDone(cue);
  }
  return <span className="cal-pet-art" aria-hidden="true" data-paused={stopped}>
    {src ? <DecodedArtwork key={`${src}:${cue ?? ''}`} src={src} onReady={ready} onUnavailable={unavailable} /> : <CssPet />}
  </span>;
}

/** Keep the old character visible until a real image decodes; stale loads cannot replace a new pose. */
function DecodedArtwork({ src, onReady, onUnavailable }: { src: string; onReady(): void; onUnavailable(): void }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = useRef(false);
  // A cached image may load/decode before passive effects. Mark this committed
  // instance synchronously so that a valid early load is not discarded forever.
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  function fail() { setFailed(true); onUnavailable(); }
  async function loaded(image: HTMLImageElement) {
    try {
      await image.decode?.();
      if (active.current) { setReady(true); onReady(); }
    } catch { if (active.current) fail(); }
  }
  return <>
    {!ready || failed ? <CssPet /> : null}
    {!failed && <img className="cal-pet-image" src={src} width="60" height="60" alt="" draggable={false}
      hidden={!ready} onLoad={event => { void loaded(event.currentTarget); }} onError={fail} />}
  </>;
}

/** Existing theme-coloured CSS fallback; never a replacement design. */
function CssPet() {
  return <span className="cal-pet-body" aria-hidden="true">
    <span className="cal-pet-shadow" />
    <span className="cal-pet-head">
      <span className="cal-pet-ear left" /><span className="cal-pet-ear right" />
      <span className="cal-pet-eye left" /><span className="cal-pet-eye right" />
      <span className="cal-pet-cheek left" /><span className="cal-pet-cheek right" />
      <span className="cal-pet-mouth" />
    </span>
    <span className="cal-pet-foot left" /><span className="cal-pet-foot right" />
  </span>;
}
