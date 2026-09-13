/* Frescoball Speed Meter application-shell cache. */
const CACHE_PREFIX = "frescoball-speed-shell-";
const CACHE_NAME = "frescoball-speed-shell-v32";
const APP_SHELL = [
  "./",
  "./index.html",
  "./measurement-spec.js",
  "./detection-engine.js",
  "./result-utils.js",
  "./motion-core.js",
  "./shot-analysis.js",
  "./ball-tracker.js",
  "./motion-review.js",
  "./video-quality.js",
  "./share-core.js",
  "./share-media.js",
  "./measurement-spec.json",
  "./manifest.webmanifest",
  "./icons/icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache => {
    const cached = await cache.match(request);
    // HTTPキャッシュのヒューリスティクス（Cache-Control無しの静的配信）で古い本文を
    // 掴んだままSWキャッシュを「更新」してしまうのを防ぐため、常にネットワークから取る。
    const refresh = fetch(request, { cache: "no-store" }).then(async response => {
      if (response && response.ok) await cache.put(request, response.clone());
      return response;
    }).catch(error => { if (cached) return cached; throw error; });
    if (cached) {
      event.waitUntil(refresh.catch(() => {}));
      return cached;
    }
    return refresh;
  }));
});
