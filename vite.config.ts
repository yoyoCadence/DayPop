import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import packageJson from './package.json' with { type: 'json' };
// Extension included: the native config loader Vite is moving to cannot
// resolve extensionless relative imports here.
import { buildContentSecurityPolicy } from './src/lib/csp.ts';

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

export default defineConfig(({ mode }) => ({
  base: './',
  // Only the public `VITE_` prefix is read; no secret can reach the bundle.
  plugins: [react(), contentSecurityPolicy(loadEnv(mode, '.', 'VITE_').VITE_SUPABASE_URL)],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __DATA_SCHEMA_VERSION__: '4',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
}));
