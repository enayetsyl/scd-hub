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
import { Section } from "../modules/foundation/models/Section";

export class ForbiddenError extends Error {
  constructor(msg = "Forbidden") {
    super(msg);
    this.name = "ForbiddenError";
  }
}

/** Pure predicate: is `userId` the section's assigned class teacher? */
export function isClassTeacher(
  classTeacherId: string | null | undefined,
  userId: string,
): boolean {
  return !!classTeacherId && classTeacherId === userId;
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

/**
 * Assert the caller is the section's CLASS TEACHER — the only role that may run
 * homework reconciliation + confirm-issue (handoff §9 / D-#42). Stricter than
 * assertCanWrite: even a teaching/proxy teacher on the section is denied unless
 * they are the assigned class teacher. Principal/Office are NOT auto-allowed here
 * (the daily-coordinator role is intentionally specific); they assign the class
 * teacher via `assignClassTeacher` instead.
 */
export async function assertIsClassTeacher(ctx: AppContext, sectionId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const section = await Section.findById(sectionId).lean();
  if (!section) throw new ForbiddenError("Section not found");
  const ctId = section.classTeacherId ? section.classTeacherId.toString() : null;
  if (!isClassTeacher(ctId, ctx.auth.userId)) {
    throw new ForbiddenError(
      "Only the section's class teacher may reconcile/confirm homework (handoff §9)",
    );
  }
}
