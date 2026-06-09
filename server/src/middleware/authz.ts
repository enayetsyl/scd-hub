/**
 * Resolver-level authorization helpers (ADR-004).
 *
 * The Pothos auth-scopes plugin (schema.ts) handles the role-level RBAC check.
 * This module provides the row-scope guard that resolvers call AFTER the RBAC
 * check passes — enforcing PoLP + the corpus/identity plane boundary.
 *
 * Usage in a resolver:
 *   const { scopes } = await requireTeacherScope(ctx, sectionId, classId);
 *   if (!scopes) throw new ForbiddenError();
 */

import type { AppContext } from "../context";
import {
  composeTeacherScope,
  canRead,
  canWrite,
  stampProxyExpired,
  proxyWindowEnd,
  type ScopeItem,
} from "../modules/foundation/services/ScopeGrantService";
import { ScopeGrant } from "../modules/foundation/models/ScopeGrant";

export class ForbiddenError extends Error {
  constructor(msg = "Forbidden") {
    super(msg);
    this.name = "ForbiddenError";
  }
}

/** Builds the teacher's scope union and stamps any expired proxy grants.
 *  Returns the scope list; callers then call canRead / canWrite. */
export async function resolveTeacherScopes(ctx: AppContext): Promise<ScopeItem[]> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

  const now = new Date();
  const { scopes, expiredProxyGrantIds } = await composeTeacherScope(ctx.auth.userId, now);

  // Stamp expiry audit events for any grants discovered expired this request (D-#21)
  for (const grantId of expiredProxyGrantIds) {
    const grant = await ScopeGrant.findById(grantId).lean();
    if (!grant || grant.kind !== "proxy") continue;
    const pg = grant as unknown as { startDate?: Date; durationDays?: number };
    if (!pg.startDate || pg.durationDays === undefined) continue;
    const windowEndedAt = proxyWindowEnd(pg.startDate, pg.durationDays);
    // Fire-and-forget — don't let audit failure block the request
    stampProxyExpired(grantId, ctx.auth.userId, windowEndedAt).catch((e) =>
      console.error("[authz] stampProxyExpired failed:", e),
    );
  }

  return scopes;
}

/** Assert the caller can read the given section. Used in content/question resolvers. */
export async function assertCanRead(
  ctx: AppContext,
  sectionId: string,
  classId: string,
  subjectId?: string,
): Promise<void> {
  if (ctx.auth?.role === "PRINCIPAL" || ctx.auth?.role === "OFFICE") return;
  if (ctx.auth?.role === "GUARDIAN") throw new ForbiddenError();
  const scopes = await resolveTeacherScopes(ctx);
  if (!canRead(scopes, sectionId, classId, subjectId)) throw new ForbiddenError();
}

/** Assert the caller can write (assemble/tracker) for the given section. */
export async function assertCanWrite(ctx: AppContext, sectionId: string): Promise<void> {
  if (ctx.auth?.role === "PRINCIPAL") return;
  if (ctx.auth?.role === "OFFICE" || ctx.auth?.role === "GUARDIAN") throw new ForbiddenError();
  const scopes = await resolveTeacherScopes(ctx);
  if (!canWrite(scopes, sectionId)) throw new ForbiddenError();
}
