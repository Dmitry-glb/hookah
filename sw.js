const CACHE_NAME = 'dimhookah-pwa-v14';
const SHELL_ASSETS = [
    './',
    './index.html',
    './style.css',
    './ui.css',
    './lib/catalog-core.js',
    './app.js',
    './catalog-ui.js',
    './manifest.json',
    './icon.png'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            Promise.all(SHELL_ASSETS.map((url) => cache.add(url).catch(() => null)))
        )
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
            .then(() => {
                if (self.registration.navigationPreload) {
                    return self.registration.navigationPreload.enable();
                }
                return null;
            })
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

async function cacheFirst(request, event) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response && response.ok) {
        const clone = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)));
    }
    return response;
}

async function networkFirst(request, fallbackUrl) {
    try {
        const response = await fetch(request);
        if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
    } catch (error) {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (fallbackUrl) {
            const fallback = await caches.match(fallbackUrl);
            if (fallback) return fallback;
        }
        throw error;
    }
}

async function staleWhileRevalidate(request, event) {
    const cached = await caches.match(request);
    const network = fetch(request)
        .then((response) => {
            if (response && response.ok) {
                const clone = response.clone();
                event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)));
            }
            return response;
        })
        .catch(() => null);
    return cached || (await network) || new Response('', { status: 504, statusText: 'Offline' });
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request, './index.html'));
        return;
    }

    if (url.pathname.endsWith('/flavors.json')) {
        event.respondWith(staleWhileRevalidate(request, event));
        return;
    }

    event.respondWith(cacheFirst(request, event));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ('focus' in client) return client.focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow('./');
            return null;
        })
    );
});
