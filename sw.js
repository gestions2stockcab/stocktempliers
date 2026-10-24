// SimSimStock - service worker : recoit les notifications meme quand l'appli est fermee.
// Ce fichier doit etre place a cote de index.html, a la racine du site.
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
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
