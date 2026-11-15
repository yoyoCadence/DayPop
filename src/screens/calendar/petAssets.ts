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
import { COLLECTION_ASSETS } from './petCollection';
import { DIRECTION_ASSETS } from './petDirections';

import type { PetKind } from '../../domain/types';
export type { PetKind } from '../../domain/types';
export type PetPose = 'idle' | 'look' | 'grab' | 'walk' | 'sit' | 'sleep' | 'jump';
export interface PetAsset { still: string; animation?: string; durationMs?: number }
export const PET_ASSETS: Record<PetKind, Partial<Record<PetPose, PetAsset>>> = {
  ...COLLECTION_ASSETS,
  ...DIRECTION_ASSETS,
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

/** Every partner image is drawn on a square canvas of this many pixels. */
export const PET_ART_SIZE = 120;

/**
 * How far the visible part of each partner's idle still (alpha > 24) sits
 * from the top and right edges of its 120×120 canvas. The to-do badge hangs
 * off the character's own top-right corner, not the canvas's: the honey bear
 * leaves about a third of the canvas transparent on the right, so at 84px a
 * corner badge floated well clear of it (DP-251). petArtInset.test.ts measures
 * the real PNGs; a new or redrawn partner has to update this table.
 */
export const PET_ART_INSET: Record<PetKind, { top: number; right: number }> = {
  moon_cat: { top: 14, right: 22 },
  orbit_ufo: { top: 28, right: 13 },
  marshmallow_cat: { top: 29, right: 29 },
  honey_bear: { top: 34, right: 36 },
  peach_bunny: { top: 20, right: 41 },
  red_panda: { top: 30, right: 20 },
  mecha_spirit: { top: 26, right: 23 },
  pixel_cat: { top: 15, right: 12 },
  manga_cat: { top: 28, right: 20 },
};

/**
 * Badge position inside a pet box of `size` pixels. Same overhang as the
 * original CSS character (-3px top, -4px right), measured from the art.
 */
export function petBadgeOffset(kind: PetKind, size: number): { top: number; right: number } {
  const scale = size / PET_ART_SIZE;
  const inset = PET_ART_INSET[kind];
  return { top: Math.round(inset.top * scale) - 3, right: Math.round(inset.right * scale) - 4 };
}
