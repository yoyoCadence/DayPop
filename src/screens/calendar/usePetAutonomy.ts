import { useEffect, useEffectEvent, useState, useSyncExternalStore, type RefObject } from 'react';
import type { PetArea, PetPoint } from './petPlacement';
import { planPetWalk } from './petWalk';
import type { PetPose } from './petAssets';

const motionQuery = '(prefers-reduced-motion: reduce)';
function subscribeEnvironment(change: () => void) {
  const media = window.matchMedia?.(motionQuery);
  media?.addEventListener('change', change);
  document.addEventListener('visibilitychange', change);
  return () => { media?.removeEventListener('change', change); document.removeEventListener('visibilitychange', change); };
}

interface AutonomyOptions {
  enabled: boolean;
  blocked: boolean;
  area: PetArea | null;
  control: RefObject<HTMLButtonElement | null>;
  currentPosition(): PetPoint | null;
  paint(point: PetPoint): void;
  settle(): void;
}

/** One foreground lifecycle, no storage writes and no React render per frame. */
export function usePetAutonomy({ enabled, blocked, area, control, currentPosition, paint, settle }: AutonomyOptions) {
  const quiet = useSyncExternalStore(subscribeEnvironment, () => document.hidden || (window.matchMedia?.(motionQuery).matches ?? false));
  const [pose, setPose] = useState<PetPose>('idle');
  const [facing, setFacing] = useState<'left' | 'right'>('right');
  const eligible = enabled && !blocked && !quiet && area !== null;
  const readPosition = useEffectEvent(currentPosition);
  const paintFrame = useEffectEvent(paint);
  const settlePosition = useEffectEvent(settle);

  useEffect(() => {
    const element = control.current;
    if (!eligible || !area || !element) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame: number | undefined;
    const heldPointers = new Set<number>();
    let near = element.matches(':hover');
    const attentive = () => near || element.contains(document.activeElement);
    let lastInput = performance.now();
    queueMicrotask(() => { if (active) setPose('idle'); });
    function clear() { clearTimeout(timer); if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined; }
    function rest(delay = 8000 + Math.random() * 4000) {
      timer = setTimeout(stroll, Math.max(0, Math.min(delay, 120_000 - (performance.now() - lastInput))));
    }
    function stroll() {
      if (!active || control.current !== element) return;
      if (attentive()) { setPose('idle'); return; }
      if (performance.now() - lastInput >= 120_000) { setPose('sleep'); return; }
      const from = readPosition();
      const walk = from && planPetWalk(from, area!);
      if (!from || !walk) { setPose('sit'); rest(); return; }
      setPose('walk'); setFacing(walk.to.x < from.x ? 'left' : 'right');
      const started = performance.now();
      function advance(now: number) {
        if (!active || control.current !== element) return;
        const progress = Math.min(1, Math.max(0, (now - started) / walk!.duration));
        paintFrame({ x: from!.x + (walk!.to.x - from!.x) * progress, y: from!.y + (walk!.to.y - from!.y) * progress });
        if (now - lastInput >= 120_000) { frame = undefined; settlePosition(); setPose('sleep'); return; }
        if (progress < 1) frame = requestAnimationFrame(advance);
        else {
          frame = undefined; settlePosition();
          setPose(Math.random() < 0.4 ? 'sit' : 'idle'); rest();
        }
      }
      frame = requestAnimationFrame(advance);
    }
    function input(event: Event) {
      lastInput = performance.now(); clear(); settlePosition(); setPose('idle');
      if (event.type === 'pointerdown') heldPointers.add((event as PointerEvent).pointerId ?? 0);
      if (heldPointers.size === 0 && !attentive()) rest();
    }
    function release(event: Event) {
      if (!heldPointers.delete((event as PointerEvent).pointerId ?? 0)) return;
      lastInput = performance.now(); clear();
      if (heldPointers.size === 0 && !attentive()) rest();
    }
    const enter = () => { near = true; input(new Event('attention')); };
    const leave = () => { near = false; input(new Event('attention')); };
    const focusChanged = () => queueMicrotask(() => { if (active) input(new Event('attention')); });
    // Capture freezes the real point before React's drag/click handlers run.
    const inputs = ['pointerdown', 'keydown', 'wheel'] as const;
    for (const name of inputs) document.addEventListener(name, input, { capture: true, passive: true });
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('focus', focusChanged);
    element.addEventListener('blur', focusChanged);
    if (!attentive()) rest();
    return () => {
      active = false; clear(); settlePosition();
      for (const name of inputs) document.removeEventListener(name, input, true);
      document.removeEventListener('pointerup', release, true);
      document.removeEventListener('pointercancel', release, true);
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('focus', focusChanged);
      element.removeEventListener('blur', focusChanged);
    };
  }, [eligible, area, control]);

  return { pose: eligible ? pose : 'idle' as PetPose, facing };
}
