/**
 * Both doors rebuild the caller from the `User` row on every call (docs/prd-data-assistant-mcp.md
 * §4.4 "Fresh permissions"): a grant, revoke or deactivation applies on the next call, not at
 * token expiry. The pattern of `workspaceAdminAuth` (ai-workspace/mcp/oauth.ts).
 *
 * "View as" (§5.3, owner Q11): a borrowed token keeps the BORROWED account's id and role; the
 * impersonator is carried through so the door check and the log can name them.
 */
import { Types } from "mongoose";
import { callerHasPermission, type Permission } from "@scd/shared";
import type { AuthPayload } from "../../context";
import { User } from "../foundation/models/User";
import type { DataSurface } from "./types";

export async function freshAuth(userId: string, carry?: Pick<AuthPayload, "impersonatorId" | "impersonatorRole">): Promise<AuthPayload | null> {
  if (!Types.ObjectId.isValid(userId)) return null;
  const u = await User.findOne({ _id: userId, active: true }).select("role additionalTemplates grantedPermissions revokedPermissions").lean();
  if (!u) return null;
  return {
    userId: String(userId),
    role: u.role,
    additionalTemplates: u.additionalTemplates ?? [],
    grantedPermissions: (u.grantedPermissions ?? []) as Permission[],
    revokedPermissions: (u.revokedPermissions ?? []) as Permission[],
    ...(carry?.impersonatorId ? { impersonatorId: carry.impersonatorId, impersonatorRole: carry.impersonatorRole } : {}),
  };
}

/** The door switch each surface needs (§5.1). */
export const DOOR_PERMISSION: Record<DataSurface, Permission> = {
  in_app: "data_assistant:use",
  claude: "data_assistant:connect",
  chatgpt: "data_assistant:connect",
};

/**
 * May this person open this door at all? GUARDIAN never. In-app "View as" (OPEN-3, settled from
 * the code: `impersonatorId` is only ever minted in-app by ImpersonationService): a borrowed login
 * without `data_assistant:use` is let through ONLY when the impersonator, re-read fresh, holds it.
 * Over OAuth there is never an impersonator (a fresh password login).
 */
export async function doorOpen(auth: AuthPayload, surface: DataSurface): Promise<boolean> {
  if (auth.role === "GUARDIAN") return false;
  const perm = DOOR_PERMISSION[surface];
  if (callerHasPermission(auth, perm)) return true;
  if (surface === "in_app" && auth.impersonatorId) {
    const imp = await freshAuth(auth.impersonatorId);
    return !!imp && imp.role !== "GUARDIAN" && callerHasPermission(imp, perm);
  }
  return false;
}
