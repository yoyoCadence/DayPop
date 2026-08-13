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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');

  // The `VITE_` prefix limits *which* variables are read, not what they hold —
  // a privileged key pasted into a VITE_ variable is still published. This is
  // the gate that stops it.
  assertBrowserSafeKey(env.VITE_SUPABASE_PUBLISHABLE_KEY);

  return {
    // Relative by default so `dist/` can be opened from any path. A deploy
    // under a subpath (GitHub Pages project sites) must override this with an
    // absolute `--base=/<repo>/`: `import.meta.env.BASE_URL` feeds the service
    // worker scope, the version check and the Supabase auth redirect, and `./`
    // would resolve those against the domain root. See docs/deployment.md.
    base: './',
    plugins: [react(), contentSecurityPolicy(env.VITE_SUPABASE_URL)],
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
      __DATA_SCHEMA_VERSION__: '4',
    },
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
