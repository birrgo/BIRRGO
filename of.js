const CACHE_NAME = 'birrgo-offline-v1';
const OFFLINE_URL = 'offline.html';

// Cache the offline fallback page on installation
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
        })
    );
    self.skipWaiting();
});

// Force active service worker activation immediately
self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Intercept network failures for ALL navigation requests
self.addEventListener('fetch', (event) => {
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).catch(() => {
                // Serve the cached offline page layout directly when network is down
                return caches.match(OFFLINE_URL).then((cachedResponse) => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    // Emergency plain-text fallback if cache fails
                    return new Response('Connection lost. Please reconnect to continue.', {
                        headers: { 'Content-Type': 'text/html' }
                    });
                });
            })
        );
    }
});
