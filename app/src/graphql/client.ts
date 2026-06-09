import { createClient, cacheExchange, fetchExchange } from "@urql/core";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/graphql";

export const urqlClient = createClient({
  url: API_URL,
  exchanges: [cacheExchange, fetchExchange],
  fetchOptions: () => {
    const token =
      typeof localStorage !== "undefined" ? localStorage.getItem("scd_token") : null;
    return token
      ? { headers: { Authorization: `Bearer ${token}` } }
      : {};
  },
});
