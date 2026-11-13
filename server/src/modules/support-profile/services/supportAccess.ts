/**
 * Who may touch a support profile (docs/prd-child-support-profile.md §8, D-#1547/#1548).
 *
 *  - Office and guardians are refused by a HARD role check on every resolver, whatever is stored:
 *    a stale grant cannot leak (a role check that protects a target — ROLE_CHECK_BASELINE).
 *  - "View as" (D-#638): refused unless the REAL person holds support_profile:view_all.
 *  - Readers = currentSupportReaders (§8.2); the Principal passes through view_all.
 *  - The feature ships OFF: until it is switched on, only a view_all holder gets in (CSP-6).
 *  - A refused read by authenticated staff writes SUPPORT_ACCESS_REFUSED (no text).
 */
import { callerHasPermission, type Permission } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { writeAudit } from "../../platform/services/AuditService";
import { User } from "../../foundation/models/User";
import { SupportSetting } from "../models/SupportSetting";
import { SupportProfileRefusal } from "./errors";
import { readerOf, type SupportReaderVia } from "./supportScope";

export interface SupportCtx {
  auth: AuthPayload | null;
}

export const REFUSED_BN = "এই শিক্ষার্থীর সহায়তা প্রোফাইল দেখার অনুমতি নেই।";
export const OFF_BN = "শিক্ষার্থী সহায়তা প্রোফাইল এখনো চালু হয়নি।";

/** The role guard of §8.1: the only role check in the feature (baseline-registered). */
export function refusedRole(role: string): boolean {
  return role === "OFFICE" || role === "GUARDIAN";
}

const has = (auth: AuthPayload, p: string): boolean => callerHasPermission(auth, p as Permission);

/** The signed-in staff member, after the hard role and "view as" guards. */
export async function supportCaller(ctx: SupportCtx, opts: { noViewAs?: boolean } = {}): Promise<AuthPayload> {
  const auth = ctx.auth;
  if (!auth) throw new SupportProfileRefusal("লগইন প্রয়োজন।");
  if (refusedRole(auth.role)) {
    await writeAudit({ eventKind: "SUPPORT_ACCESS_REFUSED", actorId: auth.userId, actorRole: auth.role, meta: { reason: "ROLE" } });
    throw new SupportProfileRefusal(REFUSED_BN);
  }
  if (auth.impersonatorId) {
    if (opts.noViewAs) throw new SupportProfileRefusal("\"দেখুন যেভাবে\" অবস্থায় এটি করা যায় না।");
    const real = await User.findById(auth.impersonatorId).select("role additionalTemplates grantedPermissions revokedPermissions").lean();
    if (!real || !callerHasPermission(real as never, "support_profile:view_all" as Permission)) {
      await writeAudit({ eventKind: "SUPPORT_ACCESS_REFUSED", actorId: auth.userId, actorRole: auth.role, meta: { reason: "VIEW_AS" } });
      throw new SupportProfileRefusal(REFUSED_BN);
    }
  }
  return auth;
}

export const holdsViewAll = (auth: AuthPayload): boolean => has(auth, "support_profile:view_all");
export const holdsApprove = (auth: AuthPayload): boolean => has(auth, "support_profile:approve");

export async function getSupportSetting() {
  return (await SupportSetting.findOne({ key: "main" })) ?? (await SupportSetting.create({ key: "main" }));
}
export async function isSwitchedOn(): Promise<boolean> {
  const s = await SupportSetting.findOne({ key: "main" }).select("switchedOnKey").lean();
  return !!s?.switchedOnKey;
}

export interface ChildAccess {
  /** ALL = the Principal through view_all; READER = a current teacher. */
  mode: "ALL" | "READER";
  readerVia: SupportReaderVia | "PRINCIPAL";
}

/**
 * May this caller read (or write about) this child now? `need` names the teacher action the
 * caller must hold (`view` to read, `report` to write). Refusal is audited.
 */
export async function accessToChild(ctx: SupportCtx, studentId: string, need: "view" | "report"): Promise<ChildAccess & { auth: AuthPayload }> {
  const auth = await supportCaller(ctx);
  if (holdsViewAll(auth)) return { auth, mode: "ALL", readerVia: "PRINCIPAL" };
  const refuse = async (reason: string): Promise<never> => {
    await writeAudit({ eventKind: "SUPPORT_ACCESS_REFUSED", actorId: auth.userId, actorRole: auth.role, targetId: studentId, targetKind: "Student", meta: { studentId, reason } });
    throw new SupportProfileRefusal(reason === "OFF" ? OFF_BN : REFUSED_BN);
  };
  if (!(await isSwitchedOn())) return refuse("OFF");
  if (!has(auth, `support_profile:${need}`)) return refuse("PERMISSION");
  const r = await readerOf(studentId, auth.userId);
  if (!r) return refuse("NOT_A_READER");
  return { auth, mode: "READER", readerVia: r.via };
}
