import { constrainPet, type PetArea, type PetPoint } from './petPlacement';

/**
 * DP-240: a short foreground excursion along the pet's own row.
 *
 * The pet walks out, sits for a moment and walks back to the position the user
 * saved. Nothing here writes placement: the excursion is a transient offset on
 * top of `placePet()`, and every interruption snaps it back to zero.
 */

/** Walking speed in content pixels per second; slow enough to read as a stroll. */
export const WANDER_SPEED = 36;
/** One leg never takes less than this, so a short hop still looks like walking. */
export const WANDER_MIN_LEG_MS = 1_200;
export const WANDER_MAX_LEG_MS = 5_000;
export const WANDER_SIT_MS = 5_000;
/** How far one excursion goes from the saved position. */
export const WANDER_MIN_DISTANCE = 40;
export const WANDER_MAX_DISTANCE = 140;
/** Quiet time before the first excursion, then between excursions. */
export const WANDER_FIRST_DELAY_MS: readonly [number, number] = [30_000, 60_000];
export const WANDER_NEXT_DELAY_MS: readonly [number, number] = [45_000, 90_000];
/**
 * At most this many excursions per stretch without user input. The pet then
 * stays put, so the foreground idle → sleep behaviour (DP-193) still happens
 * on a quiet screen and the pet never paces endlessly.
 */
export const WANDER_MAX_PER_QUIET = 2;

const PET_SIZE = 60;
const PATH_STEP = 4;

export function delayBetween([min, max]: readonly [number, number], random: () => number): number {
  return Math.round(min + (max - min) * random());
}

/** Time for one leg of `distance` pixels at the walking speed, clamped. */
export function wanderLegMs(distance: number): number {
  const ms = (Math.abs(distance) / WANDER_SPEED) * 1_000;
  return Math.round(Math.min(WANDER_MAX_LEG_MS, Math.max(WANDER_MIN_LEG_MS, ms)));
}

/**
 * Whether every point between `fromX` and `toX` on row `y` is a position the
 * pet could legally rest on. `constrainPet()` returns the point unchanged only
 * when it is inside the safe area and clear of the FAB, so this keeps the walk
 * out of the header, the tab bar, the safe area and the FAB's 8px gap.
 */
export function wanderPathClear(fromX: number, toX: number, y: number, area: PetArea): boolean {
  const steps = Math.max(1, Math.ceil(Math.abs(toX - fromX) / PATH_STEP));
  for (let index = 0; index <= steps; index += 1) {
    const x = fromX + ((toX - fromX) * index) / steps;
    const allowed = constrainPet({ x, y }, area, PET_SIZE);
    if (!allowed || Math.abs(allowed.x - x) > 0.5 || Math.abs(allowed.y - y) > 0.5) return false;
  }
  return true;
}

/**
 * Pick the horizontal offset for one excursion from `home`, or `null` when the
 * row has no room. Prefers the side the random draw picks, then the other.
 */
export function planWanderOffset(home: PetPoint, area: PetArea, random: () => number): number | null {
  const preferRight = random() < 0.5;
  const distance = WANDER_MIN_DISTANCE + (WANDER_MAX_DISTANCE - WANDER_MIN_DISTANCE) * random();
  for (const sign of preferRight ? [1, -1] : [-1, 1]) {
    // Shrink towards the minimum distance until the whole path is clear.
    for (let reach = distance; reach >= WANDER_MIN_DISTANCE; reach -= 10) {
      const offset = Math.round(sign * reach);
      if (wanderPathClear(home.x, home.x + offset, home.y, area)) return offset;
    }
  }
  return null;
}
