import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkPetAssets } from './pet-assets-budget.mjs';

const limits = { maxCharacterBytes: 80, maxIdleBytes: 30, maxLookBytes: 20, maxStaticBytes: 15 };
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'daypop-pet-budget-'));
  const source = join(root, 'source'); const built = join(root, 'assets');
  await mkdir(source); await mkdir(built);
  const files = [];
  try {
    for (const kind of ['moon-cat', 'orbit-ufo']) {
      for (const [pose, ext, size] of [['idle','webp',30],['look','webp',20],['idle','png',15],['grab','png',15]]) {
        const file = `${kind}-${pose}.${ext}`;
        const bytes = Buffer.alloc(size, files.length + 1);
        await writeFile(join(source, file), bytes);
        const output = join(built, `${kind}-${pose}-contentHash.${ext}`);
        await writeFile(output, bytes); files.push(output);
      }
    }
    await run({ source, files });
  } finally { await rm(root, { recursive: true, force: true }); }
}
test('unique static assets count once and exact per-file/character boundaries pass', () => fixture(async ({ source, files }) => {
  const result = await checkPetAssets(source, files, limits);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.totals, { 'moon-cat': 80, 'orbit-ufo': 80 });
}));
for (const limit of Object.keys(limits)) {
  test(`rejects an exceeded ${limit} even if other limits pass`, () => fixture(async ({ source, files }) => {
    const result = await checkPetAssets(source, files, { ...limits, [limit]: limits[limit] - 1 });
    assert(result.problems.some(problem => problem.includes(limit)));
  }));
}
test('invalid or missing limits cannot disable the gate', () => fixture(async ({ source, files }) => {
  for (const invalid of [undefined, null, {}, { ...limits, maxStaticBytes: NaN }]) {
    assert((await checkPetAssets(source, files, invalid)).problems.length > 0);
  }
}));
test('missing, unhashed, duplicated or different build bytes fail closed', () => fixture(async ({ source, files }) => {
  assert((await checkPetAssets(source, files.slice(1), limits)).problems.length > 0);
  assert((await checkPetAssets(source, [join(source, 'moon-cat-idle.webp'), ...files.slice(1)], limits)).problems.length > 0);
  assert((await checkPetAssets(source, [...files, files[0]], limits)).problems.length > 0);
  await writeFile(files[0], 'different');
  assert((await checkPetAssets(source, files, limits)).problems.length > 0);
}));
