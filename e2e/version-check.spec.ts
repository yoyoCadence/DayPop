import { expect, test } from '@playwright/test';
import { monitorBrowser, openApp } from './support';

/**
 * DP-073 — the real entry point checks `version.json` once per cold start.
 *
 * `AppUpdateProvider.test.tsx` proves the mechanism: a hook hosted inside
 * `SessionDataProvider`'s `<DataProvider key={identity}>` runs again when the
 * key changes, and one mounted above it does not. What that cannot see is
 * `main.tsx` — nothing in the unit suite renders the real provider tree, so
 * moving `AppUpdateProvider` back inside the keyed subtree would leave every
 * unit test green.
 *
 * This closes that gap by counting requests against the app as it is actually
 * composed. No service worker is involved: the e2e web server is the Vite dev
 * server (`playwright.config.ts`), so `import.meta.env.PROD` is false and
 * `useAppUpdate` takes its development branch — which still requests
 * `version.json` once on mount.
 */
test('冷啟動只請求一次 version.json', async ({ page }) => {
  const assertCleanBrowser = monitorBrowser(page);

  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('version.json')) requests.push(request.url());
  });

  await openApp(page);

  // The identity change happens as Supabase Auth resolves, shortly after the
  // first paint; a fixed settle is what makes a second request observable at
  // all. Without it this test would pass even with the provider in the wrong
  // place, because it would finish before the remount.
  await page.waitForTimeout(2_000);

  expect(
    requests,
    'a second request means the version check is mounted inside the account-keyed subtree again',
  ).toHaveLength(1);

  assertCleanBrowser();
});
