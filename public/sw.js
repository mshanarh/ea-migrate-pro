/**
 * Minimal service worker — installed ONLY so the browser considers
 * EA Migrate installable and fires `beforeinstallprompt` (Android Chrome
 * requires a registered service worker with a fetch handler before it will
 * offer the native "Install app" prompt).
 *
 * Deliberately NO caching: every request passes straight through to the
 * network. This keeps the app's no-stale-cache guarantee (see vercel.json
 * headers) — the worker never serves an old bundle.
 */
self.addEventListener("install", () => {
  // Skip waiting so the newest worker takes over immediately.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Pass-through: never cache, never serve from cache.
  event.respondWith(fetch(event.request));
});
