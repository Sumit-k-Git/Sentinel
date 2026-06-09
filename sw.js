// Service Worker — offline demo mode support
const CACHE = 'sentinel-v3';
const ASSETS = ['/', '/index.html', '/view.html', '/css/control.css', '/js/satellites.js', '/js/stars.js', '/js/renderer.js', '/js/renderer-view.js', '/js/tracker.js', '/js/control.js', '/js/audio.js', '/js/weather.js', '/js/notifications.js'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))));
self.addEventListener('fetch', e => e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('/index.html')))));
