const CACHE_NAME = 'dimhookah-pwa-v25-print';
const SHELL_ASSETS = [
    './',
    './index.html',
    './style.css',
    './ui.css',
    './comics.css',
    './comics-photo.css',
    './experience.css',
    './assets/warmup-ink.svg',
    './experience.js',
    './cloud-sync.js',
    './assets/fonts/Underdog-Regular.ttf',
    './assets/icons/app-icon-v24-192.png',
    './assets/icons/app-icon-v24-512.png',
    './assets/icons/app-icon-v24-maskable-512.png',
    './lib/catalog-core.js',
    './lib/preheat-config.js',
    './app.js',
    './catalog-ui.js',
    './manifest.json',
    './manifest-light.json'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            const results = await Promise.all(
                SHELL_ASSETS.map((url) => cache.add(url).then(() => true).catch(() => false))
            );
            if (results.some((ok) => !ok)) {
                throw new Error('Не удалось закешировать оболочку PWA');
            }
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        const hadOldCache = keys.some((key) => key.startsWith('dimhookah-pwa-') && key !== CACHE_NAME);
        await Promise.all(
            keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        );
        await self.clients.claim();
        if (self.registration.navigationPreload) {
            await self.registration.navigationPreload.enable();
        }
        // При обновлении со старой версии принудительно перезагружаем открытые
        // окна PWA: старый app.js ещё не умеет слушать controllerchange.
        if (hadOldCache) {
            const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => null)));
        }
    })());
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

    // Код и стили всегда сначала проверяем по сети, чтобы обновление PWA
    // не застревало в старом cache-first кеше. Офлайн — fallback из кеша.
    if (/\.(?:js|css|html|json)$/i.test(url.pathname)) {
        event.respondWith(networkFirst(request));
        return;
    }

    event.respondWith(cacheFirst(request, event));
});

self.addEventListener('push', event => {
    let data = {};
    try { data = event.data?.json() || {}; } catch { }
    event.waitUntil(self.registration.showNotification(data.title || 'DimHookah', {
        body: data.body || 'Открой приложение, чтобы проверить сессию.',
        tag: data.tag || 'dimhookah-timer-alert',
        icon: './assets/icons/app-icon-v24-192.png',
        badge: './assets/icons/app-icon-v24-192.png',
        data: { url: './index.html#timer' }
    }));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ('focus' in client) return client.navigate(new URL('./index.html#timer', self.registration.scope).href).then(() => client.focus());
            }
            if (self.clients.openWindow) return self.clients.openWindow('./index.html#timer');
            return null;
        })
    );
});
