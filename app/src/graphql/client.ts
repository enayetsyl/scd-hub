import { Platform } from "react-native";
import { createClient, cacheExchange, fetchExchange } from "urql";
import { getToken } from "../lib/tokenStore";

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

export const urqlClient = createClient({
  url: API_URL,
  exchanges: [cacheExchange, fetchExchange],
  // Token is read synchronously per request from the in-memory holder, which is
  // hydrated from SecureStore/localStorage at boot (see lib/tokenStore).
  fetchOptions: () => {
    const token = getToken();
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
  },
});
