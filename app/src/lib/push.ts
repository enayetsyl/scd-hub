/**
 * Expo push-token registration (AT-4, §9.3, D-#65; extended by N-4, D-#75).
 * Called once the user is authenticated; registers this device's token so the
 * notification push channel (server) can reach it — staff AND guardian logins
 * (the server keys the device to whichever the auth token is). Best-effort and
 * fully defensive — never throws, never blocks login:
 *   - web has no Expo push → no-op (the app still works, inbox-style);
 *   - simulators / denied permission / no EAS projectId → silently skipped.
 *
 * N-4 additions: a foreground display handler (a push while the app is open
 * still pops, D-#75 "no quiet hours" spirit) and `unregisterPushToken` —
 * logout deactivates this device's token server-side (N4.1) while the session
 * token is still valid.
 */
import { Platform } from "react-native";
import type { Client } from "urql";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { REGISTER_PUSH_DEVICE, UNREGISTER_PUSH_DEVICE } from "../graphql/operations";
import { captureAppError } from "../observability/sentry";

/** The token this device registered this session — what logout unregisters. */
let registeredToken: string | null = null;

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

    // Foreground pushes should still show (background display is the OS's job).
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
        ?.projectId ?? Constants.easConfig?.projectId;
    const tokenResp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResp.data;
    if (!token) return;

    const res = await client
      .mutation(REGISTER_PUSH_DEVICE, { token, platform: Platform.OS })
      .toPromise();
    if (res.error) throw res.error;
    registeredToken = token;
  } catch (err) {
    // Push registration is never allowed to break the session — but it is no longer
    // allowed to fail SILENTLY either. Every Android phone failed here from the first
    // APK until D-#768 (no Firebase config, so no token), and a console.warn on a phone
    // is read by no one: the push-device table sat at 0 rows for four months. Once per
    // app session, one grouped GlitchTip issue.
    console.warn("[push] registration skipped:", err);
    if (!reportedFailure) {
      reportedFailure = true;
      captureAppError(
        err,
        { kind: "push-registration", platform: Platform.OS },
        { fingerprint: ["push-registration-failed"] },
      );
    }
  }
}

/** One report per app session — registration re-runs on every sign-in. */
let reportedFailure = false;

/** Deactivate this device's token server-side (called from logout, while the
 *  auth token still works). Best-effort — logout always proceeds. */
export async function unregisterPushToken(client: Client): Promise<void> {
  const token = registeredToken;
  if (!token) return;
  registeredToken = null;
  try {
    await client.mutation(UNREGISTER_PUSH_DEVICE, { token }).toPromise();
  } catch (err) {
    console.warn("[push] unregister skipped:", err);
  }
}
