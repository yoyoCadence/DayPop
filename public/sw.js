/* Generated into public/sw.js by scripts/generate-release-assets.mjs. */
const APP_VERSION = '0.4.6';
const CACHE_PREFIX = 'daypop-app-shell-';
const CACHE_NAME = `${CACHE_PREFIX}${APP_VERSION}`;
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './icons/daypop.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_REMINDER_CAPABILITIES' && event.data.v === 1) {
    event.ports?.[0]?.postMessage({ type: 'REMINDER_CAPABILITIES', v: 1 });
  }
});

// DP-226: the sender's v1 wire contains only a stable hash, never private text.
const REMINDER_TAG_PREFIX = 'daypop-reminder-';
function reminderTag(data) {
  try {
    const value = data?.json();
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
        value.v !== 1 || typeof value.tag !== 'string' || value.tag.length !== 64 || !/^[a-f0-9]{64}$/.test(value.tag)) return null;
    return REMINDER_TAG_PREFIX + value.tag;
  } catch { return null; }
}

self.addEventListener('push', (event) => {
  const tag = reminderTag(event.data);
  if (!tag) return;
  event.waitUntil(self.registration.showNotification('日蹦 DayPop', {
    body: '有日曆提醒，開啟日蹦查看。',
    icon: new URL('./icons/daypop.svg', self.registration.scope).href,
    tag,
    renotify: false,
    data: { type: 'daypop-reminder', v: 1 },
  }));
});

async function focusReminderApp() {
  let scope;
  try { scope = new URL(self.registration.scope); } catch { return; }
  if (scope.origin !== self.location.origin || !scope.pathname.endsWith('/')) return;
  let windows;
  try { windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }); }
  catch { windows = []; }
  for (const client of windows) {
    try {
      const url = new URL(client.url);
      if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) continue;
      // Keep the current route and any unsaved form; focus without navigating.
      await client.focus();
      return;
    } catch { /* A closing client must not prevent another client or a fresh window. */ }
  }
  await self.clients.openWindow(scope.href);
}

self.addEventListener('notificationclick', (event) => {
  const note = event.notification;
  if (note?.data?.type !== 'daypop-reminder' || note.data.v !== 1 || typeof note.tag !== 'string' ||
      note.tag.length !== REMINDER_TAG_PREFIX.length + 64 || !note.tag.startsWith(REMINDER_TAG_PREFIX) ||
      !/^[a-f0-9]{64}$/.test(note.tag.slice(REMINDER_TAG_PREFIX.length))) return;
  note.close();
  event.waitUntil(focusReminderApp());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith('/version.json')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html').then((response) => response ?? caches.match('./'))),
    );
    return;
  }

  if (url.pathname.includes('/assets/') || url.pathname.includes('/icons/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
  }
});
