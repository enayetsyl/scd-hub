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

type Nav = { navigate: (name: string, params?: object) => void };

/**
 * Open `screen` inside drawer tab `tab` from OUTSIDE the navigator tree (a pop-up).
 *
 * Two steps, on purpose. The app restores the last navigation state, so it often opens on
 * another tab with the target tab's inner state ALREADY saved (e.g. Home = [Today]). When
 * that tab's stack mounts, the saved state wins over a `{ screen }` param, and the request
 * is silently dropped — the meeting reminder's "নির্দেশিকা দেখুন" landed on Today (prod,
 * 2026-10-27). So: switch to the tab first, and once its stack is mounted, navigate inside
 * it — the already-mounted path honours `{ screen }`. `initial: false` keeps the tab's own
 * first screen underneath, so Back returns there (D-#311). Never throws.
 */
export function navigateInTab(tab: string, screen: string): void {
  if (!navigationRef.isReady()) return;
  const nav = navigationRef as unknown as Nav;
  try {
    nav.navigate(tab);
  } catch {
    return; // no such tab for this login — closing the pop-up is enough
  }
  setTimeout(() => {
    try {
      if (navigationRef.isReady()) nav.navigate(tab, { screen, initial: false });
    } catch {
      /* the screen is not in this login's tab — staying on the tab is fine */
    }
  }, 0);
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
