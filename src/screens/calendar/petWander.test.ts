import { describe, expect, it } from 'vitest';
import type { PetArea } from './petPlacement';
import {
  WANDER_MAX_DISTANCE,
  WANDER_MAX_LEG_MS,
  WANDER_MIN_DISTANCE,
  WANDER_MIN_LEG_MS,
  delayBetween,
  planWanderOffset,
  wanderLegMs,
  wanderPathClear,
} from './petWander';

// A 390px phone: content 366 wide, header ends at 120, FAB bottom-right.
const area: PetArea = { width: 366, height: 640, top: 120, obstacle: { left: 290, right: 346, top: 560, bottom: 616 } };
const fixed = (...values: number[]) => () => values.shift() ?? 0;

describe('DP-240 excursion planning', () => {
  it('walks right from the default resting place when the draw prefers right, within the distance range', () => {
    const offset = planWanderOffset({ x: 14, y: 400 }, area, fixed(0.1, 0.5))!;
    expect(offset).toBeGreaterThanOrEqual(WANDER_MIN_DISTANCE);
    expect(offset).toBeLessThanOrEqual(WANDER_MAX_DISTANCE);
    expect(wanderPathClear(14, 14 + offset, 400, area)).toBe(true);
  });

  it('turns to the other side when the preferred side has no room', () => {
    // Docked at the left edge, preferring left: only rightward walks fit.
    const offset = planWanderOffset({ x: 0, y: 400 }, area, fixed(0.9, 0.5))!;
    expect(offset).toBeGreaterThan(0);
  });

  it('never walks into the FAB or its 8px gap on the bottom row', () => {
    // Bottom row at the FAB height: walking right from x=150 would reach it.
    const home = { x: 150, y: 540 };
    for (const draw of [0, 0.25, 0.5, 0.75, 0.99]) {
      const offset = planWanderOffset(home, area, fixed(0.1, draw));
      if (offset === null) continue;
      for (let x = home.x; offset > 0 ? x <= home.x + offset : x >= home.x + offset; x += Math.sign(offset)) {
        expect(x + 60 + 8 <= 290 || home.y + 60 + 8 <= 560).toBe(true);
      }
    }
    expect(wanderPathClear(150, 280, 540, area)).toBe(false);
  });

  it('stays inside the content width and below the header', () => {
    expect(wanderPathClear(300, 320, 400, area)).toBe(false); // 320 + 60 > 366
    expect(wanderPathClear(100, 140, 100, area)).toBe(false); // above the header
    expect(wanderPathClear(100, 140, 400, area)).toBe(true);
  });

  it('returns null when the row is too narrow to walk the minimum distance either way', () => {
    const narrow: PetArea = { width: 90, height: 640, top: 120 };
    expect(planWanderOffset({ x: 15, y: 400 }, narrow, fixed(0.1, 0.5))).toBeNull();
  });

  it('clamps one leg between the minimum and maximum duration', () => {
    expect(wanderLegMs(10)).toBe(WANDER_MIN_LEG_MS);
    expect(wanderLegMs(-90)).toBe(2_500);
    expect(wanderLegMs(10_000)).toBe(WANDER_MAX_LEG_MS);
  });

  it('draws delays inside the configured range', () => {
    expect(delayBetween([30_000, 60_000], () => 0)).toBe(30_000);
    expect(delayBetween([30_000, 60_000], () => 0.999_999)).toBe(60_000);
  });
});
