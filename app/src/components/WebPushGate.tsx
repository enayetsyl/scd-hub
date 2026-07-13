/**
 * WebPushGate (D-#296) — the notification-permission WALL, for every role
 * (owner ruling: no push permission → no app).
 *
 * Web only, and only when the server actually has push configured (a null
 * VAPID key must never lock anyone out). Once the caller is AUTHED:
 *   permission "default"  → full-screen wall with the Enable button (the
 *                           prompt legally needs a user gesture);
 *   permission "denied"   → the wall explains how to unblock in browser
 *                           settings (a site cannot re-prompt after Block);
 *   permission "granted"  → children render; the subscription is (re)synced
 *                           to the server silently — an idempotent upsert.
 * Native + unsupported browsers pass through (native has its own Expo-push
 * permission flow; there is nothing to grant where Push API doesn't exist).
 */
import React, { useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { useMutation, useQuery } from "urql";
import { WEB_PUSH_PUBLIC_KEY, REGISTER_WEB_PUSH } from "../graphql/webPush";
import { useAuth } from "../auth/AuthContext";
import { Screen, H2, Body, Muted, Card, Button, Notice } from "./ui";
import { STR } from "../lib/labels";
import {
  isWebPushSupported,
  webPushPermission,
  enableWebPush,
  type WebPushPermission,
} from "../lib/webPush";
import { space } from "../theme/tokens";

export function WebPushGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const { status } = useAuth();
  const [permission, setPermission] = useState<WebPushPermission>(() => webPushPermission());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authed = status === "authed";
  const supported = isWebPushSupported();

  const [keyQ] = useQuery({ query: WEB_PUSH_PUBLIC_KEY, pause: !authed || !supported });
  const vapidKey = keyQ.data?.webPushPublicKey ?? null;
  const [, register] = useMutation(REGISTER_WEB_PUSH);

  const syncSubscription = useCallback(async (): Promise<void> => {
    if (!vapidKey) return;
    const sub = await enableWebPush(vapidKey); // permission already granted → no prompt
    if (sub) {
      await register({
        ...sub,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null,
      });
    }
  }, [vapidKey, register]);

  // Already-granted browsers silently (re)register on login, so the server row
  // survives key rotations and cleared site data.
  useEffect(() => {
    if (authed && supported && vapidKey && permission === "granted") {
      void syncSubscription().catch(() => {});
    }
  }, [authed, supported, vapidKey, permission, syncSubscription]);

  async function onEnable(): Promise<void> {
    if (!vapidKey) return;
    setBusy(true);
    setError(null);
    try {
      const sub = await enableWebPush(vapidKey);
      if (sub) {
        await register({
          ...sub,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null,
        });
      }
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setPermission(webPushPermission());
      setBusy(false);
    }
  }

  // Pass-through: native, unsupported browsers, logged-out, unconfigured server,
  // or permission already granted.
  const wall =
    Platform.OS === "web" &&
    authed &&
    supported &&
    !!vapidKey &&
    permission !== "granted";
  if (!wall) return <>{children}</>;

  return (
    <Screen scroll>
      <View style={{ maxWidth: 560, alignSelf: "center", width: "100%", paddingTop: space(8) }}>
        <H2>🔔 {STR.pushWallTitle}</H2>
        <Card>
          <Body style={{ marginBottom: space(2) }}>{STR.pushWallBody}</Body>
          {permission === "denied" ? (
            <>
              <Notice message={STR.pushBlocked} tone="danger" />
              <Muted style={{ marginTop: space(2) }}>{STR.pushBlockedHelp}</Muted>
              <Button
                title={STR.pushRecheck}
                variant="secondary"
                onPress={() => setPermission(webPushPermission())}
                style={{ marginTop: space(2) }}
              />
            </>
          ) : (
            <>
              {error ? <Notice message={error} tone="danger" /> : null}
              <Button title={STR.pushEnable} onPress={onEnable} loading={busy} disabled={busy} />
            </>
          )}
        </Card>
        <Muted>{STR.pushIosHint}</Muted>
      </View>
    </Screen>
  );
}
