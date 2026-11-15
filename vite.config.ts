import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import packageJson from './package.json' with { type: 'json' };
// Extension included: the native config loader Vite is moving to cannot
// resolve extensionless relative imports here.
import { buildContentSecurityPolicy } from './src/lib/csp.ts';
import {
  classifySupabaseKey,
  describeSupabaseKeyProblem,
  isBrowserSafeSupabaseKey,
} from './src/lib/supabaseKey.ts';

/**
 * Refuses to build with a privileged Supabase key — DP-033.
 *
 * `VITE_` values are compiled into the public bundle, so a `sb_secret_…` or a
 * legacy `service_role` JWT pasted here would be published to every visitor.
 * Checking that the variable is non-empty cannot catch that, and the bundle
 * scan in `scripts/check-build-assets.mjs` runs after the key is already
 * baked in — this throws before any output is written.
 *
 * An absent key stays legal: CI builds with no Supabase configuration at all,
 * and that path is what produces a guest-only bundle.
 */
function assertBrowserSafeKey(publishableKey: string | undefined): void {
  if (!publishableKey?.trim()) return;

  const kind = classifySupabaseKey(publishableKey);
  if (isBrowserSafeSupabaseKey(kind)) return;

  // The message names the fix, never the value.
  throw new Error(`[daypop] ${describeSupabaseKeyProblem(kind)}`);
}

/**
 * Injects the CSP meta tag at build time so `connect-src` can name the
 * Supabase project this build talks to — DP-015.
 *
 * `apply: 'build'` is not an optimisation. The dev server ships CSS as
 * JS-injected `<style>` elements, which `style-src 'self'` blocks outright —
 * with the policy applied in dev the whole app renders unstyled. The policy
 * describes what the *shipped* bundle needs, so it belongs to the build only.
 */
function contentSecurityPolicy(supabaseUrl: string | undefined): Plugin {
  return {
    name: 'daypop-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replace(
          '<meta charset="UTF-8" />',
          `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${buildContentSecurityPolicy({ supabaseUrl })}" />`,
        ),
    },
  };
}

// A content digest per character keeps all of its pose URLs consistent when
// the art changes. Repeating the digest also avoids spending the JS gzip
// budget on 56 independently random filename suffixes.
const petDirectionDirectory = new URL('./src/assets/pet-directions/', import.meta.url);

function petDirectionDigests() {
  const hashes = new Map<string, ReturnType<typeof createHash>>();
  for (const file of readdirSync(petDirectionDirectory).sort()) {
    const character = file.slice(0, file.lastIndexOf('-'));
    const hash = hashes.get(character) ?? createHash('sha256');
    hash.update(file).update(readFileSync(new URL(file, petDirectionDirectory)));
    hashes.set(character, hash);
  }
  return new Map([...hashes].map(([name, hash]) => [name, hash.digest('hex').slice(0, 12)]));
}

function emitPetActions(digests: ReadonlyMap<string, string>): Plugin {
  return {
    name: 'daypop-pet-actions',
    apply: 'build',
    buildStart() {
      for (const file of readdirSync(petDirectionDirectory)) {
        if (file.endsWith('-idle.png')) continue; // Used as each runtime URL's imported anchor.
        const character = file.slice(0, file.lastIndexOf('-'));
        const dot = file.lastIndexOf('.');
        this.emitFile({
          type: 'asset',
          fileName: `assets/${file.slice(0, dot)}-${digests.get(character)}${file.slice(dot)}`,
          source: readFileSync(new URL(file, petDirectionDirectory)),
        });
      }
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, '.', 'VITE_');

  // The `VITE_` prefix limits *which* variables are read, not what they hold —
  // a privileged key pasted into a VITE_ variable is still published. This is
  // the gate that stops it.
  assertBrowserSafeKey(env.VITE_SUPABASE_PUBLISHABLE_KEY);

  const petDigests = command === 'build' ? petDirectionDigests() : new Map<string, string>();
  return {
    build: {
      rolldownOptions: {
        output: {
          assetFileNames(asset) {
            const original = asset.originalFileNames.find(name => name.startsWith('src/assets/pet-directions/'));
            const file = original?.split('/').pop();
            const digest = file && petDigests.get(file.slice(0, file.lastIndexOf('-')));
            return digest ? `assets/[name]-${digest}[extname]` : 'assets/[name]-[hash][extname]';
          },
        },
      },
    },
    // Relative by default so `dist/` can be opened from any path. A deploy
    // under a subpath (GitHub Pages project sites) must override this with an
    // absolute `--base=/<repo>/`: `import.meta.env.BASE_URL` feeds the service
    // worker scope, the version check and the Supabase auth redirect, and `./`
    // would resolve those against the domain root. See docs/deployment.md.
    base: './',
    plugins: [react(), contentSecurityPolicy(env.VITE_SUPABASE_URL), emitPetActions(petDigests)],
    resolve: {
      // DP-263: DayPop never uses Supabase Realtime, but supabase-js builds a
      // RealtimeClient eagerly; the stub keeps realtime-js and phoenix out of
      // the bundle. See src/lib/realtimeDisabled.ts before subscribing to anything.
      alias: [{
        find: /^@supabase\/realtime-js$/,
        replacement: fileURLToPath(new URL('./src/lib/realtimeDisabled.ts', import.meta.url)),
      }],
    },
    server: {
      // DP-108: Playwright writes tens of thousands of generated files under
      // output/playwright/ (production fixture builds, reports, traces). The
      // dev watcher walks every watched file at startup on the main thread, so
      // with that tree in scope module requests stalled for minutes and the
      // first dev-harness e2e timed out. Nothing there is source.
      watch: { ignored: ['**/output/playwright/**'] },
    },
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
      __DATA_SCHEMA_VERSION__: '5',
    },
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts'],
      // DP-263: transform supabase-js through Vite so the realtime alias above
      // applies in tests exactly as in the app bundle.
      server: { deps: { inline: ['@supabase/supabase-js'] } },
    },
  };
});
