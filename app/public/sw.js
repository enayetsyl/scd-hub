/**
 * SCD Hub service worker (D-#296) — receives Web Push messages and shows the
 * browser notification even when no app tab is open. The payload is built by
 * the server's web-push channel: { title, body, kind, refs, notificationId }.
 * Clicking focuses an existing app tab (or opens one); the app's own bell
 * handles fine-grained routing once inside.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "SCD Hub", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "SCD Hub";
  const options = {
    body: data.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: data.notificationId || undefined, // replaces re-sends of the same row
    data: { kind: data.kind || "", refs: data.refs || {} },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      for (const tab of tabs) {
        if ("focus" in tab) return tab.focus();
      }
      return self.clients.openWindow("/");
    }),
  );
});
