import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Fails the build if the production output would reach the network at runtime,
 * or if the CSP meta tag went missing — DP-015.
 *
 * The prototype (`日曆桌寵 Calendar Pet.dc.html`, generated `support.js`) loads
 * React and fonts from CDNs. Those files are kept as the design source but must
 * never end up in `dist/`, and no new remote dependency should slip in either.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

/** Text assets worth scanning; fonts and images cannot fetch anything. */
const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg']);

/**
 * Files whose remote URLs the browser actually fetches — `<script src>`,
 * `<link href>`, `@font-face src`, `url()`, manifest icons.
 *
 * JavaScript is deliberately excluded from this scan: bundles legitimately
 * contain URL *strings* that are never requested (React's error-doc links,
 * supabase-js pointing at its own docs, and the project URL this build was
 * given — public by design, see `.env.example`). Flagging those would train
 * everyone to ignore the check. JS is still scanned for CDN hosts below.
 */
const FETCHED_EXTENSIONS = new Set(['.html', '.css', '.webmanifest', '.svg']);

/** XML namespaces are identifiers, not requests. */
const ALLOWED = ['http://www.w3.org/', 'https://www.w3.org/', 'https://schema.org'];

const problems = [];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

try {
  await stat(dist);
} catch {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

let scanned = 0;
for await (const file of walk(dist)) {
  if (!TEXT_EXTENSIONS.has(extname(file))) continue;
  scanned += 1;
  const text = await readFile(file, 'utf8');
  const relativePath = relative(root, file);

  if (FETCHED_EXTENSIONS.has(extname(file))) {
    // The CSP meta names origins it *permits*; that is the opposite of a fetch.
    const fetchable = text.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/g, '');
    for (const match of fetchable.matchAll(/\bhttps?:\/\/[^\s"'`)\\]+/g)) {
      const url = match[0];
      if (ALLOWED.some((prefix) => url.startsWith(prefix))) continue;
      problems.push(`${relativePath} would fetch ${url}`);
    }
  }

  // The prototype runtime must never be part of a release.
  if (/unpkg\.com|cdn\.jsdelivr|fonts\.googleapis|fonts\.gstatic/.test(text)) {
    problems.push(`${relativePath} loads a third-party CDN`);
  }
}

const indexHtml = await readFile(resolve(dist, 'index.html'), 'utf8');
if (!indexHtml.includes('http-equiv="Content-Security-Policy"')) {
  problems.push('dist/index.html is missing the Content-Security-Policy meta tag');
}
if (!/default-src 'self'/.test(indexHtml)) {
  problems.push("dist/index.html CSP does not start from default-src 'self'");
}

if (problems.length > 0) {
  console.error('Build asset check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`Build asset check passed: ${scanned} text assets, no runtime remote dependency, CSP present.`);
