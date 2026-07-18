/*
 * Workoutt service worker — makes the app installable and fully usable
 * offline. All data lives in IndexedDB (the service worker never touches
 * it); this only caches the static shell.
 *
 * Strategy:
 *  - navigations: network-first, falling back to the cached page (then /)
 *  - assets:      stale-while-revalidate
 *
 * Bump CACHE_VERSION to invalidate everything after a breaking change.
 */
const CACHE_VERSION = 'workoutt-v4';

// The app may be hosted under a sub-path (e.g. GitHub Pages /workoutt/). The
// SW file lives at `<base>sw.js`, so its own path yields the base.
const BASE = self.location.pathname.replace(/sw\.js$/, ''); // '/' or '/workoutt/'

// Never cache dev-server module URLs — serving them stale breaks the app
// after code changes. (The worker shouldn't be registered in dev at all,
// but belt and braces.)
const UNCACHEABLE = [/\/src\//, /\/@/, /\/node_modules\//];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Web Push (notifications.md). The server sends a JSON payload
// {title, body, url, tag}; show it, and route a click to the workout.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Workoutt', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Workoutt';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag,
      data: { url: data.url || BASE },
      badge: BASE + 'icon.svg',
      icon: BASE + 'icon.svg',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || BASE;
  const url = new URL(target, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        // Reuse an open tab if we have one.
        if ('focus' in client) {
          client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  if (UNCACHEABLE.some((re) => re.test(url.pathname))) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match(BASE))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
