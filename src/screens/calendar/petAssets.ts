import catIdle from '../../assets/pets/moon-cat-idle.webp';
import catLook from '../../assets/pets/moon-cat-look.webp';
import catStill from '../../assets/pets/moon-cat-idle.png';
import catGrab from '../../assets/pets/moon-cat-grab.png';
import catSleep from '../../assets/pets/moon-cat-sleep.webp';
import catSleepStill from '../../assets/pets/moon-cat-sleep.png';
import catJump from '../../assets/pets/moon-cat-jump.webp';
import ufoIdle from '../../assets/pets/orbit-ufo-idle.webp';
import ufoLook from '../../assets/pets/orbit-ufo-look.webp';
import ufoStill from '../../assets/pets/orbit-ufo-idle.png';
import ufoGrab from '../../assets/pets/orbit-ufo-grab.png';
import ufoSleep from '../../assets/pets/orbit-ufo-sleep.webp';
import ufoSleepStill from '../../assets/pets/orbit-ufo-sleep.png';
import ufoJump from '../../assets/pets/orbit-ufo-jump.webp';

// Internal asset keys only. Choosing a partner is DP-172, not a second preference store.
export type PetKind = 'moon_cat' | 'orbit_ufo';
export type PetPose = 'idle' | 'look' | 'grab' | 'walk' | 'sit' | 'sleep' | 'jump';
interface PetAsset { still: string; animation?: string; durationMs?: number }
export const PET_ASSETS: Record<PetKind, Partial<Record<PetPose, PetAsset>>> = {
  moon_cat: {
    idle: { still: catStill, animation: catIdle },
    look: { still: catStill, animation: catLook, durationMs: 1600 },
    grab: { still: catGrab },
    sleep: { still: catSleepStill, animation: catSleep },
    jump: { still: catStill, animation: catJump, durationMs: 1000 },
  },
  orbit_ufo: {
    idle: { still: ufoStill, animation: ufoIdle },
    look: { still: ufoStill, animation: ufoLook, durationMs: 1600 },
    grab: { still: ufoGrab },
    sleep: { still: ufoSleepStill, animation: ufoSleep },
    jump: { still: ufoStill, animation: ufoJump, durationMs: 1000 },
  },
};
