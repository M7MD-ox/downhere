/**
 * DownMe Progressive Web App Service Worker
 * Milestone M3: PWA, iOS Integration & Smart UX
 *
 * Cache Strategy:
 * - downme-v1 cache namespace
 * - Cache-First for static assets, scripts, stylesheets, and local Thmanyah fonts (/fonts/*.otf)
 * - Stale-While-Revalidate for HTML navigations with graceful fallback to /offline.html
 * - Network-Only for /api/* requests so media extraction and status are always live
 */

const CACHE_NAME = 'downhere-v10';

// Critical precache assets required for instant offline booting
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  // Stylesheets
  '/css/thmanyah-typography.css',
  '/css/apple-theme.css',
  '/css/components.css',
  // Scripts
  '/js/app.js',
  '/js/api.js',
  '/js/preview.js',
  '/js/trimmer.js',
  '/js/dragdrop.js',
  '/js/clipboard.js',
  '/js/share-target.js',
  // Thmanyah Sans & Kracken local font assets
  '/fonts/Kracken-BLz2G.woff',
  '/fonts/thmanyahsans-Regular.otf',
  '/fonts/thmanyahsans-Bold.otf',
  '/fonts/thmanyahsans-Medium.otf',
  '/fonts/thmanyahsans-Light.otf',
  '/fonts/thmanyahsans-Black.otf',
  // PWA & Apple icons
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/icon-maskable-512x512.png',
  '/icons/apple-touch-icon-180x180.png',
  '/icons/favicon.svg',
  '/icons/favicon.png'
];

/**
 * Installation Event:
 * Pre-caches shell resources, typography, and offline screen.
 * Safely handles individual items so temporary missing files never block activation.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        PRECACHE_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[ServiceWorker] Precache warning for ${url}:`, err.message);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/**
 * Activation Event:
 * Evicts previous cache versions and claims active clients immediately.
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME && name !== 'downhere-ffmpeg-v1') {
            console.log(`[ServiceWorker] Deleting obsolete cache: ${name}`);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

/**
 * Fetch Event Dispatcher:
 * Routes requests according to URL pathname, destination, and request mode.
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. Bypass non-GET requests (e.g. POST /api/extract, POST /api/download/zip)
  if (request.method !== 'GET') {
    return;
  }

  // 2. Network-Only for /api/* requests — media extraction must NEVER be stale or cached
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'You are currently offline. Connect to the internet to extract and download media.',
            offline: true
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      })
    );
    return;
  }

  // 3. Network-First for HTML, JS, and CSS so updates apply immediately on refresh
  const isFreshAsset =
    request.mode === 'navigate' ||
    (request.headers.get('accept') && request.headers.get('accept').includes('text/html')) ||
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/css/') ||
    url.pathname === '/manifest.webmanifest';

  if (isFreshAsset) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          const cachedResponse = await cache.match(request);
          if (cachedResponse) return cachedResponse;
          if (request.mode === 'navigate') {
            const offlineFallback = await cache.match('/offline.html');
            if (offlineFallback) return offlineFallback;
          }
          return new Response('<h1>downhere — Offline</h1><p>Please check your internet connection.</p>', {
            status: 503,
            headers: { 'Content-Type': 'text/html' }
          });
        }
      })()
    );
    return;
  }

  // 4. Cache-First for static fonts and icons
  const isStaticAsset =
    url.pathname.startsWith('/fonts/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/shortcuts/') ||
    request.destination === 'font' ||
    request.destination === 'image';

  if (isStaticAsset) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(request);

        if (cachedResponse) {
          return cachedResponse;
        }

        try {
          const networkResponse = await fetch(request);
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'basic')) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          // If offline and requesting an image, try returning the default app icon
          if (request.destination === 'image') {
            const fallbackIcon = await cache.match('/icons/icon-192x192.png');
            if (fallbackIcon) return fallbackIcon;
          }
          return new Response('Resource unavailable offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
          });
        }
      })()
    );
    return;
  }

  // Default fallback for any other requests: cache match, then network
  event.respondWith(
    caches.match(request).then((response) => response || fetch(request))
  );
});

/**
 * Message Event:
 * Allows page to trigger skipWaiting on demand.
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
