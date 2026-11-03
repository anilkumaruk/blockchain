// Service worker for the installable student wallet (PWA). It keeps the app
// shell available offline. API calls, blockchain RPC and IPFS are never
// cached: a verification result must always come live from the source.
const CACHE = 'cor-shell-v1';
const SHELL = ['/', '/student', '/verify', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    // Pages: network first, the cached shell when offline.
    event.respondWith(fetch(event.request).catch(() => caches.match('/student').then((r) => r || caches.match('/'))));
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    // Built files have content hashes in their names: cache first is safe.
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
            return res;
          })
      )
    );
  }
});
