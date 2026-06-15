var CACHE = 'sentinel-v5-r1';
var ASSETS = ['/', '/index.html', '/view.html', '/css/control.css',
  '/js/satellites.js', '/js/stars.js', '/js/renderer.js', '/js/renderer-view.js',
  '/js/api-layer.js', '/js/tracker.js', '/js/control.js',
  '/js/audio.js', '/js/weather.js', '/js/notifications.js'];
self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE).then(function(c) { return c.addAll(ASSETS); }));
});
self.addEventListener('activate', function(e) {
  e.waitUntil(caches.keys().then(function(ks) {
    return Promise.all(ks.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
  }));
});
self.addEventListener('fetch', function(e) {
  e.respondWith(caches.match(e.request).then(function(r) {
    return r || fetch(e.request).catch(function() { return caches.match('/index.html'); });
  }));
});
