/**
 * JWT holder. The urql client reads the token synchronously per request via
 * getToken(), so we keep an in-memory copy that is hydrated from persistent
 * storage at app boot (hydrateToken) and updated on login/logout (persistToken).
 *
 * The token is never logged or surfaced in the UI.
 */
import { getItem, setItem, removeItem } from "./storage";

const TOKEN_KEY = "scd_token";

/**
 * The Principal's OWN token, parked here while they work inside someone else's account
 * ("View as", VA-1, D-#638).
 *
 * It is a separate key rather than in-memory state on purpose: a reload, a crash or a
 * killed app during a borrowed session must still be able to hand the Principal their own
 * account back. Boot checks this key before trusting `scd_token`.
 */
const REAL_TOKEN_KEY = "scd_token_real";

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

/** The Principal's parked token, if a View-as session is (or was) in progress. */
export async function getRealToken(): Promise<string | null> {
  return getItem(REAL_TOKEN_KEY);
}

/** Park (or, with null, discard) the Principal's own token. */
export async function persistRealToken(token: string | null): Promise<void> {
  if (token) await setItem(REAL_TOKEN_KEY, token);
  else await removeItem(REAL_TOKEN_KEY);
}
