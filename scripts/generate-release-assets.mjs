import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const releaseNotes = JSON.parse(await readFile(resolve(root, 'release-notes.json'), 'utf8'));
const currentRelease = releaseNotes.releases.find((release) => release.version === packageJson.version);

if (!currentRelease) {
  throw new Error(`release-notes.json 缺少目前版本 ${packageJson.version}`);
}

const versionPayload = {
  ...currentRelease,
  dataSchemaVersion: 1,
};

const swTemplate = await readFile(resolve(root, 'pwa/sw-template.js'), 'utf8');
const swSource = swTemplate.replaceAll('__DAYPOP_VERSION__', packageJson.version);

await Promise.all([
  writeFile(resolve(root, 'public/version.json'), `${JSON.stringify(versionPayload, null, 2)}\n`),
  writeFile(resolve(root, 'public/sw.js'), swSource),
]);

console.log(`Generated PWA release assets for DayPop ${packageJson.version}`);
