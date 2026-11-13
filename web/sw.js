/* Offline shell: the app opens even with no signal. Game data always comes live from Supabase. */
const VERSION = "poulet-v1";
const SHELL = ["./", "index.html", "config.js", "data.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== "tiles").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.hostname.endsWith("supabase.co") || url.hostname.endsWith("supabase.in")) return;
  // Map tiles: cache as you browse, so the area you've seen still shows with weak signal.
  if (url.hostname === "tile.openstreetmap.org") {
    e.respondWith(caches.open("tiles").then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  // App files: network first (so updates arrive), fall back to cache offline.
  e.respondWith(fetch(req).then(r => {
    if (r.ok && (url.origin === location.origin || SHELL.includes(req.url))) caches.open(VERSION).then(c => c.put(req, r.clone()));
    return r;
  }).catch(() => caches.match(req).then(h => h || caches.match("index.html"))));
});
