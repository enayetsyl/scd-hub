/**
 * Monthly-report access gates (PM, docs/permission-catalogue/observation-comments-reports.md).
 *
 * The `monthly_report` catalogue actions replace the role checks the report used to ride:
 *   view       a শাখা's reports in read scope (was tracker:read; Office passed by role)
 *   view_all   any শাখা unscoped + the fee block (was isAdminStaff / "not a TEACHER")
 *   override   release a coverage-blocked / hard-locked report (was primary role PRINCIPAL)
 * The resolver, the PDF route and the comment-export route share these, so a route can
 * never be a wider door than the GraphQL read.
 */
import type { Types } from "mongoose";
import { callerHasPermission, type Permission } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError, assertCanRead, allowedSubjectCodesForSection } from "../../../middleware/authz";
import { Section } from "../../foundation/models/Section";

const VIEW_ALL: Permission = "monthly_report:view_all";

/** True when the (staff) caller holds `perm`. A guardian never holds a catalogue action. */
export function holdsMonthly(ctx: AppContext, perm: Permission): boolean {
  return !!ctx.auth && ctx.auth.role !== "GUARDIAN" && callerHasPermission(ctx.auth, perm);
}

/** Throw unless the caller holds `perm`; returns the caller's id. */
export function requireMonthly(ctx: AppContext, perm: Permission): string {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!holdsMonthly(ctx, perm)) throw new ForbiddenError("এই কাজের অনুমতি নেই");
  return ctx.auth.userId as string;
}

/** Staff read of a section's monthly reports: `monthly_report:view_all` unscoped; else
 *  `monthly_report:view` + read scope on the section. Guardians are denied here (their
 *  path is the guardian-link gate). */
export async function assertMonthlyReportRead(ctx: AppContext, sectionId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (holdsMonthly(ctx, VIEW_ALL)) return;
  if (!holdsMonthly(ctx, "monthly_report:view")) throw new ForbiddenError();
  const section = (await Section.findById(sectionId).select("classId").lean()) as { classId: Types.ObjectId } | null;
  if (!section) throw new ForbiddenError("Section not found");
  await assertCanRead(ctx, sectionId, section.classId.toString(), undefined, { viewAll: VIEW_ALL });
}

/** The SP-1 subject narrowing for this caller (null = whole report). */
export async function monthlyReportSubjects(
  ctx: AppContext,
  sectionId: string,
  classId: string,
): Promise<string[] | null> {
  const allowed = await allowedSubjectCodesForSection(ctx, sectionId, classId, {
    classTeacherOversight: true,
    viewAll: VIEW_ALL,
  });
  return allowed === null ? null : [...allowed];
}

/** The fee block is shown to holders of `monthly_report:view_all` (owner call; was
 *  "hidden for primary role TEACHER"). */
export function seesMonthlyFees(ctx: AppContext): boolean {
  return holdsMonthly(ctx, VIEW_ALL);
}

/** May release past a coverage block / hard lock with a reason (`monthly_report:override`,
 *  default Principal only — was primary role PRINCIPAL, D-#397). */
export function canOverrideMonthly(ctx: AppContext): boolean {
  return holdsMonthly(ctx, "monthly_report:override");
}
