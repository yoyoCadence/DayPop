import { copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copies the built `index.html` to `dist/404.html` — DP-033.
 *
 * Static hosts (GitHub Pages among them) serve `404.html` for any path they
 * cannot map to a file, so an unknown URL under the deploy scope boots DayPop
 * instead of showing the host's own 404 page. A copy rather than a redirect:
 * the browser keeps the URL it asked for, which is what the Supabase recovery
 * and OAuth return trips read their tokens from.
 *
 * This runs as `postbuild` rather than inside `vite.config.ts` because the
 * config is typechecked without Node types on purpose — file I/O lives here,
 * next to the other release asset scripts.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

await copyFile(resolve(dist, 'index.html'), resolve(dist, '404.html'));

console.log('Copied dist/index.html to dist/404.html for SPA fallback');
