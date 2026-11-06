/**
 * Quiet record (D-#1016): a person is told about their own mistakes ONLY while they hold
 * `staff_mistakes:view_own` (off by default; the Principal switches it on per role or per
 * person). Someone who is not told gets no "please explain" notice, no decision notice and
 * no warning step — the entry is counted at once and lands in the Principal's daily report.
 * Same check as holdersOf: the role template with the Principal's edits + the person's own
 * grants and revokes. Never throws (an unknown user is simply not told).
 */
import { Types } from "mongoose";
import { callerHasPermission } from "@scd/shared";
import { User } from "../../foundation/models/User";

export const TOLD_PERMISSION = "staff_mistakes:view_own" as const;

export async function isToldAboutMistakes(userId: Types.ObjectId | string): Promise<boolean> {
  try {
    const id = userId.toString();
    if (!Types.ObjectId.isValid(id)) return false;
    const u = await User.findById(id).select("role active additionalTemplates grantedPermissions revokedPermissions").lean();
    if (!u || u.active === false || u.role === "GUARDIAN") return false;
    return callerHasPermission(
      {
        role: u.role,
        additionalTemplates: u.additionalTemplates ?? [],
        grantedPermissions: u.grantedPermissions ?? [],
        revokedPermissions: u.revokedPermissions ?? [],
      },
      TOLD_PERMISSION,
    );
  } catch (err) {
    console.error("[toldAboutMistakes] permission check failed (treated as not told):", err);
    return false;
  }
}
