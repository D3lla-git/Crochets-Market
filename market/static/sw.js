/* =====================================================================
   Crochets Market — service worker.
   Makes the app open fast and keep working on weak connections.
   Bump VERSION whenever you change files so phones pick up the update.
   ===================================================================== */
const VERSION = "cm-v11";
const SHELL = [
  "/", "/config.js", "/manifest.webmanifest",
  "/static/css/base.css", "/static/css/shop.css", "/static/css/market.css", "/static/css/mobile.css",
  "/static/js/theme.js", "/static/js/core.js", "/static/js/api.js", "/static/js/art.js", "/static/js/consent.js", "/static/js/shop.js",
  "/static/icons/icon-192.png", "/static/icons/icon-512.png", "/static/icons/logo.png", "/static/icons/apple-touch-icon.png"
];
// Never cached: live data, the dashboard, sign-up and customers' private photos.
// Receipts (/r/…) and "My orders" hold buyers' details, so they are never stored on the device either.
const NEVER_CACHE = /^\/(api\/|admin|dashboard|uploads\/orders\/|r\/|orders|ads\.txt|sitemap\.xml)/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function putInCache(req, res) {
  if (res && res.ok && res.type === "basic") {
    const copy = res.clone();
    caches.open(VERSION).then((c) => c.put(req, copy));
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                 // never touch order submissions
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;       // fonts, WhatsApp, Google: straight to network
  if (NEVER_CACHE.test(url.pathname)) return;

  // Pages, scripts & styles: network first so updates show up; cache when offline.
  if (req.mode === "navigate" || /\.(html|js|css|webmanifest)$/.test(url.pathname)) {
    e.respondWith(
      fetch(req)
        .then((res) => putInCache(req, res))
        .catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("/") : undefined)))
    );
    return;
  }

  // Images & icons: cache first.
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => putInCache(req, res))));
});

// Tapping a new-order alert opens (or focuses) the seller dashboard on the Orders page.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "/admin#orders";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    const open = wins.find((w) => new URL(w.url).pathname.startsWith("/admin"));
    if (open) return open.focus().then((w) => w && w.navigate ? w.navigate(target) : w);
    return self.clients.openWindow(target);
  }));
});
