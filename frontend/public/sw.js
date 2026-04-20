/**
 * Very small offline-shell service worker for the Skynity portal.
 *
 * Goals:
 *   1. Satisfy the PWA "installability" criteria so Chrome /
 *      Android fire the `beforeinstallprompt` event and the
 *      "Install app" banner can appear on the portal.
 *   2. Give users a usable "you're offline" experience on the
 *      portal pages (other than actual API calls, which always
 *      need the network).
 *
 * Strategy: network-first for HTML, cache-first for static
 * assets, never touch `/api/*` requests so mutations never
 * hit stale responses.
 */
const CACHE = 'skynity-v1';
const SHELL = ['/', '/portal', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => null)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return; // never intercept API

  // HTML → network first, fall back to cache
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(req, clone));
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match('/portal')))
    );
    return;
  }

  // Static assets → cache first
  event.respondWith(
    caches.match(req).then((cached) =>
      cached || fetch(req).then((res) => {
        const clone = res.clone();
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, clone));
        return res;
      })
    )
  );
});
