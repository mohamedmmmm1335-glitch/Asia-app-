const CACHE_NAME = "asia-menu-v2";
const ASSETS = [
  "/Asia-app-/index.html",
  "/Asia-app-/manifest.json",
  "https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;900&display=swap"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// =====================================================
// 🔔 PUSH NOTIFICATIONS
// =====================================================
self.addEventListener("push", e => {
  const data = e.data?.json() || {};
  const title = data.title || "مطعم آسيا";
  const options = {
    body:  data.body  || "",
    icon:  data.icon  || "/Asia-app-/logo.png",
    badge: data.badge || "/Asia-app-/logo.png",
    dir:   "rtl",
    lang:  "ar",
    vibrate: [200, 100, 200],
    data:  data.data  || {},
    actions: data.actions || []
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// لما الزبون يضغط على الإشعار
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window" }).then(clientList => {
      if (clientList.length > 0) {
        clientList[0].focus();
      } else {
        clients.openWindow("/Asia-app-/index.html");
      }
    })
  );
});
