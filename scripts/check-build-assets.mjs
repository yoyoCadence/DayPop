import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Fails the build if the production output would reach the network at runtime,
 * if the CSP meta tag went missing (DP-015), or if the install icons are not
 * shipped exactly as the manifest and `index.html` promise (DP-019).
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

/**
 * The hand-written links must share the base Vite gave its own tags — DP-068.
 *
 * Vite only rewrites the tags it emits, so `manifest`, `icon` and
 * `apple-touch-icon` are whatever `index.html` says. Left document-relative,
 * they resolve against the current path: on the SPA fallback (a deep URL served
 * `404.html`) all three point into a directory that does not exist, and the
 * manifest comes back as HTML.
 *
 * The rule is self-consistency rather than a hard-coded prefix: this script
 * does not know which base a given build used, but every URL in the document
 * should agree. A relative build (the default `./`) is left alone — that one is
 * meant to be openable from any path.
 */
const emittedBase = /<script[^>]+src="(\/[^"]*\/)assets\//.exec(indexHtml)?.[1];
if (emittedBase) {
  for (const rel of ['manifest', 'icon', 'apple-touch-icon']) {
    const href = new RegExp(`<link[^>]+rel="${rel}"[^>]+href="([^"]+)"`).exec(indexHtml)?.[1]
      ?? new RegExp(`<link[^>]+href="([^"]+)"[^>]+rel="${rel}"`).exec(indexHtml)?.[1];
    if (!href) {
      problems.push(`dist/index.html has no rel="${rel}" link`);
    } else if (!href.startsWith(emittedBase)) {
      problems.push(
        `dist/index.html rel="${rel}" is "${href}" but the build's base is "${emittedBase}" — ` +
          'a deep URL would resolve it against the wrong directory',
      );
    }
  }
}

/**
 * Deploy safety — DP-033.
 *
 * The e2e suite mounts the real app against a fake Supabase from
 * `e2e/auth.html`. It is served by the dev server only and must never reach a
 * host: it would be a public page that fabricates a signed-in session. The
 * `service_role` scan is the same idea from the other direction — the frontend
 * is only ever allowed the project URL and the publishable key.
 */
const distFiles = [];
for await (const file of walk(dist)) distFiles.push(relative(dist, file).replaceAll('\\', '/'));

for (const file of distFiles) {
  if (file === 'auth.html' || file.startsWith('e2e/')) {
    problems.push(`dist/${file} is a dev-only test harness and must not be deployed`);
  }
}

// The SPA fallback is what keeps an unknown URL under the deploy scope booting
// the app instead of the host's 404 page.
if (!distFiles.includes('404.html')) {
  problems.push('dist/404.html is missing — the SPA fallback would not be deployed');
}

/**
 * Last line of defence against a privileged Supabase key reaching the public
 * bundle — DP-033.
 *
 * `vite.config.ts` already refuses to build with one (see
 * `src/lib/supabaseKey.ts`, which is the canonical classifier). This scan is
 * independent of it and looks at the artifact that would actually be
 * published, because the two failure shapes are different:
 *
 * - `sb_secret_…` is plainly visible, so a literal match finds it.
 * - a legacy `service_role` JWT hides its role inside base64url, so searching
 *   the text for "service_role" finds nothing. Every JWT-shaped token has to
 *   be decoded to see what it is.
 *
 * Both rules match key *material*, not mentions of these names. A blunt
 * "contains the word service_role" rule fires on every build, because the
 * classifier that rejects such keys necessarily names them in its own source
 * and error messages — and a check that always fails teaches everyone to
 * ignore it.
 *
 * Nothing here prints a key; only the file it was found in.
 */
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64Url(segment) {
  let bits = 0;
  let bitCount = 0;
  let output = '';
  for (const character of segment.replaceAll('-', '+').replaceAll('_', '/')) {
    if (character === '=') break;
    const index = BASE64_ALPHABET.indexOf(character);
    if (index < 0) return null;
    bits = (bits << 6) | index;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      output += String.fromCharCode((bits >> bitCount) & 0xff);
    }
  }
  return output;
}

function jwtRole(token) {
  const payload = decodeBase64Url(token.split('.')[1] ?? '');
  if (payload === null) return null;
  try {
    const parsed = JSON.parse(payload);
    return typeof parsed?.role === 'string' ? parsed.role : null;
  } catch {
    return null;
  }
}

const PRIVILEGED_ROLES = new Set(['service_role', 'supabase_admin']);

for (const file of distFiles) {
  if (!TEXT_EXTENSIONS.has(extname(file))) continue;
  const text = await readFile(resolve(dist, file), 'utf8');

  // The prefix plus enough trailing characters to be actual key material, not
  // the bare prefix constant the classifier compares against.
  if (/sb_secret_[A-Za-z0-9_-]{8,}/.test(text)) {
    problems.push(`dist/${file} contains a Supabase secret key (sb_secret_…)`);
  }

  // JWTs always start with the base64url of `{"alg"`.
  for (const match of text.matchAll(/eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+/g)) {
    const role = jwtRole(match[0]);
    if (role !== null && PRIVILEGED_ROLES.has(role)) {
      problems.push(`dist/${file} embeds a privileged Supabase JWT (role ${role})`);
    }
  }
}

/**
 * Install icons are committed output of `npm run icons`, so nothing else in the
 * build would notice a missing file, a wrong pixel size, or an alpha channel
 * creeping back into an icon that must stay opaque — DP-019.
 *
 * PNG header layout: 8-byte signature, IHDR length and type, then width,
 * height, bit depth and colour type. Colour types 4 and 6 carry alpha.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Turns a URL from the built HTML into a path inside `dist/`. Handles both
 * shapes the build can emit: `./icons/x.png` for the relative default, and
 * `/DayPop/icons/x.png` once a deploy base is applied (DP-068).
 */
function distPathOf(href) {
  if (emittedBase && href.startsWith(emittedBase)) return href.slice(emittedBase.length);
  return href.replace(/^\.\//, '');
}

async function readPngHeader(relativePath) {
  const bytes = await readFile(resolve(dist, relativePath));
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') {
    return null;
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    hasAlpha: (bytes[25] & 0b100) !== 0,
  };
}

const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.webmanifest'), 'utf8'));
const pngIcons = manifest.icons.filter((icon) => icon.type === 'image/png');
const declared = pngIcons.map((icon) => `${icon.purpose} ${icon.sizes}`).sort();

// Chrome installs from `any`; Android's adaptive shapes need `maskable`.
for (const required of ['any 192x192', 'any 512x512', 'maskable 192x192', 'maskable 512x512']) {
  if (!declared.includes(required)) problems.push(`manifest.webmanifest is missing a ${required} PNG icon`);
}

for (const icon of pngIcons) {
  const header = await readPngHeader(distPathOf(icon.src)).catch(() => null);
  if (!header) {
    problems.push(`manifest icon ${icon.src} is missing from dist/ or is not a PNG`);
    continue;
  }
  if (`${header.width}x${header.height}` !== icon.sizes) {
    problems.push(`manifest icon ${icon.src} is ${header.width}x${header.height}, declared ${icon.sizes}`);
  }
  // A mask crops to a circle or squircle; transparency there shows the launcher backdrop.
  if (icon.purpose === 'maskable' && header.hasAlpha) {
    problems.push(`maskable icon ${icon.src} still has an alpha channel`);
  }
}

// iOS ignores SVG in `apple-touch-icon` and composites transparency onto black.
const appleIcon = /<link rel="apple-touch-icon"[^>]*href="([^"]+)"/.exec(indexHtml)?.[1];
if (!appleIcon || !appleIcon.endsWith('.png')) {
  problems.push('index.html apple-touch-icon does not point at a PNG');
} else {
  const header = await readPngHeader(distPathOf(appleIcon)).catch(() => null);
  if (!header) problems.push(`apple-touch-icon ${appleIcon} is missing from dist/ or is not a PNG`);
  else if (header.width !== 180 || header.height !== 180) {
    problems.push(`apple-touch-icon ${appleIcon} is ${header.width}x${header.height}, expected 180x180`);
  } else if (header.hasAlpha) {
    problems.push(`apple-touch-icon ${appleIcon} has an alpha channel; iOS would fill it with black`);
  }
}

if (problems.length > 0) {
  console.error('Build asset check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `Build asset check passed: ${scanned} text assets, no runtime remote dependency, CSP present, ` +
    `${pngIcons.length} manifest PNG icons and the Apple touch icon shipped as declared.`,
);
