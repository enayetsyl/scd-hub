/**
 * Display names for bare user ids (D-#404: no populate across planes). The ONE place in the
 * book-lifecycle module, besides the resolvers, that reads the identity plane — and only `name`.
 * firewall.test.ts pins this.
 */
import { Types } from "mongoose";
import type { Permission } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { User } from "../../foundation/models/User";

export async function namesOf(ids: (Types.ObjectId | string | undefined | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter(Boolean).map((x) => String(x)))].filter((x) => Types.ObjectId.isValid(x));
  if (!list.length) return new Map();
  const rows = await User.find({ _id: { $in: list } }).select("name").lean();
  return new Map(rows.map((u) => [u._id.toString(), u.name]));
}

/** Of these user ids, the active staff logins (never a guardian). */
export async function activeStaffIds(ids: string[]): Promise<string[]> {
  const list = ids.filter((x) => Types.ObjectId.isValid(x));
  if (!list.length) return [];
  const rows = await User.find({ _id: { $in: list }, active: true, role: { $ne: "GUARDIAN" } }).select("_id").lean();
  return rows.map((r) => r._id.toString());
}

/** The caller rebuilt from the User row (an active staff login) — for doors that carry no session:
 *  a single-use upload link (BL-4) and the AI job worker (BL-5). Permissions are re-read each time. */
export async function activeAuthOf(userId: Types.ObjectId | string): Promise<AuthPayload | null> {
  if (!Types.ObjectId.isValid(String(userId))) return null;
  const u = await User.findOne({ _id: userId, active: true, role: { $ne: "GUARDIAN" } }).select("role additionalTemplates grantedPermissions revokedPermissions").lean();
  if (!u) return null;
  return { userId: String(userId), role: u.role, additionalTemplates: u.additionalTemplates ?? [], grantedPermissions: (u.grantedPermissions ?? []) as Permission[], revokedPermissions: (u.revokedPermissions ?? []) as Permission[] } as AuthPayload;
}
