/**
 * JWT holder. The urql client reads the token synchronously per request via
 * getToken(), so we keep an in-memory copy that is hydrated from persistent
 * storage at app boot (hydrateToken) and updated on login/logout (persistToken).
 *
 * The token is never logged or surfaced in the UI.
 */
import { getItem, setItem, removeItem } from "./storage";

const TOKEN_KEY = "scd_token";

let current: string | null = null;

export function getToken(): string | null {
  return current;
}

/** Load the persisted token into memory. Call once at boot before rendering. */
export async function hydrateToken(): Promise<string | null> {
  current = await getItem(TOKEN_KEY);
  return current;
}

/** Set (or clear, with null) the token in memory and in persistent storage. */
export async function persistToken(token: string | null): Promise<void> {
  current = token;
  if (token) await setItem(TOKEN_KEY, token);
  else await removeItem(TOKEN_KEY);
}
