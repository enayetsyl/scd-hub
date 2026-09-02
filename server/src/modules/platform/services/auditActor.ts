/**
 * Request-scoped audit actor (D-#638).
 *
 * When the Principal is working inside someone else's account ("View as", VA-1) the
 * audit log must name the PRINCIPAL, not the borrowed account — that is the owner's
 * explicit rule, and it is the whole point of the feature being auditable at all.
 *
 * The problem this file solves: `writeAudit` is called from ~700 sites, each passing
 * its own `actorId` from `ctx.auth.userId`. Threading an extra argument through every
 * one of them would be a huge diff that the next new call site silently forgets. So the
 * impersonator rides an AsyncLocalStorage set once per request, and the inversion happens
 * inside `writeAudit` — one seam, every event kind, including the ones not written yet.
 *
 * The store is set ONLY when the caller's JWT actually carries an impersonator claim, so
 * an ordinary request runs with no store at all and behaves exactly as it did before.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface AuditActorOverride {
  /** The real human behind the request — always the Principal who started the session. */
  impersonatorId: string;
  /** The Principal's own role, which becomes the row's `actorRole`. */
  impersonatorRole: string;
  /** The borrowed account: whose data the request is touching. */
  onBehalfOf: string;
}

const storage = new AsyncLocalStorage<AuditActorOverride>();

/** Run `fn` with every audit row it writes attributed to the impersonator. */
export function runWithAuditActor<T>(override: AuditActorOverride, fn: () => T): T {
  return storage.run(override, fn);
}

/** The override in force for this request, or undefined for an ordinary caller. */
export function currentAuditActor(): AuditActorOverride | undefined {
  return storage.getStore();
}
