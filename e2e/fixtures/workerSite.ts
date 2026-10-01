import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

/** A per-test loopback origin, with real worker bytes and a minimal static shell.
 * The next version changes only the served APP_VERSION in memory. No tracked
 * release asset is edited, and this does not simulate the React update UI. */
export async function startWorkerSite() {
  const [worker, template, packageText, manifest, icon] = await Promise.all([
    readFile(new URL('../../public/sw.js', import.meta.url), 'utf8'),
    readFile(new URL('../../pwa/sw-template.js', import.meta.url), 'utf8'),
    readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../../public/manifest.webmanifest', import.meta.url), 'utf8'),
    readFile(new URL('../../public/icons/daypop.svg', import.meta.url), 'utf8'),
  ]);
  const currentVersion: string = JSON.parse(packageText).version;
  if (worker !== template.replaceAll('__DAYPOP_VERSION__', currentVersion)) {
    throw new Error('Generated worker differs from its template/version; run npm run release:assets');
  }
  const nextVersion = '999.0.0'; // Synthetic, never a DayPop release.
  const versionLine = `const APP_VERSION = '${currentVersion}';`;
  if (worker.split(versionLine).length !== 2) throw new Error('Expected one worker version declaration');
  const nextWorker = worker.replace(versionLine, `const APP_VERSION = '${nextVersion}';`);
  let version = currentVersion;
  const versionRequests: string[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url!, 'http://127.0.0.1').pathname;
    response.setHeader('Cache-Control', 'no-store'); // Rule out the HTTP cache.
    if (path === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    let body: string;
    let contentType: string;
    if (path === '/DayPop/sw.js') {
      body = version === currentVersion ? worker : nextWorker;
      contentType = 'application/javascript';
    } else if (path === '/DayPop/version.json') {
      versionRequests.push(version);
      body = JSON.stringify({ version, releasedAt: '2026-10-01', title: 'Worker fixture', changes: [] });
      contentType = 'application/json';
    } else if (path === '/DayPop/manifest.webmanifest') {
      body = manifest;
      contentType = 'application/manifest+json';
    } else if (path === '/DayPop/icons/daypop.svg') {
      body = icon;
      contentType = 'image/svg+xml';
    } else if ([currentVersion, nextVersion].some((item) => path === `/DayPop/assets/shell-${item}.js`)) {
      const assetVersion = path === `/DayPop/assets/shell-${currentVersion}.js` ? currentVersion : nextVersion;
      body = `document.documentElement.dataset.assetVersion = '${assetVersion}';`;
      contentType = 'application/javascript';
    } else if (['/DayPop/', '/DayPop/index.html', '/DayPop/offline-route', '/outside.html'].includes(path)) {
      body = `<!doctype html><html lang="zh-TW"><meta charset="utf-8"><title>Worker fixture</title>
        <body><h1>Worker fixture ${version}</h1><script src="/DayPop/assets/shell-${version}.js"></script></body></html>`;
      contentType = 'text/html';
    } else {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': contentType }).end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a loopback TCP address');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    currentVersion,
    nextVersion,
    versionRequests,
    promote: () => { version = nextVersion; },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

export type WorkerSite = Awaited<ReturnType<typeof startWorkerSite>>;
