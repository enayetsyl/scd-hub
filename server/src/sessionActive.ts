/**
 * A session token now lives 30 days (D-#708). JWT verification alone would let a
 * deactivated account keep using an old token for that whole window, so the GraphQL
 * context also confirms the account is still active. The answer is cached per account
 * for a minute — a deactivation bites within ~60s, at one tiny read per account per
 * minute rather than one per request. A failed lookup never locks anyone out (the
 * token is still a valid signature); only a confirmed inactive/missing account does.
 */
import { User } from "./modules/foundation/models/User";
import { Guardian } from "./modules/foundation/models/Guardian";
import type { AuthPayload } from "./context";

const TTL_MS = 60_000;
const cache = new Map<string, { active: boolean; at: number }>();

async function isActive(auth: AuthPayload): Promise<boolean> {
  const key = `${auth.role === "GUARDIAN" ? "g" : "u"}:${auth.userId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.active;
  try {
    const doc =
      auth.role === "GUARDIAN"
        ? await Guardian.findOne({ _id: auth.userId, active: true }).select("_id").lean()
        : await User.findOne({ _id: auth.userId, active: true }).select("_id").lean();
    const active = !!doc;
    cache.set(key, { active, at: Date.now() });
    return active;
  } catch {
    return true; // DB hiccup: fall back to the signature, never a mass sign-out
  }
}

/** The auth payload, or null when the account behind it is no longer active. */
export async function withActiveAccount(auth: AuthPayload | null): Promise<AuthPayload | null> {
  if (!auth) return null;
  return (await isActive(auth)) ? auth : null;
}

/** Test seam. */
export function clearSessionActiveCache(): void {
  cache.clear();
}
