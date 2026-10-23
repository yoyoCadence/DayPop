import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** Check the actual emitted, content-hashed files, including the unselected registry entry. */
export async function checkPetAssets(source, builtFiles, budget) {
  const problems = [];
  const totals = {};
  const limits = ['maxCharacterBytes', 'maxIdleBytes', 'maxLookBytes', 'maxStaticBytes'];
  for (const key of limits) {
    if (!Number.isSafeInteger(budget?.[key]) || budget[key] <= 0) problems.push(`pets.${key} must be a positive safe integer`);
  }
  if (problems.length) return { problems, totals };
  const expected = ['moon-cat', 'orbit-ufo'].flatMap(kind => ['idle.webp', 'look.webp', 'idle.png', 'grab.png'].map(file => `${kind}-${file}`));
  const actual = await readdir(source);
  if (actual.length !== expected.length || expected.some(file => !actual.includes(file))) {
    problems.push('pet assets must contain exactly the approved four files per character');
    return { problems, totals };
  }
  for (const name of expected) {
    const bytes = await readFile(join(source, name));
    const [kind, pose, extension] = /^(moon-cat|orbit-ufo)-(idle|look|grab)\.(webp|png)$/.exec(name).slice(1);
    const metric = extension === 'png' ? 'maxStaticBytes' : pose === 'idle' ? 'maxIdleBytes' : 'maxLookBytes';
    totals[kind] = (totals[kind] ?? 0) + bytes.length;
    if (bytes.length > budget[metric]) problems.push(`${name} ${bytes.length} exceeds ${metric} ${budget[metric]} bytes`);
    const pattern = new RegExp(`^${kind}-${pose}-[A-Za-z0-9_-]+\\.${extension}$`);
    const matches = builtFiles.filter(file => pattern.test(basename(file)));
    if (matches.length !== 1) problems.push(`${name} needs exactly one content-hashed build asset; found ${matches.length}`);
    else if (!bytes.equals(await readFile(matches[0]))) problems.push(`${name} emitted bytes differ from source`);
  }
  for (const [kind, bytes] of Object.entries(totals)) {
    if (bytes > budget.maxCharacterBytes) problems.push(`${kind} ${bytes} exceeds maxCharacterBytes ${budget.maxCharacterBytes} bytes`);
  }
  return { problems, totals };
}
