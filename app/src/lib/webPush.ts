/**
 * Browser push helpers (D-#296) — the client half of the web-push channel.
 *
 * Web only: registers /sw.js, walks the permission → subscribe flow, and hands
 * the resulting subscription (endpoint + keys) to the caller so a GraphQL
 * mutation can persist it. Push is OPT-IN by construction — nothing here runs
 * until the user's own tap, and browsers refuse the permission prompt outside
 * a user gesture anyway.
 */
import { Platform } from "react-native";

export type WebPushPermission = "granted" | "denied" | "default" | "unsupported";

interface NavigatorSW {
  serviceWorker?: ServiceWorkerContainer;
}

export function isWebPushSupported(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  return (
    "Notification" in window &&
    !!(navigator as NavigatorSW).serviceWorker &&
    "PushManager" in window
  );
}

export function webPushPermission(): WebPushPermission {
  if (!isWebPushSupported()) return "unsupported";
  return Notification.permission as WebPushPermission;
}

/** The VAPID public key arrives base64url; PushManager wants a Uint8Array. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export interface WebPushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Ask permission (must be called from a user gesture) and subscribe this
 * browser. Returns the keys to persist, or null when the user declined.
 * Throws on unexpected browser/SW failures (caller shows the message).
 */
export async function enableWebPush(vapidPublicKey: string): Promise<WebPushSubscriptionKeys | null> {
  if (!isWebPushSupported()) return null;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
    }));

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("Browser returned an incomplete push subscription");
  }
  return { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
}

/** Unsubscribe this browser; returns the endpoint that was removed (for the
 *  server-side unregister), or null when there was nothing to remove. */
export async function disableWebPush(): Promise<string | null> {
  if (!isWebPushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}

/** The current browser's active subscription endpoint, if any. */
export async function currentWebPushEndpoint(): Promise<string | null> {
  if (!isWebPushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  return sub?.endpoint ?? null;
}
