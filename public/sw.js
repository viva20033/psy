/* PWA service worker: кэшируем "оболочку" приложения, API оставляем сетевым. */
const CACHE_VERSION = "psy-cabinet-shell-v1";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // addAll упадёт, если что-то не существует. Это ок — тогда SW не установится.
      await cache.addAll(APP_SHELL);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_VERSION ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

function isApiRequest(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/api/");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API — всегда из сети (чтобы не показывать устаревшие данные),
  // но если сеть недоступна — пробуем взять из кэша (если вдруг уже было).
  if (isApiRequest(url)) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          return res;
        } catch {
          const cached = await caches.match(req, { ignoreSearch: false });
          if (cached) return cached;
          return new Response(JSON.stringify({ ok: false, error: "offline" }), {
            status: 503,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          });
        }
      })()
    );
    return;
  }

  // Навигации: стараемся получить свежий HTML, иначе — кэш (офлайн режим).
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_VERSION);
          cache.put("/index.html", fresh.clone());
          return fresh;
        } catch {
          return (await caches.match("/index.html")) || Response.error();
        }
      })()
    );
    return;
  }

  // Остальная статика: cache-first.
  event.respondWith(
    (async () => {
      const cached = await caches.match(req, { ignoreSearch: false });
      if (cached) return cached;
      const res = await fetch(req);
      const cache = await caches.open(CACHE_VERSION);
      cache.put(req, res.clone());
      return res;
    })()
  );
});

