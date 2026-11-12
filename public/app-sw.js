/* TARGET workspace service worker. Registered only from /app pages with scope "/app".
 * (public/sw.js is a separate legacy file, now an inert no-op, and is not related to this worker.)
 * Minimal on purpose: it never caches API responses or signed-in pages. It only caches the
 * offline page and icons, and shows the offline page when a /app navigation fails. */
const CACHE = "target-app-v4";
const OFFLINE = "/app-offline.html";
const PRECACHE = [OFFLINE, "/logo-mark.svg", "/app-icon-192.png", "/app-icon-maskable-512.png", "/app-badge-96.png"];

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

// Phone notifications: scheduled work finished, site error alerts for the owner, test pings.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  const title = data.title || "TARGET";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    icon: "/app-icon-192.png",
    badge: "/app-badge-96.png",
    tag: data.tag || undefined,
    data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/app" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && "focus" in c) { c.navigate(url); return c.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
