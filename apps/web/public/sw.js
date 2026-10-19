/*
 * Wildcat Games service worker. Keeps the board's app shell and built assets
 * available if Chromium reloads while the local server restarts, so visitors
 * see the arcade's own "Reconnecting" screen instead of a browser error page.
 * API requests are never cached: scores and puzzles always come from the server.
 */
const CACHE = "wg-shell-v1";
const SHELL = ["/play", "/brand/weekly-wildcat-wide-logo.svg", "/brand/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin") || url.pathname === "/health") return;

  // The kiosk page: network first so updates land, cached copy when the server is down.
  if (req.mode === "navigate" && (url.pathname === "/play" || url.pathname.startsWith("/play/"))) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put("/play", res.clone()));
          return res;
        })
        .catch(() => caches.match("/play")),
    );
    return;
  }

  // Hashed build assets and brand files never change: cache first.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/brand/") || url.pathname.startsWith("/uploads/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
