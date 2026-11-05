import { constrainPet, type PetArea, type PetPoint } from './petPlacement';

/** A straight stroll whose whole swept rectangle avoids the FAB, not just its end. */
export function planPetWalk(from: PetPoint, area: PetArea, random: () => number = Math.random): { to: PetPoint; duration: number } | null {
  const start = constrainPet(from, area, 60);
  if (!start || Math.hypot(start.x - from.x, start.y - from.y) > 0.1) return null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const angle = random() * Math.PI * 2;
    const distance = 36 + random() * 48;
    const to = constrainPet({ x: from.x + Math.cos(angle) * distance, y: from.y + Math.sin(angle) * distance * 0.4 }, area, 60);
    if (!to || Math.hypot(to.x - from.x, to.y - from.y) < 24) continue;
    const obstacle = area.obstacle;
    if (obstacle && !(Math.max(from.x, to.x) + 68 <= obstacle.left || Math.min(from.x, to.x) - 8 >= obstacle.right ||
      Math.max(from.y, to.y) + 68 <= obstacle.top || Math.min(from.y, to.y) - 8 >= obstacle.bottom)) continue;
    return { to, duration: Math.max(1200, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / 0.022)) };
  }
  return null;
}
