/* Pteas — the service worker.
 *
 * Its job is small and specific: when somebody has added Pteas to their home
 * screen and opens it with no signal, they must get the app - which already
 * knows how to show sample listings and say so - and not Chrome's dinosaur.
 * Without a worker the "installed" app is a bookmark with an icon, and
 * offline it is an error page.
 *
 * So: the shell is cached on install and served cache-first. Everything else -
 * the database, storage, the map tiles, the fonts - goes to the network as
 * before; the app handles those failing itself. The cache name carries a
 * version so a deploy that changes this file replaces the old shell rather
 * than living beside it forever.
 */
var SHELL = "pteas-shell-v1";
var FILES = ["./", "./index.html", "./manifest.webmanifest",
             "./icon-192.png", "./icon-512.png", "./icon-180.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(SHELL)
      .then(function (c) { return c.addAll(FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== SHELL; })
                             .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  /* Only the shell, only same-origin, only GET. A worker that intercepts API
     calls is a second place for caching bugs to live. */
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;

  /* Navigations get the cached shell when the network is down. Fresh from the
     network when it is up, so a deploy shows within one open, not two. */
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(SHELL).then(function (c) { c.put("./index.html", copy); });
        return res;
      }).catch(function () {
        return caches.match("./index.html");
      })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(function (hit) { return hit || fetch(e.request); })
  );
});
