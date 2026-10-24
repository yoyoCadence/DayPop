import { useEffect, useState, useSyncExternalStore } from 'react';
import { PetArtwork } from './PetArtwork';
import type { PetKind } from './petAssets';

const ignoreLook = () => {};
function subscribeVisibility(change: () => void) {
  document.addEventListener('visibilitychange', change);
  return () => document.removeEventListener('visibilitychange', change);
}

/** Only an eligible foreground idle owns a clock; all interruptions unmount it. */
export function IdlePetArtwork({ kind, paused, hidden }: { kind?: PetKind; paused: boolean; hidden: boolean }) {
  const background = useSyncExternalStore(subscribeVisibility, () => document.hidden);
  return paused || hidden || background
    ? <PetArtwork kind={kind} pose="idle" paused={paused} hidden={hidden} cue={null} onLookDone={ignoreLook} />
    : <RestingPet kind={kind} />;
}

function RestingPet({ kind }: { kind?: PetKind }) {
  const [sleeping, setSleeping] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function arm() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (active && !document.hidden) setSleeping(true);
      }, 120_000);
    }
    function wake() {
      if (!document.hidden) { setSleeping(false); arm(); }
    }
    const inputs = ['pointerdown', 'keydown', 'wheel'] as const;
    arm();
    for (const name of inputs) document.addEventListener(name, wake, { capture: true, passive: true });
    return () => {
      active = false;
      clearTimeout(timer);
      for (const name of inputs) document.removeEventListener(name, wake, true);
    };
  }, []);
  return <PetArtwork kind={kind} pose={sleeping ? 'sleep' : 'idle'} paused={false} cue={null} onLookDone={ignoreLook} />;
}
