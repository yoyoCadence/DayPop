import { describe, expect, it } from 'vitest';
import { planPetWalk } from './petWalk';
import { constrainPet, type PetArea } from './petPlacement';

const area: PetArea = { width: 390, height: 620, top: 180, obstacle: { left: 310, top: 540, right: 370, bottom: 600 } };
describe('safe pet strolls', () => {
  it('plans a bounded stroll with a natural speed', () => {
    expect(planPetWalk({ x: 14, y: 550 }, area, () => 0)).toEqual({ to: { x: 50, y: 550 }, duration: 1636 });
  });
  it('rejects an unavailable or unsafe starting area', () => {
    expect(planPetWalk({ x: 14, y: 550 }, { ...area, width: 50 }, () => 0)).toBeNull();
    expect(planPetWalk({ x: 14, y: 170 }, area, () => 0)).toBeNull();
    expect(planPetWalk({ x: 310, y: 550 }, area, () => 0)).toBeNull();
  });
  it('never crosses the FAB even when both endpoints are individually safe', () => {
    const narrow: PetArea = { width: 260, height: 300, top: 10, obstacle: { left: 100, right: 120, top: 120, bottom: 200 } };
    const from = { x: 20, y: 120 };
    expect(constrainPet(from, narrow, 60)).toEqual(from);
    expect(constrainPet({ x: 79.4, y: 96.24 }, narrow, 60)).toEqual({ x: 79.4, y: 52 });
    let sample = 0;
    expect(planPetWalk(from, narrow, () => sample++ % 2 === 0 ? 0.875 : 1)).toBeNull();
  });
  it('returns no path instead of looping indefinitely when there is no useful space', () => {
    let attempts = 0;
    expect(planPetWalk({ x: 0, y: 0 }, { width: 70, height: 70, top: 0 }, () => { attempts++; return 0; })).toBeNull();
    expect(attempts).toBe(16);
  });
  it('keeps every interpolated footprint safe over varied sizes, starts and headings', () => {
    let planned = 0;
    for (const width of [320, 390, 1280]) for (const heading of [0, 0.125, 0.25, 0.375, 0.5, 0.75, 0.875]) {
      const bounds = { ...area, width };
      for (const from of [{ x: 14, y: 550 }, { x: 160, y: 350 }, { x: 200, y: 210 }]) {
        let n = 0;
        const walk = planPetWalk(from, bounds, () => n++ % 2 === 0 ? heading : 0.8);
        if (!walk) continue;
        planned++;
        for (let step = 0; step <= 100; step++) {
          const point = { x: from.x + (walk.to.x - from.x) * step / 100, y: from.y + (walk.to.y - from.y) * step / 100 };
          expect(constrainPet(point, bounds, 60)).toEqual(point);
        }
      }
    }
    expect(planned).toBeGreaterThan(35);
  });
});
