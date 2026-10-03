// Bump on every release so clients get the "Có bản mới — tải lại" banner.
const CACHE_VERSION = 'v2.0.0';
const CACHE = `len-can-${CACHE_VERSION}`;
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/ui.js',
  './js/db.js',
  './js/calc.js',
  './js/dom.js',
  './js/workout.js',
  './js/training.js',
  './data/foods.seed.js',
  './data/exercises.seed.js',
  './manifest.webmanifest',
  './icons/apple-touch-icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
  // No skipWaiting here: the page shows a banner and the user decides when to reload.
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('len-can-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./index.html').then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
