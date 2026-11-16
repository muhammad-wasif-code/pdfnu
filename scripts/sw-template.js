/* PDFSherpa service worker — generated at build time by scripts/postbuild.mjs. Never touches user files. */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const SHELL = 'pdfsherpa-shell-' + VERSION;
const RUNTIME = 'pdfsherpa-runtime-v1'; // long-lived: versioned /vendor/ engines (Ghostscript WASM, pdf.js data)
const PAGES = 'pdfsherpa-pages-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting()), // one missing URL must not break offline support for everything else
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // drop old shell versions, plus caches from before the PDFNU → PDFSherpa rename
      .then((keys) => Promise.all(keys.filter((k) => (k.startsWith('pdfsherpa-shell-') && k !== SHELL) || k.startsWith('pdfnu-')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const sameOrigin = (url) => url.origin === self.location.origin;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!sameOrigin(url) || url.pathname.startsWith('/__test__/')) return; // ads & third parties: network only

  // Hashed build assets and versioned engines: cache-first, forever
  if (url.pathname.startsWith('/_astro/') || url.pathname.startsWith('/vendor/')) {
    event.respondWith(cacheFirst(req, url.pathname.startsWith('/vendor/') ? RUNTIME : SHELL));
    return;
  }

  // Pages: network-first (fresh content), fall back to cache when offline
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstPage(req, url));
    return;
  }

  // Everything else (icons, manifest…): stale-while-revalidate
  event.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) caches.open(PAGES).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});

async function cacheFirst(req, cacheName) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') (await caches.open(cacheName)).put(req, res.clone());
  return res;
}

async function networkFirstPage(req, url) {
  const key = url.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(req, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) (await caches.open(PAGES)).put(key, res.clone());
    return res;
  } catch {
    return (await caches.match(key)) || (await caches.match('/')) || new Response('You are offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}
