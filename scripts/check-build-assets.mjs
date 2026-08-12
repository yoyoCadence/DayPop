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
 * Install icons are committed output of `npm run icons`, so nothing else in the
 * build would notice a missing file, a wrong pixel size, or an alpha channel
 * creeping back into an icon that must stay opaque — DP-019.
 *
 * PNG header layout: 8-byte signature, IHDR length and type, then width,
 * height, bit depth and colour type. Colour types 4 and 6 carry alpha.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
  const relativePath = icon.src.replace(/^\.\//, '');
  const header = await readPngHeader(relativePath).catch(() => null);
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
  const header = await readPngHeader(appleIcon.replace(/^\.\//, '')).catch(() => null);
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
