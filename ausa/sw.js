/* Offline cache for the AUSA floor-walk app (convention-center Wi-Fi is unreliable). */
const CACHE = 'ausa-walk-v3';
const ASSETS = ['./', 'index.html', 'app.css', 'app.js', 'data.enc', 'map-day1.jpg', 'map-day2.jpg', 'plan-day1.jpg', 'plan-day2.jpg', 'icon.svg', 'manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('ausa-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Network first so updates land when online; fall back to the cache on the show floor.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
