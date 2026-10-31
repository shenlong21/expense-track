// Keeps the app available offline. Your expenses are not here; they live in the phone's IndexedDB.
const CACHE = "expenses-shell-v46";
const SHELL = ["./", "./index.html", "./manifest.webmanifest",
  "./css/app.css", "./css/views/material.css", "./css/views/winui.css", "./css/views/ios.css",
  "./js/local.js", "./js/app.js", "./js/tags.js",
  "./js/views/notebook.js", "./js/views/material.js", "./js/views/winui.js", "./js/views/ios.js",
  "./icons/icon-rounded.svg", "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/icon-maskable-192.png", "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Network first so a new version shows up as soon as you are online; the cache covers offline.
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html"))));
});
