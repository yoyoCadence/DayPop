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

// DP-067：只輸出 release 本身。user-data schema version 與 release version
// 必須獨立（AGENTS.md），這裡曾寫死 `dataSchemaVersion: 1`，實際 schema
// 早已是 4 而且沒有任何程式讀它。真的需要相容性協議時，另外設計有消費者的
// metadata，不要加回這裡。
const versionPayload = { ...currentRelease };

const swTemplate = await readFile(resolve(root, 'pwa/sw-template.js'), 'utf8');
const swSource = swTemplate.replaceAll('__DAYPOP_VERSION__', packageJson.version);

await Promise.all([
  writeFile(resolve(root, 'public/version.json'), `${JSON.stringify(versionPayload, null, 2)}\n`),
  writeFile(resolve(root, 'public/sw.js'), swSource),
]);

console.log(`Generated PWA release assets for DayPop ${packageJson.version}`);
