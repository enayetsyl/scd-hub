/**
 * Expo push-token registration (AT-4, §9.3, D-#65). Called once the user is
 * authenticated; registers this device's token so the attendance reminder
 * engine (server) can reach it. Best-effort and fully defensive — never throws,
 * never blocks login:
 *   - web has no Expo push → no-op (the app still works, inbox-style);
 *   - simulators / denied permission / no EAS projectId → silently skipped.
 */
import { Platform } from "react-native";
import type { Client } from "urql";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { REGISTER_PUSH_DEVICE } from "../graphql/operations";

export async function registerPushToken(client: Client): Promise<void> {
  if (Platform.OS === "web") return; // no Expo push on web
  try {
    if (!Device.isDevice) return; // emulators don't receive a push token

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      const asked = await Notifications.requestPermissionsAsync();
      granted = asked.granted;
    }
    if (!granted) return;

    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
        ?.projectId ?? Constants.easConfig?.projectId;
    const tokenResp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResp.data;
    if (!token) return;

    await client
      .mutation(REGISTER_PUSH_DEVICE, { token, platform: Platform.OS })
      .toPromise();
  } catch (err) {
    // Push registration is never allowed to break the session.
    console.warn("[push] registration skipped:", err);
  }
}
