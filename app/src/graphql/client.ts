import { Platform } from "react-native";
import { createClient, cacheExchange, fetchExchange, mapExchange } from "urql";
import { getToken } from "../lib/tokenStore";
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
const errorReportExchange = mapExchange({
  onError(error) {
    if (error.networkError) captureAppError(error.networkError, { kind: "network" });
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
