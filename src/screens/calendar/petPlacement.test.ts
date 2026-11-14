import { describe, expect, it, vi } from 'vitest';
import { AppStorage, MemoryStorage } from '../../storage/browserStorage';
import { loadPetPlacement, savePetPlacement, PET_PLACEMENT_KEY, PET_SIZE, placePet, rememberPet, type PetArea } from './petPlacement';

const area: PetArea = { width: 366, height: 600, top: 160, obstacle: { left: 296, top: 530, right: 352, bottom: 586 } };
describe('device pet placement', () => {
  it('preserves the default resting position and keeps a free position until within 24px of an edge', () => {
    expect(placePet(null, area, 60)).toEqual({ x: 14, y: 540 });
    // DP-249: the partner is 84px, so the free range is 366 − 84 = 282 wide
    // and 600 − 84 − 160 = 356 tall.
    expect(PET_SIZE).toBe(84);
    expect(placePet(null, area, PET_SIZE)).toEqual({ x: 14, y: 516 });
    expect(rememberPet({ x: 100, y: 300 }, area)).toEqual({ x: 100 / 282, y: 140 / 356, collapsed: false });
    expect(rememberPet({ x: 24, y: 300 }, area).x).toBe(0);
    expect(rememberPet({ x: 257, y: 300 }, area).x).toBe(257 / 282);
    expect(rememberPet({ x: 258, y: 300 }, area).x).toBe(1);
  });
  it('keeps the whole character, badge and shadow clear of the FAB and bounds', () => {
    const position = placePet({ x: 1, y: 1, collapsed: false }, area, 60)!;
    expect(position.x).toBe(306);
    expect(position.y + 60 + 8).toBeLessThanOrEqual(area.obstacle!.top);
    expect(placePet({ x: 1, y: 0, collapsed: false }, area, 60)).toEqual({ x: 306, y: 160 });
    expect(placePet(null, { ...area, height: 210 }, 60)).toBeNull();
  });
  it('adapts relative placement to resize without changing the saved value, and collapses to a 44px edge tab', () => {
    const saved = { x: .7, y: .4, collapsed: false };
    const before = JSON.stringify(saved);
    expect(placePet(saved, { width: 500, height: 700, top: 100 }, 60)).toEqual({ x: 308, y: 316 });
    expect(placePet({ ...saved, collapsed: true }, { width: 500, height: 700, top: 100 }, 44)).toEqual({ x: 456, y: 322.4 });
    expect(JSON.stringify(saved)).toBe(before);
  });
  it.each(['oops', '{}', '{"version":2,"x":0,"y":0,"collapsed":false}', '{"version":1,"x":-1,"y":0,"collapsed":false}', '{"version":1,"x":0,"y":1.1,"collapsed":false}', '{"version":1,"x":0,"y":0,"collapsed":"false"}'])('ignores invalid UI state without writing over it: %s', raw => {
    const storage = new MemoryStorage();
    storage.setItem(PET_PLACEMENT_KEY, raw);
    expect(loadPetPlacement(storage)).toBeNull();
    expect(storage.getItem(PET_PLACEMENT_KEY)).toBe(raw);
  });
  it('round trips through the shared AppStorage key without touching user data, including quota fallback', () => {
    const disk = new MemoryStorage();
    disk.setItem('daypop.user-data', 'original data');
    const storage = new AppStorage(disk);
    const value = { x: .3, y: .5, collapsed: true };
    savePetPlacement(value, storage);
    expect(loadPetPlacement(storage)).toEqual(value);
    vi.spyOn(disk, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    savePetPlacement({ ...value, collapsed: false }, storage);
    expect(storage.mode.kind).toBe('memory');
    expect(loadPetPlacement(storage)?.collapsed).toBe(false);
    expect(storage.getItem('daypop.user-data')).toBe('original data');
    expect(disk.getItem('daypop.user-data')).toBe('original data');
  });
});
