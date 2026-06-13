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
