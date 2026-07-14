/**
 * UpdateGate — the mandatory Android-update WALL (self-hosted distribution;
 * owner ruling: an outdated APK may not be used).
 *
 * Android release builds only; web/iOS/dev pass straight through. On mount:
 *   1. Ask the server for the latest APK versionCode (fail-open — offline or
 *      a down server never blocks anyone).
 *   2. Newer APK → full-screen wall: download into the app cache with a
 *      progress bar, then open the package installer. The button stays
 *      re-tappable because the first attempt detours through Android's
 *      "install unknown apps" permission screen on some phones.
 *   3. Up to date → sweep stale cached update APKs, apply any pending OTA
 *      (EAS) update immediately, then render the app.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { Screen, H2, Body, Muted, Card, Button, Notice } from "./ui";
import { STR } from "../lib/labels";
import { space, useColors } from "../theme";
import {
  type ApkInfo,
  checkApkUpdate,
  downloadAndInstallApk,
  cleanupStaleApks,
  applyOtaUpdate,
  installedVersionName,
} from "../lib/appUpdate";

const gated = Platform.OS === "android" && !__DEV__;

export function UpdateGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const colors = useColors();
  const [ready, setReady] = useState(!gated);
  const [apk, setApk] = useState<ApkInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!gated) return;
    let alive = true;
    void (async () => {
      const info = await checkApkUpdate();
      if (!alive) return;
      if (info) {
        setApk(info);
        return; // wall — never reaches ready
      }
      void cleanupStaleApks();
      await applyOtaUpdate(); // reloads the JS if an OTA update lands
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onDownload = useCallback(async () => {
    if (!apk || busy) return;
    setBusy(true);
    setFailed(false);
    setProgress(0);
    try {
      await downloadAndInstallApk(apk, setProgress);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [apk, busy]);

  if (apk) {
    const current = installedVersionName();
    return (
      <Screen scroll>
        <View style={{ maxWidth: 560, alignSelf: "center", width: "100%", paddingTop: space(8) }}>
          <H2>⬆️ {STR.updateWallTitle}</H2>
          <Card>
            <Body style={{ marginBottom: space(2) }}>{STR.updateWallBody}</Body>
            <Muted>
              {STR.updateCurrentVersion}: {current ?? "—"} → {STR.updateNewVersion}: {apk.versionName}
            </Muted>
            {failed ? <Notice message={STR.updateFailed} tone="danger" /> : null}
            {busy ? (
              <View
                style={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: colors.border,
                  overflow: "hidden",
                  marginTop: space(2),
                }}
              >
                <View
                  style={{
                    width: `${Math.round(progress * 100)}%`,
                    height: "100%",
                    backgroundColor: colors.primary,
                  }}
                />
              </View>
            ) : null}
            <Button
              title={busy ? STR.updateDownloading : STR.updateDownload}
              onPress={onDownload}
              loading={busy}
              disabled={busy}
              style={{ marginTop: space(2) }}
            />
            <Muted style={{ marginTop: space(2) }}>{STR.updateInstallHint}</Muted>
          </Card>
        </View>
      </Screen>
    );
  }

  if (!ready) return <></>; // brief launch check, bounded by the 5s fetch timeout

  return <>{children}</>;
}
