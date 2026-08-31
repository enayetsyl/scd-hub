/**
 * netStatus — a synchronously-readable answer to "is this device offline right now?".
 *
 * `useOnline` (ux-audit F2) already answers this for RENDER, but the error-reporting seam
 * in `graphql/client.ts` runs inside urql's `onError` callback, where there is no hook and
 * no time to await `NetInfo.fetch()`. So this module subscribes once at import and keeps
 * the last state in a module-level variable that `onError` can read on the spot.
 *
 * Tri-state on purpose, matching `useOnline`: `null` means NetInfo has not reported yet,
 * and unknown counts as ONLINE. Every caller here is deciding whether to SUPPRESS a report,
 * so the unknown case must fall through to reporting — a suppressed fault is worse than a
 * noisy one.
 */
import NetInfo from "@react-native-community/netinfo";

let connected: boolean | null = null;

try {
  NetInfo.addEventListener((state) => {
    connected = state.isConnected;
  });
} catch {
  /* No NetInfo in this environment (jest, a bare node import) — stay `null` = online. */
}

/**
 * True only when the device is KNOWN to have no network connection. `false` while the
 * state is unknown, so an unclassified failure is still reported.
 *
 * Note this is `isConnected`, not `isInternetReachable`: it answers "does this phone have
 * a link at all", which is the case worth suppressing. A phone that holds a link but sits
 * behind a captive portal or a dead cell still reports — that is indistinguishable from
 * the API being down, and the API being down is exactly what we want to hear about.
 */
export function isKnownOffline(): boolean {
  return connected === false;
}
