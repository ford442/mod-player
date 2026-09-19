/// <reference lib="webworker" />

// Service Worker for MOD Player
// This SW is scope-aware and works under any base path (e.g., /xm-player/)

// v6: libmpt/ (wasm2js) → worklets/libopenmpt-worklet.{js,wasm}; also purges the old libmpt cache entries.
const CACHE_NAME = 'mod-player-v6';

// Get the scope (base path) from the service worker's registration
const getScope = () => self.registration.scope || '/';

// Build precache URLs relative to the scope
const getPrecacheUrls = () => {
  const scope = getScope();
  // Ensure scope ends with /
  const base = scope.endsWith('/') ? scope : scope + '/';
  // libopenmpt-worklet.{js,wasm} are NOT precached: they are requested with a content-hash ?v=
  // (utils/libopenmptAssets.ts), so an unversioned precache entry would never match. They are
  // cached on first use below, keyed by that versioned URL, so a rebuilt .wasm can never be
  // served next to a stale glue.
  return [
    base,
    base + 'index.html',
  ];
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(getPrecacheUrls()))
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
  const isLibOpenMPT = /\/worklets\/libopenmpt-worklet\.(js|wasm)$/i.test(url.pathname);
  const isModuleFile = /\.(mod|xm|s3m|it|mptm|wasm)$/i.test(url.pathname);

  if (isLibOpenMPT || isModuleFile) {
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
