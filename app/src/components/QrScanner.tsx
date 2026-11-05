/**
 * Phone-camera QR scanning for the desks (SB-5, D-#985) — storybook copy codes now,
 * activity-sheet codes later.
 *
 * expo-camera is a NATIVE module: an APK built before it was added has no `ExpoCamera`, and
 * importing the package there throws at module load. The same JS bundle reaches old phones by
 * OTA, so the package is only `require`d after `requireOptionalNativeModule("ExpoCamera")`
 * confirms it is present. Old APKs and the web simply get `canScanQr === false` — the desk's
 * code box (typing or a USB scanner) works everywhere.
 */
import React, { useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { requireOptionalNativeModule } from "expo";
import { Button, Muted } from "./ui";
import { STR } from "../lib/labels";
import { radius, space } from "../theme";

export const canScanQr: boolean = Platform.OS !== "web" && !!requireOptionalNativeModule("ExpoCamera");

type CameraLib = typeof import("expo-camera");
let lib: CameraLib | null = null;
function cameraLib(): CameraLib | null {
  if (!canScanQr) return null;
  if (!lib) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    lib = require("expo-camera") as CameraLib;
  }
  return lib;
}

/** A live camera that calls `onCode` once per distinct QR seen, until closed. */
export function QrScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }): React.ReactElement | null {
  const camera = cameraLib();
  const [permission, request] = camera ? camera.useCameraPermissions() : [null, async () => null];
  const [asked, setAsked] = useState(false);
  const last = useRef<{ code: string; at: number } | null>(null);

  useEffect(() => {
    if (camera && permission && !permission.granted && permission.canAskAgain && !asked) {
      setAsked(true);
      void request();
    }
  }, [camera, permission, asked, request]);

  if (!camera) return null;
  if (!permission?.granted) {
    return (
      <View style={{ gap: space(2) }}>
        <Muted>{STR.qrNeedCamera}</Muted>
        <Button title={STR.qrAllow} onPress={() => void request()} />
        <Button title={STR.qrClose} variant="ghost" onPress={onClose} />
      </View>
    );
  }
  const { CameraView } = camera;
  return (
    <View style={{ gap: space(2) }}>
      <View style={{ height: 260, borderRadius: radius.md, overflow: "hidden", backgroundColor: "#000" }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => {
            const code = String(data ?? "").trim();
            if (!code) return;
            // The camera fires many times a second — one call per code, and again only after 3 s.
            const now = Date.now();
            if (last.current && last.current.code === code && now - last.current.at < 3000) return;
            last.current = { code, at: now };
            onCode(code);
          }}
        />
      </View>
      <Button title={STR.qrClose} variant="ghost" onPress={onClose} />
    </View>
  );
}
