const CACHE_NAME = "inventario-sigcf-v6";
const ASSET_VER = "6";
const APP_SHELL = [
  "./index.html",
  "./painel.html",
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

const NETWORK_FIRST = /\/(index\.html|app\.js|config\.js|scanner\.js|sw\.js)(\?|$)/;

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

function isAppUrl(url) {
  return (
    sameOrigin(url) ||
    url.includes("postimg.cc") ||
    url.includes("cdn.jsdelivr.net/npm/html5-qrcode")
  );
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = event.request.url;
  if (!isAppUrl(url)) return;

  if (NETWORK_FIRST.test(url)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

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
