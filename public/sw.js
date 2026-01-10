const VERSION = "v1";
const APP_SHELL = ["/", "/heatmap", "/wallet", "/offline"];

const STATIC_CACHE = `static-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;
const API_CACHE = `api-${VERSION}`;
const TILE_CACHE = `tiles-${VERSION}`;

const TILE_MAX_ENTRIES = 300;
const TILE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !key.includes(VERSION))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, STATIC_CACHE, "/offline"));
    return;
  }

  if (url.pathname.startsWith("/_next/static") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (url.pathname.startsWith("/api/signals/")) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  if (url.hostname.endsWith("tile.openstreetmap.org")) {
    event.respondWith(staleWhileRevalidateTiles(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) {
        return fallback;
      }
    }
    throw error;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  return cached ?? (await fetchPromise);
}

async function staleWhileRevalidateTiles(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  const cachedAge = cached ? getCacheAgeSeconds(cached) : null;
  const isFresh = cachedAge !== null && cachedAge <= TILE_MAX_AGE_SECONDS;

  const updatePromise = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        await putWithTimestamp(cache, request, response);
        await trimCache(cache, TILE_MAX_ENTRIES);
      }
      return response;
    })
    .catch(() => undefined);

  if (cached && isFresh) {
    return cached;
  }

  const networkResponse = await updatePromise;
  if (networkResponse) {
    return networkResponse;
  }
  return cached ?? new Response("Offline", { status: 503 });
}

function getCacheAgeSeconds(response) {
  const timestamp = response.headers.get("sw-cache-time");
  if (!timestamp) {
    return null;
  }
  const ageMs = Date.now() - Number(timestamp);
  return Math.max(0, Math.floor(ageMs / 1000));
}

async function putWithTimestamp(cache, request, response) {
  const cloned = response.clone();
  const body = await cloned.arrayBuffer();
  const headers = new Headers(cloned.headers);
  headers.set("sw-cache-time", Date.now().toString());
  const cachedResponse = new Response(body, {
    status: cloned.status,
    statusText: cloned.statusText,
    headers
  });
  await cache.put(request, cachedResponse);
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) {
    return;
  }
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
}
