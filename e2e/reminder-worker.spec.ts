import { expect, test } from '@playwright/test';
import { startWorkerSite } from './fixtures/workerSite';
import { monitorBrowser } from './support';

// The headless shell reports Permissions.granted but Notification.denied.
// Full Chromium's new headless mode exercises the real notification API.
test.use({ channel: 'chromium' });

test('worker 提供公開提醒協定，未知版本不回答且不改權限或訂閱', async ({ page }) => {
  const site = await startWorkerSite(), clean = monitorBrowser(page);
  try {
    await page.goto(`${site.origin}/DayPop/`);
    await page.evaluate(async () => { await navigator.serviceWorker.register('/DayPop/sw.js', { scope: '/DayPop/' }); await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state)).toBe('activated');
    const observed = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready, worker = registration.active!;
      const before = Notification.permission;
      localStorage.setItem('daypop.user-data', 'protocol-check-unchanged');
      const ask = (version: number) => new Promise<unknown>(resolve => {
        const channel = new MessageChannel();
        const finish = (value: unknown) => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(value); };
        const timer = setTimeout(() => finish(null), 1500);
        channel.port1.onmessage = event => finish(event.data);
        worker.postMessage({ type: 'GET_REMINDER_CAPABILITIES', v: version }, [channel.port2]);
      });
      return { supported: await ask(1), unknown: await ask(2), sameWorker: registration.active === worker,
        waiting: registration.waiting === null, permissionUnchanged: Notification.permission === before,
        noSubscription: await registration.pushManager.getSubscription() === null,
        bytes: localStorage.getItem('daypop.user-data'), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    });
    expect(observed, 'Real worker advertises reminder v1').toEqual({ supported: { type: 'REMINDER_CAPABILITIES', v: 1 }, unknown: null, sameWorker: true,
      waiting: true, permissionUnchanged: true, noSubscription: true, bytes: 'protocol-check-unchanged', timezone: 'Asia/Taipei' });
    console.log('DP-228 actual browser timezone:', observed.timezone); clean();
  } finally { await site.close(); }
});

test('真正 worker 的匿名通知、穩定 tag 與冷啟動，未建立推播訂閱', async ({ page, context }) => {
  const site = await startWorkerSite();
  const clean = monitorBrowser(page), external: string[] = [], workerErrors: string[] = [];
  const cdp = await context.newCDPSession(page);
  const registrations = new Map<string, { registrationId: string; scopeURL: string }>();
  const versions = new Map<string, { versionId: string; registrationId: string; status: string; runningStatus: string }>();
  cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations: items }) => items.forEach(item => registrations.set(item.registrationId, item)));
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions: items }) => items.forEach(item => versions.set(item.versionId, item)));
  cdp.on('ServiceWorker.workerErrorReported', () => workerErrors.push('worker error'));
  try {
    await context.grantPermissions(['notifications'], { origin: site.origin });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === site.origin) return route.continue();
      external.push('unexpected external request'); return route.abort();
    });
    await cdp.send('ServiceWorker.enable');
    await page.goto(`${site.origin}/DayPop/`);
    await expect(page.getByRole('heading', { name: `Worker fixture ${site.currentVersion}`, exact: true })).toBeVisible();
    expect(await page.title()).toBe('Worker fixture');
    expect(await page.evaluate(() => Notification.permission)).toBe('granted');
    console.log('DP-226 actual browser timezone:', await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
    await page.evaluate(async () => { await navigator.serviceWorker.register('/DayPop/sw.js', { scope: '/DayPop/' }); await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state)).toBe('activated');
    await expect.poll(() => [...registrations.values()].some(item => item.scopeURL === `${site.origin}/DayPop/`)).toBe(true);
    const registration = [...registrations.values()].find(item => item.scopeURL === `${site.origin}/DayPop/`)!;
    const send = (hash: string) => cdp.send('ServiceWorker.deliverPushMessage', { origin: site.origin, registrationId: registration.registrationId, data: JSON.stringify({ v: 1, tag: hash }) });
    const notices = () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(note => ({
      title: note.title, body: note.body, tag: note.tag, icon: note.icon, data: note.data,
    })));
    const hash = 'a'.repeat(64);
    await send(hash);
    await expect.poll(notices, { message: 'Real worker displays anonymous notification' }).toEqual([{
      title: '日蹦 DayPop', body: '有日曆提醒，開啟日蹦查看。', tag: `daypop-reminder-${hash}`,
      icon: `${site.origin}/DayPop/icons/daypop.svg`, data: { type: 'daypop-reminder', v: 1 },
    }]);
    await send(hash);
    await expect.poll(async () => (await notices()).length).toBe(1);

    await expect.poll(() => [...versions.values()].some(item => item.registrationId === registration.registrationId && item.status === 'activated' && item.runningStatus === 'running')).toBe(true);
    const version = [...versions.values()].find(item => item.registrationId === registration.registrationId && item.status === 'activated' && item.runningStatus === 'running')!;
    await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId });
    await expect.poll(() => versions.get(version.versionId)?.runningStatus).toBe('stopped');
    await send('b'.repeat(64));
    await expect.poll(async () => (await notices()).map(note => note.tag).sort(), { message: 'Push starts the stopped actual worker' }).toEqual([
      'daypop-reminder-' + 'a'.repeat(64), 'daypop-reminder-' + 'b'.repeat(64),
    ]);
    expect(await page.evaluate(async () => (await (await navigator.serviceWorker.ready).pushManager.getSubscription()) === null)).toBe(true);
    expect(external).toEqual([]); expect(workerErrors).toEqual([]); clean();
  } finally {
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/DayPop/');
      if (registration) for (const note of await registration.getNotifications()) note.close();
    }).catch(() => {});
    await cdp.detach(); await site.close();
  }
});
