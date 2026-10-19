/**
 * SCD Hub service worker (D-#296) — receives Web Push messages and shows the
 * browser notification even when no app tab is open. The payload is built by
 * the server's web-push channel: { title, body, kind, refs, notificationId }.
 * Clicking opens THAT notification (D-#774): an open app tab is focused and told
 * the id by message; with no tab, a new one opens at `/#notification=<id>`. The
 * app (lib/webPushTap.ts) lands on the notification's detail screen either way.
 * A hash, not a query: it never reaches the server or the Cloudflare cache key.
 */
const OPEN_NOTIFICATION = "scd:open-notification"; // mirrored in lib/webPushTap.ts
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
    data: { kind: data.kind || "", refs: data.refs || {}, notificationId: data.notificationId || "" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Shown by an older worker → no id; those still just open the app.
  const id = (event.notification.data && event.notification.data.notificationId) || "";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      for (const tab of tabs) {
        if ("focus" in tab) {
          if (id) tab.postMessage({ type: OPEN_NOTIFICATION, id });
          return tab.focus();
        }
      }
      return self.clients.openWindow(id ? "/#notification=" + encodeURIComponent(id) : "/");
    }),
  );
});
