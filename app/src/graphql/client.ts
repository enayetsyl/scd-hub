import { Platform } from "react-native";
import { createClient, cacheExchange, fetchExchange, mapExchange, getOperationName } from "urql";
import { getToken } from "../lib/tokenStore";
import { isKnownOffline } from "../lib/netStatus";
import { captureAppError } from "../observability/sentry";

// On WEB the app is served same-origin behind the reverse proxy (Caddy serves
// the static bundle and proxies /graphql, /pdf, /files), so a RELATIVE URL is
// resolved against the page origin — works for prod AND dev with no per-env
// config and no domain baked into the bundle. NATIVE has no same-origin, so it
// needs an absolute URL from EXPO_PUBLIC_API_URL (else the local dev default).
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === "web" ? "/graphql" : "http://localhost:4000/graphql");

/** Base for the thin REST surface (PDF export), derived from the GraphQL URL. */
export const REST_BASE = API_URL.replace(/\/graphql\/?$/, "");

// MON-3 (prd-observability.md §4): capture transport/network failures into GlitchTip.
// We report ONLY networkError — those never reach the server, so MON-2 can't see them
// (CORS, offline, a 5xx with no body). Pure GraphQL resolver faults are already captured
// server-side by MON-2, and the expected business/authz ones are normal flow, so we do
// NOT re-capture graphQLErrors here (avoids flooding the dashboard).
//
// The captured error itself is USELESS for locating the caller: RN's fetch polyfill
// builds the rejection inside a setTimeout, so `TypeError: Network request failed`
// arrives with a stack of nothing but whatwg-fetch and the RN bridge — byte-identical
// for every failed request in the app (GlitchTip, 2026-08-07). `onError` is handed the
// OPERATION as well, and that is the part worth keeping: the query/mutation NAME turns
// "a request failed" into "ChildHomework failed", which is the difference between noise
// and a lead. `url` distinguishes a phone that cannot reach the API from a web session
// hitting the same-origin proxy.
// Network errors that are NOT app faults and must not reach the dashboard.
//
// urql's fetch source throws `Error("No Content")` when a response carries no body —
// which is what an in-flight request looks like when it is cut short: the phone is
// backgrounded, the screen unmounts, the connection drops mid-response. The app already
// handles it (the query surfaces an error state and retries), so reporting it competes
// with real faults for attention. This is the same rule the server applies in
// `sentry.ts` (D-#387): if we are willing to SHOW it to a user, it is not a fault.
//
// `TypeError: Network request failed` is deliberately NOT in this list — it is the
// signal that told us the ErrorBoundary crash was an offline-resume incident. It is
// gated on connectivity instead; see `isKnownOffline` below.
const EXPECTED_NETWORK_ERRORS = [/^No Content$/i];

const errorReportExchange = mapExchange({
  onError(error, operation) {
    if (!error.networkError) return;
    const msg = error.networkError.message ?? "";
    if (EXPECTED_NETWORK_ERRORS.some((re) => re.test(msg))) return;
    // A phone with NO network link is not a fault (GlitchTip, 2026-08-27: a release-APK
    // issue that was nothing but `TypeError: Network request failed`, one event per query
    // per lost signal). Every request in flight when the signal drops raises this, and the
    // app already handles it — QueryGate shows the offline banner and the query retries.
    //
    // We keep reporting it while the device HAS a link, because that is the case the
    // earlier decision cared about: online-but-cannot-reach-the-API is a real outage
    // signal (DNS, the proxy, a down server), and it is the one that diagnosed the
    // offline-resume ErrorBoundary crash. Unknown connectivity still reports (tri-state).
    if (isKnownOffline()) return;
    captureAppError(error.networkError, {
      kind: "network",
      operation: getOperationName(operation.query) ?? "unknown",
      operationKind: operation.kind,
      url: API_URL,
    });
  },
});

export const urqlClient = createClient({
  url: API_URL,
  exchanges: [cacheExchange, errorReportExchange, fetchExchange],
  // Token is read synchronously per request from the in-memory holder, which is
  // hydrated from SecureStore/localStorage at boot (see lib/tokenStore).
  fetchOptions: () => {
    const token = getToken();
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
  },
});
