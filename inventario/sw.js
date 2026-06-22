const CACHE_NAME = "inventario-sigcf-v4";
const ASSET_VER = "4";
const APP_SHELL = [
  "./index.html",
  `./config.js?v=${ASSET_VER}`,
  "./styles.css",
  `./scanner.js?v=${ASSET_VER}`,
  `./app.js?v=${ASSET_VER}`,
  "./manifest.webmanifest",
  "./data/medicamentos_pecuaria.json",
  "./data/piloto_1_item.json",
  "https://i.postimg.cc/Y9X7ddnb/LOGO-BP.jpg",
  "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function sameOrigin(url) {
  try {
    return new URL(url).origin === self.location.origin;
  } catch {
    return false;
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = event.request.url;
  const isApp =
    sameOrigin(url) ||
    url.includes("postimg.cc") ||
    url.includes("cdn.jsdelivr.net/npm/html5-qrcode");

  if (!isApp) return;

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            }
            return response;
          })
          .catch(() => cached)
    )
  );
});
