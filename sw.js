// Keeps the app available offline. Your expenses are not here; they live in the phone's IndexedDB.
const CACHE = "expenses-shell-v62";
const SHELL = ["./", "./index.html", "./manifests/main.webmanifest", "./manifests/notebook.webmanifest", "./manifests/material.webmanifest",
  "./manifests/winui.webmanifest", "./manifests/ios.webmanifest",
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== "prefs").map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

// The installed app's navigation bar colour comes from its manifest, and Chrome only updates an installed app
// from the same manifest URL. So manifests/main.webmanifest is the one URL, answered with the manifest of the
// view chosen in the app (saved by app.js in the "prefs" cache).
const VIEWS = ["main", "notebook", "material", "winui", "ios"];
async function chosenManifest(request) {
  const saved = await caches.open("prefs").then((c) => c.match("home")).then((r) => (r ? r.text() : "main"));
  const file = new URL(`manifests/${VIEWS.includes(saved) ? saved : "main"}.webmanifest`, self.registration.scope).href;
  const res = await fetch(file, { cache: "no-cache" }).catch(() => caches.match(file));
  if (!res || !res.ok) return fetch(request);
  return new Response(await res.text(), { headers: { "Content-Type": "application/manifest+json" } });
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.endsWith("/manifests/main.webmanifest")) { e.respondWith(chosenManifest(e.request)); return; }
  // Network first so a new version shows up as soon as you are online; the cache covers offline.
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html"))));
});
