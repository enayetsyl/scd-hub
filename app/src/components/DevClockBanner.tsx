/**
 * AL-14: the thin "dev clock" strip + the one-time / 5-minute check that turns the shifted Date on.
 * Prod: the query answers `active: false` (or fails - silently) -> nothing is patched and this renders null.
 */
import React, { useEffect, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { getUrqlClient } from "../graphql/client";
import { DEV_CLOCK } from "../graphql/devClock";
import { applyDevClock, devClockBannerText, getDevClockInfo, subscribeDevClock } from "../lib/devClock";
import { useLanguage } from "../state/LanguageContext";

const RECHECK_MS = 5 * 60_000;

/** Build flag (dev VM app/.env only). Without it: no query, no interval, no Date patch, no banner. */
export const DEV_CLOCK_BUILD = process.env.EXPO_PUBLIC_DEV_CLOCK === "1";

/** One cheap query; resolves (never rejects) so a failure cannot block startup. `timeoutMs` bounds the wait. */
export async function checkDevClock(timeoutMs = 2500): Promise<void> {
  if (!DEV_CLOCK_BUILD) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ask = getUrqlClient().query(DEV_CLOCK, {}, { requestPolicy: "network-only" }).toPromise();
    const res = await Promise.race([
      ask,
      new Promise<null>((r) => {
        timer = setTimeout(() => r(null), timeoutMs);
      }),
    ]);
    applyDevClock(res?.data?.devClock ?? null);
  } catch {
    /* silent: no banner, no patch */
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function DevClockBanner(): React.ReactElement | null {
  const { lang } = useLanguage();
  const info = useSyncExternalStore(subscribeDevClock, getDevClockInfo);
  useEffect(() => {
    if (!DEV_CLOCK_BUILD) return undefined;
    const id = setInterval(() => void checkDevClock(), RECHECK_MS);
    return () => clearInterval(id);
  }, []);
  if (!DEV_CLOCK_BUILD || !info.active) return null;
  const text = devClockBannerText(info.todayKey, lang);
  if (!text) return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 9999, backgroundColor: "#b45309", paddingVertical: 1 }}>
      <Text style={{ color: "#fff", fontSize: 11, textAlign: "center" }} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}
