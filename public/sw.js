/// <reference lib="webworker" />

const CACHE_NAME = 'mod-player-v1';
const PRECACHE_URLS = [
  '/xm-player/',
  '/xm-player/index.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Cache module files (.mod, .xm, .s3m, .it) and WASM
  const url = new URL(event.request.url);
  const isModuleFile = /\.(mod|xm|s3m|it|mptm|wasm)$/i.test(url.pathname);

  if (isModuleFile) {
    // Cache-first for module files
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
  } else {
    // Network-first for everything else
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request).then((r) => r || new Response('Offline', { status: 503 })))
    );
  }
});
