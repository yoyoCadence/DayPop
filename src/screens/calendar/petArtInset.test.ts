// DP-251: the badge position table must match the actual partner artwork.
// Decodes each idle still (8-bit RGBA, non-interlaced, as every partner PNG is)
// with node:zlib and measures its visible bounds the same way the table was made.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { NEW_PET_KINDS, PET_KINDS, type PetKind } from '../../domain/types';
import { PET_ART_INSET, PET_ART_SIZE, PET_ASSETS, petBadgeOffset } from './petAssets';
import { PET_SIZE } from './petPlacement';

const IDLE_FILES: Record<PetKind, string> = {
  moon_cat: 'src/assets/pets/moon-cat-idle.png',
  orbit_ufo: 'src/assets/pets/orbit-ufo-idle.png',
  marshmallow_cat: 'src/assets/pet-collection/marshmallow-cat-idle.png',
  honey_bear: 'src/assets/pet-collection/honey-bear-idle.png',
  peach_bunny: 'src/assets/pet-collection/peach-bunny-idle.png',
  ...Object.fromEntries(NEW_PET_KINDS.map(key => [key, `src/assets/pet-directions/${key.replaceAll('_', '-')}-idle.png`])) as
    Record<typeof NEW_PET_KINDS[number], string>,
};

const ALPHA_THRESHOLD = 24;

function decodeRgba(path: string): { width: number; height: number; pixels: Uint8Array } {
  const file = readFileSync(path);
  let offset = 8;
  let width = 0;
  let height = 0;
  const data: Buffer[] = [];
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('latin1', offset + 4, offset + 8);
    const body = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error(`${path}: expected 8-bit RGBA, not interlaced`);
    } else if (type === 'IDAT') {
      data.push(body);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * 4;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = (x >= 4 ? pixels[y * stride + x - 4] : 0) ?? 0;
      const up = (y > 0 ? pixels[(y - 1) * stride + x] : 0) ?? 0;
      const upLeft = (x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4] : 0) ?? 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) throw new Error(`${path}: unknown filter ${filter}`);
      pixels[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  return { width, height, pixels };
}

function visibleInset(path: string): { top: number; right: number } {
  const { width, height, pixels } = decodeRgba(path);
  let top = height;
  let right = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((pixels[(y * width + x) * 4 + 3] ?? 0) <= ALPHA_THRESHOLD) continue;
      top = Math.min(top, y);
      right = Math.max(right, x);
    }
  }
  return { top, right: width - 1 - right };
}

describe('partner badge position (DP-251)', () => {
  it.each(PET_KINDS)('%s: the table matches the visible edge of the real idle still', (kind) => {
    expect(PET_ASSETS[kind].idle?.still).toContain(IDLE_FILES[kind].split('/').pop());
    const { width, height } = decodeRgba(IDLE_FILES[kind]);
    expect([width, height]).toEqual([PET_ART_SIZE, PET_ART_SIZE]);
    expect(visibleInset(IDLE_FILES[kind])).toEqual(PET_ART_INSET[kind]);
  });

  it('puts the honey bear badge on the bear, not on the empty corner of the box', () => {
    // 34 and 36 transparent pixels at 120px are 24 and 25 at 84px.
    expect(petBadgeOffset('honey_bear', PET_SIZE)).toEqual({ top: 21, right: 21 });
    expect(petBadgeOffset('moon_cat', PET_SIZE)).toEqual({ top: 7, right: 11 });
  });
});
