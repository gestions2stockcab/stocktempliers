// SimSimStock - service worker : notifications + ouverture hors connexion.
// A placer a cote de index.html, a la racine du site. Changer VERSION a chaque nouvelle version de l'appli.
var VERSION = "v127";
var SHELL = "simsim-shell-" + VERSION, LIBS = "simsim-libs", DATA = "simsim-data";
var PRECACHE = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "apple-touch-icon.png",
  "vendor.js", "vendor-pdf-worker.js"];
var CDN_HOSTS = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return Promise.all(PRECACHE.map(function (u) { return c.add(u).catch(function () { return null; }); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (k) { return k.indexOf("simsim-shell-") === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("message", function (e) { if (e.data && e.data.type === "clear-data") caches.delete(DATA); });

function timeout(ms) { return new Promise(function (_r, rej) { setTimeout(function () { rej(new Error("delai")); }, ms); }); }
function store(name, req, res) { if (res && (res.ok || res.type === "opaque")) { var copy = res.clone(); caches.open(name).then(function (c) { c.put(req, copy); }).catch(function () {}); } return res; }
function networkFirst(req, name, key, ms) {
  return Promise.race([fetch(req), timeout(ms || 6000)]).then(function (res) { return store(name, key || req, res); }, function () {
    return caches.open(name).then(function (c) { return c.match(key || req, { ignoreSearch: !!key }); }).then(function (hit) { if (hit) return hit; throw new Error("hors-ligne"); });
  });
}
function cacheFirst(req, name) { return caches.match(req).then(function (hit) { return hit || fetch(req).then(function (res) { return store(name, req, res); }); }); }
function revalidate(req, name) {
  return caches.open(name).then(function (c) { return c.match(req).then(function (hit) { var net = fetch(req).then(function (res) { return store(name, req, res); }).catch(function () { return hit; }); return hit || net; }); });
}

self.addEventListener("fetch", function (e) {
  var req = e.request; if (req.method !== "GET") return;
  var url = new URL(req.url), same = url.origin === self.location.origin;
  if (same) {
    var path = url.pathname.replace(/\/+$/, "");
    var isPage = req.mode === "navigate" || /\/(index\.html)?$/.test(url.pathname);
    if (isPage) { e.respondWith(networkFirst(req, SHELL, new Request(url.origin + url.pathname), 5000).catch(function () { return caches.match("index.html").then(function (h) { return h || caches.match("./"); }); })); return; }
    if (/\/vendor[^/]*\.js$/.test(path) || /\/fra\.traineddata\.gz$/.test(path) || /\.(png|webmanifest|ico)$/.test(path)) { e.respondWith(cacheFirst(req, SHELL)); return; }
    if (/\/catalogue[^/]*\.json$/.test(path) || /\/catalogues\//.test(path)) { e.respondWith(revalidate(req, SHELL)); return; }
    return;
  }
  if (/\.supabase\.co$/.test(url.hostname) && /^\/rest\/v1\//.test(url.pathname)) { e.respondWith(networkFirst(req, DATA, null, 8000)); return; }
  if (CDN_HOSTS.indexOf(url.hostname) !== -1) { e.respondWith(revalidate(req, LIBS)); return; }
});

self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_e) { d = { title: "SimSimStock", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "SimSimStock", {
    body: d.body || "", icon: "icon-192.png", tag: d.tag || "simsimstock", renotify: !!d.tag,
    data: { tab: d.tab || "messages" }
  }));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var tab = (e.notification.data && e.notification.data.tab) || "messages";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { var c = list[i]; if ("focus" in c) { c.postMessage({ type: "go", tab: tab }); return c.focus(); } }
    return self.clients.openWindow("./?go=" + encodeURIComponent(tab));
  }));
});
