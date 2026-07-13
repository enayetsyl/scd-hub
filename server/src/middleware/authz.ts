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
import { Subject } from "../modules/foundation/models/Subject";
import { User } from "../modules/foundation/models/User";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";

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

/**
 * The subject CODES the caller may see on a section's tracker lists (homework /
 * assignment records), or `null` for unrestricted (all subjects). Called AFTER
 * assertCanRead — this narrows a permitted section read down to the subjects the
 * caller actually teaches, so a Science teacher no longer sees English homework.
 *
 * Unrestricted (`null`): Principal/Office; the section's class teacher (daily
 * coordinator, D-#42/#45) + homework-confirm delegate + school-wide homework
 * supervisor (they reconcile the whole day); whole-school / matching grade_class
 * supervisory scopes; a legacy subject-less proxy grant on the section.
 *
 * Otherwise: the union of the caller's teaching / proxy / subject-scoped
 * supervisory grants on this section, mapped to Subject codes. An empty set is
 * possible (read reached the section some other way) — callers then show nothing.
 */
export async function allowedSubjectCodesForSection(
  ctx: AppContext,
  sectionId: string,
  classId: string,
): Promise<Set<string> | null> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role === "PRINCIPAL" || ctx.auth.role === "OFFICE") return null;
  if (ctx.auth.role === "GUARDIAN") throw new ForbiddenError();

  const userId = ctx.auth.userId as string;
  const section = await Section.findById(sectionId)
    .select("classTeacherId homeworkConfirmerId")
    .lean();
  if (section) {
    const ctId = section.classTeacherId ? section.classTeacherId.toString() : null;
    const delegateId = section.homeworkConfirmerId ? section.homeworkConfirmerId.toString() : null;
    if (userId === ctId || userId === delegateId) return null;
  }
  const me = await User.findById(userId).select("homeworkSupervisor").lean();
  if (me?.homeworkSupervisor) return null;

  const scopes = await resolveTeacherScopes(ctx);
  const subjectIds = new Set<string>();
  for (const s of scopes) {
    if (s.kind === "teaching" && s.sectionId === sectionId) {
      subjectIds.add(s.subjectId);
    } else if (s.kind === "proxy" && s.sectionId === sectionId) {
      if (!s.subjectId) return null; // pre-D-#257 subject-less proxy = whole section
      subjectIds.add(s.subjectId);
    } else if (s.kind === "supervisory") {
      switch (s.extent) {
        case "whole_school":
          return null;
        case "grade_class":
          if (s.classId === classId) return null;
          break;
        case "subject_dept":
          if (s.subjectId) subjectIds.add(s.subjectId);
          break;
        case "explicit_set":
          for (const e of s.explicitSet ?? []) {
            if (e.classId === classId) subjectIds.add(e.subjectId);
          }
          break;
      }
    }
  }

  if (subjectIds.size === 0) return new Set();
  const subjects = await Subject.find({ _id: { $in: [...subjectIds] } })
    .select("code")
    .lean();
  return new Set(subjects.map((s) => s.code));
}

/** Assert the caller can write (assemble/tracker) for the given section.
 *  `subjectId` narrows proxy grants for subject-specific actions.
 */
export async function assertCanWrite(
  ctx: AppContext,
  sectionId: string,
  subjectId?: string,
): Promise<void> {
  if (ctx.auth?.role === "PRINCIPAL") return;
  if (ctx.auth?.role === "OFFICE" || ctx.auth?.role === "GUARDIAN") throw new ForbiddenError();
  const scopes = await resolveTeacherScopes(ctx);
  if (!canWrite(scopes, sectionId, subjectId)) throw new ForbiddenError();
}

/**
 * Assert the caller is the section's CLASS TEACHER — the section's **daily
 * coordinator** (D-#42). This is the GENERAL coordinator gate (CT-1/CT1.1), reused
 * by every coordinator-only action: homework reconciliation today, and the future
 * attendance / leave-approval / report-card-sign-off / parent-comms duties (each
 * module calls this rather than re-deciding "who's in charge", D-#45).
 *
 * Stricter than assertCanWrite: even a teaching/proxy teacher on the section is
 * denied unless they are the assigned class teacher; a SUPPORT teacher (D-#53) does
 * NOT pass. Principal/Office are NOT auto-allowed (the coordinator is intentionally
 * specific); they assign the class teacher via `assignClassTeacher` instead.
 */
/**
 * Assert the caller is an ACTIVE guardian of the given student — the guardian
 * portal's row-scope gate (GP-1, D-#68). Link-scoped, never grant-scoped: access
 * rides an ACTIVE `GuardianLink` between the calling Guardian (the JWT subject)
 * and the student. Uniform access — every linked guardian gets the same view
 * (D-#8). Default-deny; ForbiddenError messages are Bangla (NFR-5).
 *
 * A link with NO `active` field is active (pre-GP-1 rows predate the field and
 * lean reads skip schema defaults); only an explicit `active: false` denies.
 */
export async function assertGuardianOfStudent(ctx: AppContext, studentId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role !== "GUARDIAN") {
    throw new ForbiddenError("শুধুমাত্র অভিভাবক অ্যাকাউন্ট এই তথ্য দেখতে পারে");
  }
  const guardian = await Guardian.findById(ctx.auth.userId).lean();
  if (!guardian || !guardian.active) {
    throw new ForbiddenError("অভিভাবক অ্যাকাউন্টটি সক্রিয় নয়");
  }
  const link = await GuardianLink.findOne({
    guardianId: ctx.auth.userId,
    studentId,
  }).lean();
  if (!link || link.active === false) {
    throw new ForbiddenError("এই শিক্ষার্থীর তথ্য দেখার অনুমতি নেই");
  }
}

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

/**
 * Homework reconcile/confirm gate (broader than `assertIsClassTeacher`): permits the
 * PRINCIPAL (any section), the section's class teacher, OR a Principal-assigned
 * homework-confirm delegate (`Section.homeworkConfirmerId`). Used by confirmHomeworkDay
 * + trimHomeworkItem so the day can be issued when the class teacher is unavailable.
 */
export async function assertCanConfirmHomework(ctx: AppContext, sectionId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role === "PRINCIPAL") return; // Principal may confirm any section
  const section = await Section.findById(sectionId).lean();
  if (!section) throw new ForbiddenError("Section not found");
  const ctId = section.classTeacherId ? section.classTeacherId.toString() : null;
  const delegateId = section.homeworkConfirmerId ? section.homeworkConfirmerId.toString() : null;
  if (ctx.auth.userId === ctId || ctx.auth.userId === delegateId) return;
  // School-wide homework supervisor (read live — immediate, not JWT-baked) may confirm any section.
  const me = await User.findById(ctx.auth.userId).select("homeworkSupervisor").lean();
  if (me?.homeworkSupervisor) return;
  throw new ForbiddenError(
    "Only the class teacher, the assigned homework delegate, a homework supervisor, or the Principal may confirm homework",
  );
}
