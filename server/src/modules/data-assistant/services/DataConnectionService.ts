/**
 * Data-assistant connections — the people who let Claude read school data as them
 * (docs/prd-data-assistant-mcp.md §4.4, §11; D-#1536). A "connection" = one person × one OAuth
 * client holding live `resource: "data"` tokens.
 *   myDataConnections      own connections (any staff login) — "Connected apps"
 *   allDataConnectionsPage everyone's, paged (data_assistant:audit, Principal) — "All connections"
 *   revokeDataConnection   own, or anyone's with data_assistant:audit
 *   revokeDataTokensForUser  the automatic cuts: password reset, deactivation, lost permission
 * Every revocation writes a DATA_MCP_REVOKED audit row (actor, person, client, reason, tokens).
 */
import { Types } from "mongoose";
import { callerHasPermission } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { pageOf, type Page, type PageArgs } from "../../../lib/paging";
import { writeAudit } from "../../platform/services/AuditService";
import { User } from "../../foundation/models/User";
import { AiOAuthToken } from "../../ai-workspace/models/AiOAuth";
import { DATA_MAX_AGE_MS, setDataAccessLostHandler } from "../../ai-workspace/mcp/oauth";
import { AiDataCall } from "../models/AiDataCall";

export type DataRevokeReason = "disconnect" | "password_reset" | "deactivated" | "permission_removed";

export interface DataConnectionView {
  userId: string;
  userName: string | null;
  clientId: string;
  clientName: string;
  connectedAt: Date;
  lastUsedAt: Date | null;
  /** The 90-day limit (owner Q10): the person signs in again after this. */
  expiresAt: Date;
  calls30d: number;
}

const LIVE = () => ({ resource: "data", revokedAt: null, refreshExpiresAt: { $gt: new Date() } });

async function connections(match: Record<string, unknown>): Promise<DataConnectionView[]> {
  const live = await AiOAuthToken.aggregate<{ _id: { userId: Types.ObjectId; clientId: string }; clientName: string; grantedAt: Date | null; createdAt: Date; lastUsedAt: Date | null }>([
    { $match: { ...LIVE(), ...match } },
    { $group: { _id: { userId: "$userId", clientId: "$clientId" }, clientName: { $last: "$clientName" }, grantedAt: { $min: "$grantedAt" }, createdAt: { $min: "$createdAt" }, lastUsedAt: { $max: "$lastUsedAt" } } },
    { $sort: { createdAt: -1 } },
  ]);
  if (live.length === 0) return [];
  const since = new Date(Date.now() - 30 * 86_400_000);
  const usage = await AiDataCall.aggregate<{ _id: { userId: Types.ObjectId; clientId: string }; calls: number }>([
    { $match: { surface: "claude", at: { $gte: since }, userId: { $in: live.map((l) => l._id.userId) } } },
    { $group: { _id: { userId: "$userId", clientId: "$clientId" }, calls: { $sum: 1 } } },
  ]);
  const key = (u: Types.ObjectId, c: string) => `${String(u)}|${c}`;
  const calls = new Map(usage.map((u) => [key(u._id.userId, u._id.clientId), u.calls]));
  const users = (await User.find({ _id: { $in: live.map((l) => l._id.userId) } }).select("name").lean()) as Array<{ _id: Types.ObjectId; name?: string }>;
  const names = new Map(users.map((u) => [String(u._id), u.name ?? null]));
  return live.map((l) => {
    const granted = l.grantedAt ?? l.createdAt;
    return {
      userId: String(l._id.userId),
      userName: names.get(String(l._id.userId)) ?? null,
      clientId: l._id.clientId,
      clientName: l.clientName,
      connectedAt: granted,
      lastUsedAt: l.lastUsedAt ?? null,
      expiresAt: new Date(new Date(granted).getTime() + DATA_MAX_AGE_MS),
      calls30d: calls.get(key(l._id.userId, l._id.clientId)) ?? 0,
    };
  });
}

function staff(auth: AuthPayload | null): AuthPayload {
  if (!auth || auth.role === "GUARDIAN") throw new ForbiddenError("Unauthenticated");
  return auth;
}

export async function myDataConnections(authIn: AuthPayload | null): Promise<DataConnectionView[]> {
  const auth = staff(authIn);
  return connections({ userId: new Types.ObjectId(auth.userId) });
}

/** Every person's connections, paged (D-#761). */
export async function allDataConnectionsPage(authIn: AuthPayload | null, args: PageArgs): Promise<Page<DataConnectionView>> {
  const auth = staff(authIn);
  if (!callerHasPermission(auth, "data_assistant:audit")) throw new ForbiddenError("শুধু প্রধান শিক্ষক");
  return pageOf(await connections({}), args, 20);
}

async function revoke(userId: string, clientId: string | null, reason: DataRevokeReason, actor: { userId: string | null; role: string | null }): Promise<number> {
  if (!Types.ObjectId.isValid(userId)) return 0;
  const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId), resource: "data", revokedAt: null };
  if (clientId) filter.clientId = clientId;
  const res = await AiOAuthToken.updateMany(filter, { $set: { revokedAt: new Date() } });
  if (res.modifiedCount > 0) {
    await writeAudit({
      eventKind: "DATA_MCP_REVOKED",
      ...(actor.userId ? { actorId: actor.userId } : {}),
      ...(actor.role ? { actorRole: actor.role } : {}),
      targetKind: "User",
      targetId: userId,
      meta: { reason, clientId, tokens: res.modifiedCount },
    }).catch(() => undefined);
  }
  return res.modifiedCount;
}

/** Disconnect: own connection, or anyone's with data_assistant:audit. */
export async function revokeDataConnection(authIn: AuthPayload | null, clientId: string, userIdIn?: string | null): Promise<boolean> {
  const auth = staff(authIn);
  const userId = userIdIn || auth.userId;
  if (userId !== auth.userId && !callerHasPermission(auth, "data_assistant:audit")) throw new ForbiddenError("শুধু প্রধান শিক্ষক");
  return (await revoke(userId, clientId, "disconnect", { userId: auth.userId, role: auth.role })) > 0;
}

/** The automatic cuts (§4.4 c): every data token of the person, with the reason. */
export async function revokeDataTokensForUser(userId: string, reason: Exclude<DataRevokeReason, "disconnect">, actor: { userId: string | null; role: string | null } = { userId: null, role: null }): Promise<number> {
  return revoke(userId, null, reason, actor);
}

// A data token whose person lost data_assistant:connect or was deactivated is cut on its next use
// (oauth.ts verifyAccessToken calls this), with the reason written to the audit row.
setDataAccessLostHandler(async (userId) => {
  const u = (await User.findById(userId).select("active").lean()) as { active?: boolean } | null;
  await revokeDataTokensForUser(userId, !u || u.active === false ? "deactivated" : "permission_removed");
});
