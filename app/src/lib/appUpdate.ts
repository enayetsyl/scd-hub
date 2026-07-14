/**
 * appUpdate — self-hosted Android distribution (no Play Store).
 *
 * Two update lanes, both driven from UpdateGate at launch:
 *   1. APK (native changes): the server's /downloads/version.json names the
 *      latest versionCode; a newer one is MANDATORY — the gate walls the app
 *      until the user installs it. The APK downloads into the app cache (never
 *      the user's Downloads folder) and the package installer replaces the
 *      installed app in place, so nothing piles up on the phone; stale cached
 *      APKs are deleted on the next launch that passes the gate.
 *   2. OTA (JS-only changes): expo-updates / EAS Update, applied immediately
 *      (check → fetch → reload) so guardians never sit on old JS.
 *
 * Fail-OPEN by design: offline phones or a down server must never lock anyone
 * out — only a successfully fetched, strictly newer versionCode blocks.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Application from "expo-application";
import * as FileSystem from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import * as Updates from "expo-updates";
import { REST_BASE } from "../graphql/client";

export type ApkInfo = {
  versionCode: number;
  versionName: string;
  apkUrl: string;
};

const VERSION_JSON_URL = `${REST_BASE}/downloads/version.json`;
const APK_PREFIX = "scd-hub-update-";
const CHECK_TIMEOUT_MS = 5000;
// FLAG_GRANT_READ_URI_PERMISSION — lets the package installer read the content:// URI.
const GRANT_READ_URI = 1;

export function installedVersionCode(): number {
  return Number(Application.nativeBuildVersion ?? 0);
}

export function installedVersionName(): string | null {
  return Application.nativeApplicationVersion;
}

/** Display version for the account menu — native reads the APK, web reads app.json. */
export function appVersionLabel(): string {
  return (
    (Platform.OS === "web"
      ? Constants.expoConfig?.version
      : Application.nativeApplicationVersion) ?? "—"
  );
}

/** Returns the newer APK's info, or null when up to date / on ANY failure (fail-open). */
export async function checkApkUpdate(): Promise<ApkInfo | null> {
  if (Platform.OS !== "android" || __DEV__) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    const res = await fetch(VERSION_JSON_URL, {
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const info = (await res.json()) as ApkInfo;
    if (typeof info?.versionCode !== "number" || typeof info?.apkUrl !== "string") return null;
    return info.versionCode > installedVersionCode() ? info : null;
  } catch {
    return null;
  }
}

/**
 * Download the APK into the app cache, then hand it to the Android package
 * installer. Throws on download failure (the gate shows retry); the installer
 * activity itself resolves as soon as it opens — the user finishes there.
 */
export async function downloadAndInstallApk(
  info: ApkInfo,
  onProgress: (ratio: number) => void,
): Promise<void> {
  const url = info.apkUrl.startsWith("http") ? info.apkUrl : `${REST_BASE}${info.apkUrl}`;
  const target = `${FileSystem.cacheDirectory}${APK_PREFIX}${info.versionCode}.apk`;
  const download = FileSystem.createDownloadResumable(url, target, {}, (p) => {
    if (p.totalBytesExpectedToWrite > 0) {
      onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
    }
  });
  const result = await download.downloadAsync();
  if (!result?.uri) throw new Error("download incomplete");
  const contentUri = await FileSystem.getContentUriAsync(result.uri);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    type: "application/vnd.android.package-archive",
    flags: GRANT_READ_URI,
  });
}

/** Delete cached update APKs left behind by a completed (or abandoned) update. */
export async function cleanupStaleApks(): Promise<void> {
  const dir = FileSystem.cacheDirectory;
  if (Platform.OS !== "android" || !dir) return;
  try {
    const names = await FileSystem.readDirectoryAsync(dir);
    await Promise.all(
      names
        .filter((n) => n.startsWith(APK_PREFIX) && n.endsWith(".apk"))
        .map((n) => FileSystem.deleteAsync(`${dir}${n}`, { idempotent: true })),
    );
  } catch {
    // best-effort — cache is OS-purgeable anyway
  }
}

/**
 * Apply a pending EAS (OTA) update right now: check → fetch → reload. On
 * reload the JS restarts on the new bundle and the gate runs again, finding
 * nothing. All failures are swallowed (fail-open).
 */
export async function applyOtaUpdate(): Promise<void> {
  if (__DEV__ || !Updates.isEnabled) return;
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
  } catch {
    // offline / server down / no embedded update — continue on the current bundle
  }
}
