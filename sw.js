const CACHE = 'sentinel-v4';
const ASSETS = [
  '/', '/index.html', '/view.html',
  '/css/control.css',
  '/js/satellites.js', '/js/stars.js',
  '/js/renderer.js', '/js/renderer-view.js',
  '/js/tracker.js', '/js/control.js',
  '/js/audio.js', '/js/weather.js', '/js/notifications.js',
];
self.addEventListener('install',  e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',    e => e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).catch(()=>caches.match('/index.html')))));
