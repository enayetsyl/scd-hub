/**
 * "Who acts as this role?" — the ONE place that answers it, for permission gates and
 * for recipient lookups alike (D-#468).
 *
 * WHY THIS EXISTS. AC-1 (D-#193) made a role a TEMPLATE: a Principal can hand a teacher
 * the OFFICE template, and `effectivePermissions` then grants that teacher every OFFICE
 * permission. But a bare `ctx.auth.role === "OFFICE"` — and a bare
 * `User.find({ role: "OFFICE" })` — both read the PRIMARY role only, so they are the two
 * places that silently ignore what the Principal granted. The symptoms were a two-hat
 * login that held every office permission yet still got "ড্যাশবোর্ড অফিস/অধ্যক্ষের জন্য"
 * on the office dashboard, and an office-by-template user who never received a single
 * class-test/print/leave notification (D-#467 shipped the switcher and fixed four such
 * gates; this closes the rest of the READ + NOTIFY surface).
 *
 * SCOPE, deliberately: these helpers back READ gates and recipient lookups only. The
 * WRITE side — `assertCanWrite`, `assertCanConfirmHomework`, `contentScope`, the
 * PRINCIPAL-only vocab/support-book gates, monthly-report release — still compares the
 * primary role, because widening those changes what a person can DO, not merely what
 * they can SEE, and that is its own decision (recorded in D-#468).
 */
import { actsAsRole, type Role } from "@scd/shared";
import type { AuthPayload } from "../../../context";

/** Does this caller act as `role` — by primary role OR by an added template? */
export function actsAs(auth: AuthPayload | null | undefined, role: Role): boolean {
  return !!auth && actsAsRole(auth, role);
}

/** The "unscoped oversight staff" test: Principal or Office, by role or by template.
 *  This is the replacement for `role === "PRINCIPAL" || role === "OFFICE"` in a READ gate. */
export function isAdminStaff(auth: AuthPayload | null | undefined): boolean {
  return actsAs(auth, "PRINCIPAL") || actsAs(auth, "OFFICE");
}

/** Principal only (still template-aware — a PRINCIPAL template is never assignable
 *  today, so in practice this is the primary role, but it stays consistent). */
export function isPrincipalStaff(auth: AuthPayload | null | undefined): boolean {
  return actsAs(auth, "PRINCIPAL");
}

/** Mongo filter for "every ACTIVE user who acts as one of these roles" — matches the
 *  primary role OR an added template. The replacement for
 *  `{ role: { $in: [...] }, active: true }` in every recipient lookup, so a notification
 *  reaches the person doing the job rather than the person whose column happens to say so. */
export function actingAsFilter(roles: readonly Role[]): Record<string, unknown> {
  return {
    active: true,
    $or: [{ role: { $in: [...roles] } }, { additionalTemplates: { $in: [...roles] } }],
  };
}
