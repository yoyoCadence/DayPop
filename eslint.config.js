import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `supabase/.temp` is scratch the CLI writes on `supabase start` — bundled
  // edge-runtime code, not ours. It is gitignored, so CI never saw it, but
  // anyone who runs the local stack to verify a migration got ~99 phantom
  // errors until this line existed.
  // Playwright production builds and reports are generated under
  // `output/playwright`; keep the actual `e2e` sources covered by lint.
  { ignores: ['dist', 'coverage', 'public/sw.js', 'supabase/.temp', 'output/playwright', 'supabase/functions/reminder-sender/core.generated.js'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // DP-237: importing the dev-only auth entry from a spec can evaluate it a
    // second time (another createRoot) when the URL differs from auth.html's,
    // which on Windows reset the signed-in App mid-test. Linux CI does not
    // reproduce that, so only lint keeps the pattern from coming back.
    files: ['e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'Literal[value=/e2eAuthMain/]',
        message: 'Use HarnessWindow.__daypopSharingHarness from e2e/support.ts instead of importing the dev-only auth entry.',
      }],
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
);
