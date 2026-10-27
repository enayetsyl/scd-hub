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

/**
 * Open a signed-in screen from OUTSIDE the navigator tree (a pop-up, a listener), by its
 * FULL path: root "App" → drawer tab → optional stack screen.
 *
 * WHY THE FULL PATH. The root is a stack whose routes are "App", the full-screen pages
 * and "Auth"; the drawer tabs live inside "App". `navigationRef.navigate("HomeTab", …)`
 * names a route the root does not have and relies on the action being passed down to
 * the drawer — it opened the comment guideline on the web but left Android teachers on
 * Today (owner report 2026-10-27). Naming every level never depends on that hand-off.
 * `initial: false` keeps the tab's first screen (Today) underneath, so Back returns there.
 */
export function openAppScreen(tab: string, screen?: string): boolean {
  if (!tab || !navigationRef.isReady()) return false;
  if (!navigationRef.getRootState()?.routeNames.includes("App")) return false; // signed out
  const nav = navigationRef as unknown as { navigate: (name: string, params?: object) => void };
  nav.navigate("App", { screen: tab, params: screen ? { screen, initial: false } : undefined, initial: false });
  return true;
}

/** A notification a push tap asked for that the navigator cannot show yet: still
 *  booting, or signed out (the root stack has no NotificationDetail until login). */
let pendingNotificationId: string | null = null;

/** D-#774: a push tap (app or browser) opens THAT notification's detail screen —
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
