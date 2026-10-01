import { expect, test as base, type Page } from '@playwright/test';
import { backupData } from './fixtures/backupData';
import { startWorkerSite, type WorkerSite } from './fixtures/workerSite';

const cachePrefix = 'daypop-app-shell-';
const otherCache = 'other-app-static';
const databaseName = 'daypop-worker-test';
const persistentValues = {
  'daypop.user-data': JSON.stringify({ schemaVersion: 4, revision: 7, updatedAt: '2026-09-30T04:00:00.000Z', data: backupData }),
  'daypop.account-cache.00000000-0000-4000-8000-000000000095': JSON.stringify({
    schemaVersion: 4, accountId: '00000000-0000-4000-8000-000000000095',
    updatedAt: '2026-09-30T04:00:00.000Z', data: backupData,
  }),
  'calpet.v2': '{"synthetic":"原始 legacy bytes 不可刪除"}',
  'CALPET_FIRED': '["synthetic-reminder"]',
};

const test = base.extend<{ workerSite: WorkerSite; browserHealth: { expectOfflineVersionError(): void } }>({
  workerSite: async ({ context }, provide) => {
    const site = await startWorkerSite();
    try {
      await provide(site);
    } finally {
      await context.setOffline(false);
      await site.close();
    }
  },
  browserHealth: [async ({ page, workerSite }, provide) => {
    const problems: string[] = [];
    let expectedOfflineErrors = 0;
    let observedOfflineErrors = 0;
    page.on('console', (message) => {
      if (message.type() !== 'error' && message.type() !== 'warning') return;
      if (message.type() === 'error' && expectedOfflineErrors === 1 &&
        message.text() === 'Failed to load resource: net::ERR_INTERNET_DISCONNECTED' &&
        message.location().url === `${workerSite.origin}/DayPop/version.json`) {
        observedOfflineErrors += 1;
      } else {
        problems.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    await provide({ expectOfflineVersionError: () => { expectedOfflineErrors = 1; } });
    expect(problems, 'no unrelated browser error/warning').toEqual([]);
    expect(observedOfflineErrors).toBe(expectedOfflineErrors);
  }, { auto: true }],
});

async function openWorkerSite(page: Page, site: WorkerSite) {
  await page.goto(`${site.origin}/DayPop/`);
  await expect(page.getByRole('heading', { name: `Worker fixture ${site.currentVersion}`, exact: true })).toBeVisible();
  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  console.log('Service worker browser timezone:', zone);
  expect(zone).toBe('Asia/Taipei');
}

async function installWorker(page: Page, site: WorkerSite) {
  const scope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register('/DayPop/sw.js', { scope: '/DayPop/' });
    await navigator.serviceWorker.ready;
    return registration.scope;
  });
  expect(scope).toBe(`${site.origin}/DayPop/`);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

async function cacheKeys(page: Page) {
  return page.evaluate(async () => (await caches.keys()).sort());
}

async function warmAsset(page: Page, version: string) {
  const path = `/DayPop/assets/shell-${version}.js`;
  const result = await page.evaluate(async (path) => {
    const response = await fetch(path);
    return { status: response.status, body: await response.text() };
  }, path);
  expect(result).toEqual({ status: 200, body: `document.documentElement.dataset.assetVersion = '${version}';` });
  await expect.poll(() => page.evaluate(async ({ cache, path }) => {
    const response = await (await caches.open(cache)).match(path);
    return response?.text();
  }, { cache: `${cachePrefix}${version}`, path })).toBe(result.body);
}

async function seedPersistentData(page: Page) {
  await page.evaluate(async ({ values, otherCache, databaseName }) => {
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
    const cache = await caches.open(otherCache);
    await cache.put('/unrelated-sentinel', new Response('不可清除其他 cache'));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('records', 'readwrite');
        transaction.objectStore('records').put('IndexedDB 使用者資料', 'sentinel');
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    });
  }, { values: persistentValues, otherCache, databaseName });
}

async function expectPersistentData(page: Page) {
  const result = await page.evaluate(async ({ keys, otherCache, databaseName }) => {
    const values = Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
    const other = (await caches.keys()).includes(otherCache)
      ? await (await (await caches.open(otherCache)).match('/unrelated-sentinel'))?.text()
      : null;
    const indexed = await new Promise<unknown>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        // Do not repair a deleted database: a missing store must fail the test.
        if (!db.objectStoreNames.contains('records')) { db.close(); resolve(null); return; }
        const read = db.transaction('records').objectStore('records').get('sentinel');
        read.onsuccess = () => { db.close(); resolve(read.result); };
        read.onerror = () => { db.close(); reject(read.error); };
      };
    });
    return { values, other, indexed };
  }, { keys: Object.keys(persistentValues), otherCache, databaseName });
  expect(result).toEqual({ values: persistentValues, other: '不可清除其他 cache', indexed: 'IndexedDB 使用者資料' });
}

test('新版 worker 等待明確啟用，只清理舊 app-shell cache 並保留所有使用者儲存', async ({ page, workerSite }) => {
  await openWorkerSite(page, workerSite);
  await seedPersistentData(page);
  await installWorker(page, workerSite);
  const currentCache = `${cachePrefix}${workerSite.currentVersion}`;
  const nextCache = `${cachePrefix}${workerSite.nextVersion}`;
  await expect.poll(() => cacheKeys(page)).toEqual([currentCache, otherCache].sort());
  await warmAsset(page, workerSite.currentVersion);
  await expectPersistentData(page);

  workerSite.promote();
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
  await expect.poll(() => page.evaluate(async () => {
    const registration = (await navigator.serviceWorker.getRegistration())!;
    return { waiting: registration.waiting?.state, active: registration.active?.state };
  })).toEqual({ waiting: 'installed', active: 'activated' });
  // Installation can fill a new cache, but may not activate or remove the old
  // one while a controlled client is still open and has not chosen to update.
  await expect.poll(() => cacheKeys(page)).toEqual([currentCache, nextCache, otherCache].sort());
  await expect(page.getByRole('heading')).toHaveText(`Worker fixture ${workerSite.currentVersion}`);
  await expectPersistentData(page);

  await page.evaluate(async () => {
    const registration = (await navigator.serviceWorker.getRegistration())!;
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
      registration.waiting!.postMessage({ type: 'SKIP_WAITING' });
    });
  });
  await expect.poll(() => cacheKeys(page)).toEqual([nextCache, otherCache].sort());
  await expect.poll(() => page.evaluate(async () => {
    const registration = (await navigator.serviceWorker.getRegistration())!;
    return { active: registration.active?.state, waiting: registration.waiting === null };
  })).toEqual({ active: 'activated', waiting: true });
  await expectPersistentData(page);
  await page.reload();
  await expect(page.getByRole('heading')).toHaveText(`Worker fixture ${workerSite.nextVersion}`);
  await warmAsset(page, workerSite.nextVersion);
  await expectPersistentData(page);
});

test('受控子路徑離線可讀 shell 與 asset，version.json 永遠讀網路且失敗不回舊版', async ({ page, context, workerSite, browserHealth }) => {
  await openWorkerSite(page, workerSite);
  await seedPersistentData(page);
  await installWorker(page, workerSite);
  await warmAsset(page, workerSite.currentVersion);
  // Deliberately put an old version.json in the cache. Correct worker behavior
  // must still bypass it, both online and offline.
  await page.evaluate(async (cache) => {
    await (await caches.open(cache)).put('/DayPop/version.json', new Response('{"version":"stale"}'));
  }, `${cachePrefix}${workerSite.currentVersion}`);
  workerSite.promote();
  const online = await page.evaluate(async () => (await fetch('/DayPop/version.json', { cache: 'no-store' })).json());
  expect(online.version).toBe(workerSite.nextVersion);
  expect(workerSite.versionRequests).toEqual([workerSite.nextVersion]);

  await context.setOffline(true);
  await page.goto(`${workerSite.origin}/DayPop/offline-route`);
  await expect(page.getByRole('heading')).toHaveText(`Worker fixture ${workerSite.currentVersion}`);
  await expect(page.locator('html')).toHaveAttribute('data-asset-version', workerSite.currentVersion);
  await expectPersistentData(page);
  // A deliberate offline fetch logs a browser error; capture only that known
  // failed request, without relaxing console checks for the rest of the case.
  browserHealth.expectOfflineVersionError();
  const offlineVersion = await page.evaluate(async () => {
    try {
      return { fetched: true, version: (await (await fetch('/DayPop/version.json')).json()).version };
    } catch {
      return { fetched: false };
    }
  });
  expect(offlineVersion).toEqual({ fetched: false });
  expect(workerSite.versionRequests).toEqual([workerSite.nextVersion]);
  await context.setOffline(false);
  await expectPersistentData(page);

  const outside = await context.newPage();
  await outside.goto(`${workerSite.origin}/outside.html`);
  expect(await outside.evaluate(() => navigator.serviceWorker.controller === null)).toBe(true);
  await outside.close();
});
