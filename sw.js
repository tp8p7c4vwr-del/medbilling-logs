/* Offline cache for Med Billing Logs. Same-origin GET only; the app has no network calls with data.
   App shell is network-first (updates show immediately), falling back to cache offline. */
const V = 'bl-v1-2026-10-04';
const ASSETS = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/vault.js', 'js/search.js', 'js/docx.js', 'js/report.js', 'js/vendor/jspdf.umd.min.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/icon-maskable-512.png',
  'data/codes-index.json', 'data/facilities.json', 'data/codes-AB.json', 'data/codes-MB.json', 'data/codes-NL.json', 'data/codes-NS.json', 'data/codes-SK.json', 'data/codes-NT.json', 'data/codes-YT.json'];
self.addEventListener('install', e => e.waitUntil(
  caches.open(V).then(c => Promise.all(ASSETS.map(a => fetch(new Request(a, { cache: 'reload' })).then(r => { if (r.ok) return c.put(a, r); }))))
    .then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(V).then(c => c.put(e.request.mode === 'navigate' ? './' : e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === 'navigate' ? caches.match('./') : undefined))));
});
