import { getAppStorage } from '../../storage/browserStorage';
import type { StorageLike } from '../../storage/versionedStorage';

/** Device UI state, deliberately independent of guest/account schema v4. */
export const PET_PLACEMENT_KEY = 'daypop.pet-placement';
export interface PetPlacement { x: number; y: number; collapsed: boolean }
export interface PetPoint { x: number; y: number }
export interface PetArea {
  width: number;
  height: number;
  top: number;
  obstacle?: { left: number; top: number; right: number; bottom: number };
}
const clamp = (value: number, max: number, min = 0) => Math.min(max, Math.max(min, value));

export function loadPetPlacement(storage: StorageLike = getAppStorage()): PetPlacement | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(PET_PLACEMENT_KEY) ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const { version, x, y, collapsed } = value as Record<string, unknown>;
    if (version !== 1 || typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1 ||
      typeof y !== 'number' || !Number.isFinite(y) || y < 0 || y > 1 || typeof collapsed !== 'boolean') return null;
    return { x, y, collapsed };
  } catch { return null; }
}

export function savePetPlacement(value: PetPlacement, storage: StorageLike = getAppStorage()): void {
  storage.setItem(PET_PLACEMENT_KEY, JSON.stringify({ version: 1, ...value }));
}

/** Clamp to the safe content rectangle; leave 8px for the badge/shadow and FAB gap. */
export function constrainPet(point: PetPoint, area: PetArea, size: number): PetPoint | null {
  const maxX = area.width - size;
  const maxY = area.height - size;
  if (maxX < 0 || maxY < area.top) return null;
  const result = { x: clamp(point.x, maxX), y: clamp(point.y, maxY, area.top) };
  const obstacle = area.obstacle;
  if (!obstacle) return result;
  const clear = (p: PetPoint) => p.x + size + 8 <= obstacle.left || p.x - 8 >= obstacle.right ||
    p.y + size + 8 <= obstacle.top || p.y - 8 >= obstacle.bottom;
  if (clear(result)) return result;
  // Nearest valid side, with vertical escape first so a docked pet stays docked.
  const candidates = [
    { x: result.x, y: obstacle.top - size - 8 },
    { x: result.x, y: obstacle.bottom + 8 },
    { x: obstacle.left - size - 8, y: result.y },
    { x: obstacle.right + 8, y: result.y },
  ].filter(p => p.x >= 0 && p.x <= maxX && p.y >= area.top && p.y <= maxY && clear(p));
  candidates.sort((a, b) => Math.hypot(a.x - result.x, a.y - result.y) - Math.hypot(b.x - result.x, b.y - result.y));
  return candidates[0] ?? null;
}

export function placePet(saved: PetPlacement | null, area: PetArea, size: number): PetPoint | null {
  const x = saved ? (saved.collapsed ? (saved.x > .5 ? 1 : 0) : saved.x) * (area.width - size) : 14;
  const y = saved ? area.top + saved.y * (area.height - size - area.top) : area.height - size;
  return constrainPet({ x, y }, area, size);
}

/** Snap only on commit. Resizes/projected obstacle avoidance never rewrite saved ratios. */
export function rememberPet(point: PetPoint, area: PetArea, snap = true): PetPlacement {
  const maxX = area.width - 60;
  const snapped = !snap ? point.x : point.x <= 24 ? 0 : maxX - point.x <= 24 ? maxX : point.x;
  const safe = constrainPet({ x: snapped, y: point.y }, area, 60) ?? point;
  return { x: maxX > 0 ? clamp(safe.x / maxX, 1) : 0,
    y: area.height - 60 > area.top ? clamp((safe.y - area.top) / (area.height - 60 - area.top), 1) : 0,
    collapsed: false };
}
