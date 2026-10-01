import { readFile, readdir, mkdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { build } from 'vite';

const nextVersion = '999.0.0'; // Test-only version, never written to tracked release assets.

async function readTree(directory: string, prefix = ''): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = `${prefix}/${entry.name}`;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [key, bytes] of await readTree(path, name)) files.set(key, bytes);
    } else {
      files.set(name, await readFile(path));
    }
  }
  return files;
}

/** Two real production builds, shared by a Playwright worker. No auth harness,
 * real account, deployment, or tracked generated asset is involved. */
export async function buildProductionUpdates(browserName: string) {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
  const currentVersion = packageJson.version;
  const template = await readFile('pwa/sw-template.js', 'utf8');
  const parent = resolve('output/playwright/production-updates');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, `build-${browserName}-`));
  const builds = new Map<string, Map<string, Buffer>>();
  for (const version of [currentVersion, nextVersion]) {
    const outDir = join(directory, version);
    await build({
      base: '/DayPop/',
      // Retain the repository config's safety checks, but disable real Auth in
      // these guest builds even on a developer machine with a public .env file.
      define: {
        __APP_VERSION__: JSON.stringify(version),
        'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(''),
        'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(''),
      },
      build: { outDir, emptyOutDir: false },
      logLevel: 'error',
    });
    const files = await readTree(outDir);
    const worker = Buffer.from(template.replaceAll('__DAYPOP_VERSION__', version));
    if (version === currentVersion) {
      if (!files.get('/sw.js')?.equals(worker)) {
        throw new Error('Production worker differs from its template/version; run npm run release:assets');
      }
    } else {
      files.set('/sw.js', worker);
      files.set('/version.json', Buffer.from(JSON.stringify({
        version, releasedAt: '2026-10-01', title: 'Production 更新回歸',
        changes: ['驗證新版 App 載入與資料保存'],
      })));
    }
    builds.set(version, files);
  }
  return { builds, currentVersion, nextVersion };
}

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff',
};

/** Per-test origin. Holding index.html blocks cache.addAll during installation,
 * while root navigations still work; releasing it is deterministic, not a sleep. */
export async function startProductionUpdateSite(artifacts: Awaited<ReturnType<typeof buildProductionUpdates>>) {
  let version = artifacts.currentVersion;
  let holdInstall = false;
  let releaseInstall = () => {};
  const installGate = new Promise<void>((resolveGate) => { releaseInstall = resolveGate; });
  let blockedInstallRequests = 0;
  const navigations: string[] = [];
  const versionRequests: string[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url!, 'http://127.0.0.1').pathname;
      response.setHeader('Cache-Control', 'no-store');
      if (path === '/favicon.ico') { response.writeHead(204).end(); return; }
      if (path === '/setup.html') {
        response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Storage setup</title>');
        return;
      }
      if (!path.startsWith('/DayPop/')) { response.writeHead(404).end(); return; }
      const servedVersion = version;
      const key = path === '/DayPop/' ? '/index.html' : path.slice('/DayPop'.length);
      if (holdInstall && path === '/DayPop/index.html') {
        blockedInstallRequests += 1;
        await installGate;
      }
      if (request.headers['sec-fetch-mode'] === 'navigate') navigations.push(servedVersion);
      if (key === '/version.json') versionRequests.push(servedVersion);
      const files = artifacts.builds.get(servedVersion)!;
      // Keep old hashed assets available during the same deployment transition.
      const bytes = files.get(key) ?? artifacts.builds.get(artifacts.currentVersion)!.get(key);
      if (!bytes) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': mimeTypes[extname(key)] ?? 'application/octet-stream' }).end(bytes);
    })().catch(() => { response.writeHead(500).end(); });
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected loopback TCP address');
  return {
    ...artifacts,
    origin: `http://127.0.0.1:${address.port}`,
    navigations, versionRequests,
    get blockedInstallRequests() { return blockedInstallRequests; },
    promote: (pauseInstall = false) => { holdInstall = pauseInstall; version = artifacts.nextVersion; },
    releaseInstall: () => { holdInstall = false; releaseInstall(); },
    close: async () => {
      releaseInstall();
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    },
  };
}

export type ProductionUpdateSite = Awaited<ReturnType<typeof startProductionUpdateSite>>;
