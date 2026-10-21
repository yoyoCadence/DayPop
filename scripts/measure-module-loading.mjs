import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { findStaticPath } from './module-loading.mjs';

// Build-time diagnostic only: no dev server, account, browser or product change.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
assert(args.length <= 1 && args.every((arg) => arg.startsWith('--output=')), 'Use --output=<json path>');
const output = resolve(args[0]?.slice('--output='.length) || join(tmpdir(), 'daypop-module-loading.json'));
await mkdir(dirname(output), { recursive: true });
process.env.VITE_SUPABASE_URL = '';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = '';
const normalizedRoot = root.replaceAll('\\', '/');
const publicId = (id) => id.replaceAll('\\', '/').replaceAll(`${normalizedRoot}/`, '').replaceAll('\0', '[virtual]');
const sizes = (code) => {
  const bytes = Buffer.from(code);
  return { rawBytes: bytes.length, gzipBytes: gzipSync(bytes).length };
};
let report;
const built = await build({
  root,
  build: { write: false },
  plugins: [{
    name: 'daypop-module-loading-measurement',
    generateBundle(_options, bundle) {
      const ids = [...this.getModuleIds()];
      const graph = new Map(ids.map((id) => [id, this.getModuleInfo(id)?.importedIds ?? []]));
      const entry = ids.find((id) => publicId(id) === 'src/main.tsx');
      assert(entry, 'Product entry missing from build graph');
      const chunks = Object.values(bundle).filter((asset) => asset.type === 'chunk');
      const modules = chunks.flatMap((chunk) => Object.entries(chunk.modules)
        .filter(([, module]) => module.renderedLength > 0)
        .map(([id, module]) => ({ id: publicId(id), chunk: chunk.fileName, renderedLength: module.renderedLength })));
      const targets = ['src/screens/SettingsScaffoldScreen.tsx', 'src/screens/backupDownload.ts',
        'src/domain/dataTransfer.ts', 'src/domain/ics.ts', 'src/domain/recurrence.ts'];
      const paths = targets.map((target) => {
        const id = ids.find((id) => publicId(id) === target);
        assert(id && modules.some((module) => module.id === target), `Target not rendered: ${target}`);
        return {
          target,
          eagerPath: findStaticPath(graph, entry, id)?.map(publicId) ?? null,
          staticImporters: (this.getModuleInfo(id)?.importers ?? []).map(publicId).sort(),
        };
      });
      const groups = new Map();
      for (const module of modules) {
        const dependency = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(module.id);
        const name = dependency?.[1] ?? (module.id.startsWith('src/') ? module.id.split('/').slice(0, 2).join('/') : 'bundler');
        groups.set(name, (groups.get(name) ?? 0) + module.renderedLength);
      }
      report = {
        attribution: [...groups].map(([group, renderedLength]) => ({ group, renderedLength }))
          .sort((a, b) => b.renderedLength - a.renderedLength),
        targetPaths: paths,
        modules: modules.sort((a, b) => b.renderedLength - a.renderedLength),
      };
    },
  }],
});
assert(report, 'Bundle measurement hook did not run');
assert(!Array.isArray(built) && 'output' in built, 'Expected one client build');
// Read final output after every generateBundle hook, including Vite's hooks.
const chunks = built.output.filter((asset) => asset.type === 'chunk').map((chunk) => ({
  file: chunk.fileName, isEntry: chunk.isEntry, ...sizes(chunk.code),
  imports: chunk.imports, dynamicImports: chunk.dynamicImports,
}));
const css = built.output.filter((asset) => asset.type === 'asset' && asset.fileName.endsWith('.css'))
  .map((asset) => ({ file: asset.fileName, ...sizes(asset.source) }));
const result = {
  measuredAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  node: process.version,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  supabaseConfiguration: 'empty (guest build)',
  method: 'Vite production write:false; final file bytes + per-file gzip; bundler renderedLength attribution is not compressed or additive final-file size',
  chunks,
  css,
  ...report,
  publicWorker: { file: 'sw.js', ...sizes(await readFile(join(root, 'public/sw.js'))) },
};
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, timezone: result.timezone, chunks: result.chunks, attribution: result.attribution }, null, 2));
