/* TARGET workspace service worker. Registered only from /app pages with scope "/app".
 * (public/sw.js is a separate Monetag file and is not related to this worker.)
 * Minimal on purpose: it never caches API responses or signed-in pages. It only caches the
 * offline page and icons, and shows the offline page when a /app navigation fails. */
const CACHE = "target-app-v1";
const OFFLINE = "/app-offline.html";
const PRECACHE = [OFFLINE, "/app-icon-192.png", "/app-icon-maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("target-app-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate" && (url.pathname === "/app" || url.pathname.startsWith("/app/"))) {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE).then((r) => r || Response.error())));
    return;
  }
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(req).then((r) => r || fetch(req)));
  }
});
