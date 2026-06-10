import { createClient, cacheExchange, fetchExchange } from "urql";
import { getToken } from "../lib/tokenStore";

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/graphql";

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
