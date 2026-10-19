/**
 * Browser notification taps (D-#774) — the app half of public/sw.js's click handler.
 *
 * A tap reaches the app one of two ways: an already-open tab gets a message from the
 * service worker; with no tab open, a new one starts at `/#notification=<id>`. Both
 * hand the id to `openNotification` (navigationRef), which lands on the detail screen.
 * Web only — every export is a no-op elsewhere.
 */
import { Platform } from "react-native";

/** Message type posted by sw.js — keep the two in step. */
const OPEN_NOTIFICATION = "scd:open-notification";
const HASH_PREFIX = "#notification=";

interface NavigatorSW {
  serviceWorker?: ServiceWorkerContainer;
}

/** The id a fresh tab was opened for, if any. Clears the hash so a reload or a shared
 *  link does not re-open the notification. */
export function takeNotificationFromUrl(): string | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const { hash, pathname, search } = window.location;
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const id = decodeURIComponent(hash.slice(HASH_PREFIX.length));
  window.history.replaceState(null, "", pathname + search);
  return id || null;
}

/** Calls `onOpen` for every tap the service worker forwards to this open tab. */
export function subscribeNotificationTaps(onOpen: (id: string) => void): () => void {
  if (Platform.OS !== "web" || typeof navigator === "undefined") return () => {};
  const sw = (navigator as NavigatorSW).serviceWorker;
  if (!sw) return () => {};
  const handler = (event: MessageEvent): void => {
    const data = event.data as { type?: unknown; id?: unknown } | null;
    if (data?.type === OPEN_NOTIFICATION && typeof data.id === "string" && data.id) onOpen(data.id);
  };
  sw.addEventListener("message", handler);
  sw.startMessages(); // flush anything posted before this listener existed
  return () => sw.removeEventListener("message", handler);
}
