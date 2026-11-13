/**
 * Who may SEE the support-profile / safeguarding audit rows in the Principal's audit log and the
 * person-activity feed (docs/prd-child-support-profile.md §8.4). Holding `audit_log:view` or
 * `audit_log:view_activity` (Office included) is not enough: SUPPORT_* rows name a child and who
 * read their profile, SAFEGUARDING_* rows name a referral. Fail closed: no visibility argument
 * means both families are hidden.
 */
import { callerHasPermission, type Permission } from "@scd/shared";
import type { AuthPayload } from "../../context";

export interface AuditVisibility {
  support: boolean;
  safeguarding: boolean;
}

export function auditVisibility(auth: AuthPayload | null | undefined): AuditVisibility {
  if (!auth) return { support: false, safeguarding: false };
  const support = callerHasPermission(auth, "support_profile:view_all" as Permission);
  // SAFEGUARDING_* needs BOTH: the receiver permission and support view-all.
  const safeguarding = support && callerHasPermission(auth, "safeguarding:receive" as Permission);
  return { support, safeguarding };
}

/** A Mongo clause excluding the families this viewer may not see (null = nothing to exclude). */
export function auditVisibilityClause(v?: AuditVisibility | null): Record<string, unknown> | null {
  const hidden: string[] = [];
  if (!v?.support) hidden.push("SUPPORT_");
  if (!v?.safeguarding) hidden.push("SAFEGUARDING_");
  return hidden.length ? { eventKind: { $not: new RegExp(`^(${hidden.join("|")})`) } } : null;
}
