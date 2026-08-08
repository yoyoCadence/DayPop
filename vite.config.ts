import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import packageJson from './package.json' with { type: 'json' };
import { buildContentSecurityPolicy } from './src/lib/csp';

/**
 * Injects the CSP meta tag at build time so `connect-src` can name the
 * Supabase project this build talks to — DP-015.
 */
function contentSecurityPolicy(supabaseUrl: string | undefined): Plugin {
  return {
    name: 'daypop-csp',
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
    __DATA_SCHEMA_VERSION__: '2',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
}));
