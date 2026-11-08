import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';
import type { PetArea, PetPoint } from './petPlacement';
import {
  WANDER_FIRST_DELAY_MS,
  WANDER_MAX_PER_QUIET,
  WANDER_NEXT_DELAY_MS,
  WANDER_SIT_MS,
  delayBetween,
  planWanderOffset,
  wanderLegMs,
} from './petWander';

export type WanderPhase = 'rest' | 'out' | 'sit' | 'back';
export interface WanderState {
  phase: WanderPhase;
  /** Horizontal offset from the saved position, in content pixels. */
  offset: number;
  /** Duration of the current walking leg; 0 when not walking. */
  legMs: number;
}

const REST: WanderState = { phase: 'rest', offset: 0, legMs: 0 };
const motionQuery = '(prefers-reduced-motion: reduce)';
const INPUTS = ['pointerdown', 'keydown', 'wheel'] as const;

function subscribeMotion(change: () => void) {
  const media = window.matchMedia?.(motionQuery);
  media?.addEventListener('change', change);
  return () => media?.removeEventListener('change', change);
}
function subscribeVisibility(change: () => void) {
  document.addEventListener('visibilitychange', change);
  return () => document.removeEventListener('visibilitychange', change);
}

/**
 * DP-240 foreground excursions: rest → walk out → sit → walk back → rest.
 *
 * Runs only while `enabled` (the caller's interaction rules), the document is
 * visible and reduced motion is off. Any input anywhere, or losing any of those
 * conditions, ends the excursion at once and returns the offset to 0: the
 * caller renders the saved position again, which is never rewritten here.
 * After `WANDER_MAX_PER_QUIET` excursions without input the pet stays put
 * until the next input.
 *
 * `onInput` runs synchronously for every such input, before the reset is even
 * scheduled: it is the last moment the pet is still drawn where it walked to.
 */
export function usePetWander({ enabled, home, area, onInput, random = Math.random }: {
  enabled: boolean;
  home: PetPoint | null;
  area: PetArea | null;
  onInput?: (event: Event) => void;
  random?: () => number;
}): WanderState {
  const reduce = useSyncExternalStore(subscribeMotion, () => window.matchMedia?.(motionQuery).matches ?? false);
  const background = useSyncExternalStore(subscribeVisibility, () => document.hidden);
  const [state, setState] = useState<WanderState>(REST);
  // Excursions since the last input, and a counter that restarts the schedule.
  const quiet = useRef(0);
  const [inputs, setInputs] = useState(0);
  // Injected only by tests; captured once so a new function identity does not restart anything.
  const randomRef = useRef(random);
  const active = enabled && !reduce && !background && home !== null && area !== null;

  const interrupted = useEffectEvent((event: Event) => onInput?.(event));
  useEffect(() => {
    function input(event: Event) {
      interrupted(event);
      quiet.current = 0;
      setInputs(count => count + 1);
    }
    for (const name of INPUTS) document.addEventListener(name, input, { capture: true, passive: true });
    return () => { for (const name of INPUTS) document.removeEventListener(name, input, true); };
  }, []);

  const homeX = home?.x;
  const homeY = home?.y;
  const width = area?.width;
  const height = area?.height;
  const top = area?.top;
  useEffect(() => {
    if (!active || !home || !area) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const at = (ms: number, step: () => void) => {
      timer = setTimeout(() => { if (!cancelled) step(); }, ms);
    };
    const schedule = () => {
      if (quiet.current >= WANDER_MAX_PER_QUIET) return;
      at(delayBetween(quiet.current === 0 ? WANDER_FIRST_DELAY_MS : WANDER_NEXT_DELAY_MS, randomRef.current), start);
    };
    const start = () => {
      quiet.current += 1;
      const offset = planWanderOffset(home, area, randomRef.current);
      if (offset === null) { schedule(); return; }
      const leg = wanderLegMs(offset);
      setState({ phase: 'out', offset, legMs: leg });
      at(leg, () => {
        setState({ phase: 'sit', offset, legMs: 0 });
        at(WANDER_SIT_MS, () => {
          setState({ phase: 'back', offset: 0, legMs: leg });
          at(leg, () => { setState(REST); schedule(); });
        });
      });
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setState(REST);
    };
    // `home`/`area` are compared by value; a resize or new saved position
    // restarts the schedule from the saved position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, homeX, homeY, width, height, top, inputs]);

  return active ? state : REST;
}
