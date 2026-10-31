// Keeps the app available offline. Your expenses are not here; they live in the phone's IndexedDB.
const CACHE = "expenses-shell-v7";
const SHELL = ["./", "./index.html", "./app.css", "./app.js", "./notebook.js", "./material.js", "./material.css", "./winui.js", "./winui.css", "./gnome.js", "./gnome.css", "./ios.js", "./ios.css", "./tags.js", "./local.js",
  "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

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
