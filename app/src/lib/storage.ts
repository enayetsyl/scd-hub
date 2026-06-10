/**
 * Cross-platform key/value persistence.
 *   - native (iOS/Android): expo-secure-store (Keychain / Keystore)
 *   - web: localStorage
 *
 * The JWT lives here (never logged, never exposed). expo-secure-store is only
 * required on native — on web its methods throw, so we branch on Platform and
 * never load/call it there.
 */
import { Platform } from "react-native";

type SecureStoreModule = typeof import("expo-secure-store");

let secureStore: SecureStoreModule | null = null;
if (Platform.OS !== "web") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  secureStore = require("expo-secure-store") as SecureStoreModule;
}

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }
  return (await secureStore!.getItemAsync(key)) ?? null;
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
    } catch {
      /* storage unavailable — non-fatal */
    }
    return;
  }
  await secureStore!.setItemAsync(key, value);
}

export async function removeItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      if (typeof localStorage !== "undefined") localStorage.removeItem(key);
    } catch {
      /* non-fatal */
    }
    return;
  }
  await secureStore!.deleteItemAsync(key);
}
