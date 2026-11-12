/* TARGET legacy service worker — INERT (fix #6).
 * This file used to be Monetag's worker: it pulled in remote code hosted on
 * a third-party ad domain — arbitrary code running on the app origin. That is
 * removed. Nothing in the app registers /sw.js (the /app PWA uses /app-sw.js),
 * so this file now exists only as a kill switch: browsers that still have the
 * old worker registered fetch this update, activate it, and unregister —
 * after which no service worker controls this scope. It intercepts nothing,
 * caches nothing and imports nothing. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch { /* no caches to clear */ }
      try { await self.registration.unregister(); } catch { /* already gone */ }
      try { await self.clients.claim(); } catch { /* no clients */ }
    })()
  );
});
