const CACHE_NAME = 'birrgo-offline-v2';
const JS_OFFLINE_INJECTOR = 'off.js';

// Cache the off.js file on installation
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.add(new Request(JS_OFFLINE_INJECTOR, { cache: 'reload' }))
                .catch((err) => console.log("Offline script caching failed: ", err));
        })
    );
    self.skipWaiting();
});

// Force active service worker activation immediately across all open tabs
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Intercept network failures for navigation and asset requests
self.addEventListener('fetch', (event) => {
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).catch(async () => {
                // 1. Try to serve the cached version of the exact requested page first
                const cachedPage = await caches.match(event.request);
                if (cachedPage) {
                    return cachedPage;
                }

                // 2. If the page isn't in cache, return an HTML wrapper that automatically loads off.js over the view
                return new Response(
                    `<!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Connection Lost | BirrGo</title>
                        <link rel="preconnect" href="https://fonts.googleapis.com">
                        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
                        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
                    </head>
                    <body>
                        <script src="${JS_OFFLINE_INJECTOR}"></script>
                    </body>
                    </html>`,
                    {
                        headers: { 'Content-Type': 'text/html' }
                    }
                );
            })
        );
    } else {
        // Fallback for static assets (e.g., off.js itself) when offline
        event.respondWith(
            fetch(event.request).catch(() => caches.match(event.request))
        );
    }
});
