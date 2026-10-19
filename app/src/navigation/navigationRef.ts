/**
 * Root navigation ref (N4.2) — lets the push-tap listener (outside the
 * navigator tree) open the NotificationCenter. The center is the one
 * role-agnostic surface; the tapped row's deep-link is one tap inside it.
 */
import { createNavigationContainerRef } from "@react-navigation/native";

export const navigationRef = createNavigationContainerRef();

export function openNotificationCenter(): void {
  if (navigationRef.isReady()) {
    (navigationRef as unknown as { navigate: (name: string) => void }).navigate("NotificationCenter");
  }
}

/** A notification a push tap asked for that the navigator cannot show yet: still
 *  booting, or signed out (the root stack has no NotificationDetail until login). */
let pendingNotificationId: string | null = null;

/** D-#773: a push tap (app or browser) opens THAT notification's detail screen —
 *  where an inbox row tap lands — instead of the inbox. Held until it can be shown. */
export function openNotification(id: string): void {
  pendingNotificationId = id;
  flushPendingNotification();
}

/** Shows the held notification once possible. NavigationContainer calls this on
 *  ready and on every state change (which includes the switch to the signed-in stack). */
export function flushPendingNotification(): void {
  const id = pendingNotificationId;
  if (!id || !navigationRef.isReady()) return;
  if (!navigationRef.getRootState()?.routeNames.includes("NotificationDetail")) return;
  pendingNotificationId = null;
  (navigationRef as unknown as { navigate: (name: string, params: object) => void }).navigate(
    "NotificationDetail",
    { id },
  );
}
