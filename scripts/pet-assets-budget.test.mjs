import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkPetAssets } from './pet-assets-budget.mjs';

const limits = { maxCharacterBytes: 135, maxIdleBytes: 30, maxLookBytes: 20, maxSleepBytes: 20, maxJumpBytes: 20, maxStaticBytes: 15 };
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'daypop-pet-budget-'));
  const source = join(root, 'source'); const built = join(root, 'assets');
  await mkdir(source); await mkdir(built);
  const files = [];
  try {
    for (const kind of ['moon-cat', 'orbit-ufo']) {
      for (const [pose, ext, size] of [['idle','webp',30],['look','webp',20],['sleep','webp',20],['jump','webp',20],['idle','png',15],['grab','png',15],['sleep','png',15]]) {
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
  assert.deepEqual(result.totals, { 'moon-cat': 135, 'orbit-ufo': 135 });
}));
for (const limit of Object.keys(limits)) {
  test(`rejects an exceeded ${limit} even if other limits pass`, () => fixture(async ({ source, files }) => {
    const result = await checkPetAssets(source, files, { ...limits, [limit]: limits[limit] - 1 });
    assert(result.problems.some(problem => problem.includes(limit)));
  }));
}
test('invalid or missing limits cannot disable the gate', () => fixture(async ({ source, files }) => {
  for (const invalid of [undefined, null, {}, { ...limits, maxStaticBytes: NaN }, { ...limits, maxSleepBytes: undefined }, { ...limits, maxJumpBytes: undefined }]) {
    assert((await checkPetAssets(source, files, invalid)).problems.length > 0);
  }
}));

test('a missing or altered emitted sleep asset fails even when the other six files match', () => fixture(async ({ source, files }) => {
  const sleep = files.find(file => file.includes('moon-cat-sleep-') && file.endsWith('.webp'));
  assert((await checkPetAssets(source, files.filter(file => file !== sleep), limits)).problems.some(p => p.includes('moon-cat-sleep.webp')));
  await writeFile(sleep, 'changed sleep');
  assert((await checkPetAssets(source, files, limits)).problems.some(p => p.includes('moon-cat-sleep.webp')));
}));

test('a missing or altered emitted jump asset fails even when the other six files match', () => fixture(async ({ source, files }) => {
  const jump = files.find(file => file.includes('moon-cat-jump-') && file.endsWith('.webp'));
  assert((await checkPetAssets(source, files.filter(file => file !== jump), limits)).problems.some(p => p.includes('moon-cat-jump.webp')));
  await writeFile(jump, 'changed jump');
  assert((await checkPetAssets(source, files, limits)).problems.some(p => p.includes('moon-cat-jump.webp')));
}));

test('production images equal the published five-state package, including full-frame jump and shared PNGs', async () => {
  const root = new URL('../', import.meta.url);
  const old = 'docs/pet-concepts/2026-10-23/motion/';
  const sleep = 'docs/pet-concepts/2026-10-24/sleep/';
  const encoding = 'docs/pet-concepts/2026-10-24/encoding/';
  const jump = 'docs/pet-concepts/2026-10-24/jump/';
  const jumpEncoding = 'docs/pet-concepts/2026-10-24/jump-encoding/';
  const manifests = await Promise.all([old, sleep, encoding, jump, jumpEncoding].map(async path => JSON.parse(await readFile(new URL(`${path}manifest.json`, root), 'utf8'))));
  for (const kind of ['moon_cat', 'orbit_ufo']) {
    const slug = kind.replace('_', '-');
    const candidates = manifests[2].characters.find(c => c.id === kind);
    const jumpSource = manifests[kind === 'moon_cat' ? 4 : 3].characters.find(c => c.id === kind);
    const jumpFile = kind === 'moon_cat' ? jumpSource.candidates.fullQ55A70.path : jumpSource.candidates.webpQ85;
    const jumpHash = kind === 'moon_cat' ? jumpSource.candidates.fullQ55A70.sha256 : jumpSource.sha256[jumpFile];
    let total = 0;
    for (const [file, source, hash] of [
      ...['idle', 'sleep'].map(pose => [`${pose}.webp`, encoding + candidates.clips[pose].path, candidates.clips[pose].sha256]),
      ['look.webp', `${old}previews/${kind}/look.q85.webp`, manifests[0].characters.find(c => c.id === kind).sha256[`previews/${kind}/look.q85.webp`]],
      ['jump.webp', (kind === 'moon_cat' ? jumpEncoding : jump) + jumpFile, jumpHash],
      ...['idle', 'grab', 'sleep'].map(pose => {
        const base = pose === 'sleep' ? sleep : old;
        const manifest = manifests[pose === 'sleep' ? 1 : 0].characters.find(c => c.id === kind);
        const path = `previews/${kind}/${pose}-static.png`;
        return [`${pose}.png`, base + path, manifest.sha256[path]];
      }),
    ]) {
      const bytes = await readFile(new URL(`src/assets/pets/${slug}-${file}`, root));
      assert.deepEqual(bytes, await readFile(new URL(source, root)), `${slug}-${file} source bytes`);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, `${slug}-${file} published hash`);
      total += bytes.length;
    }
    assert.equal(total, kind === 'moon_cat' ? 196286 : 173845);
  }
});
test('missing, unhashed, duplicated or different build bytes fail closed', () => fixture(async ({ source, files }) => {
  assert((await checkPetAssets(source, files.slice(1), limits)).problems.length > 0);
  assert((await checkPetAssets(source, [join(source, 'moon-cat-idle.webp'), ...files.slice(1)], limits)).problems.length > 0);
  assert((await checkPetAssets(source, [...files, files[0]], limits)).problems.length > 0);
  await writeFile(files[0], 'different');
  assert((await checkPetAssets(source, files, limits)).problems.length > 0);
}));
