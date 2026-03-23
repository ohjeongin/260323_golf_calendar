// Service Worker — Golf Calendar
const CACHE = 'golf-calendar-v2';
const ASSETS = [
    './',
    './index.html',
    './index.css',
    './main.js',
    './js/tournament.js',
    './js/calendar.js',
    './js/modal.js',
    './js/notification.js',
    './data/tournaments.json',
    './manifest.json'
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    // tournaments.json은 항상 네트워크 우선
    if (e.request.url.includes('tournaments.json')) {
        e.respondWith(
            fetch(e.request).then(res => {
                const clone = res.clone();
                caches.open(CACHE).then(c => c.put(e.request, clone));
                return res;
            }).catch(() => caches.match(e.request))
        );
        return;
    }
    // 나머지는 캐시 우선
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request))
    );
});
