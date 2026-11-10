/**
 * The Principal's view of the MCP bridge (W-5, D-#1214): which clients (Claude, Claude Code)
 * hold live tokens, how they were used, and "disconnect" (revokes every token of the client).
 * `ai_workspace:admin` only.
 */

import { callerHasPermission } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { writeAudit } from "../../platform/services/AuditService";
import { AiMcpCall, AiOAuthToken } from "../models/AiOAuth";

function assertAdmin(auth: AuthPayload | null): AuthPayload {
  if (!auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(auth, "ai_workspace:admin")) throw new ForbiddenError("শুধু প্রধান শিক্ষক");
  return auth;
}

export interface McpConnectionView {
  clientId: string;
  clientName: string;
  connectedAt: Date;
  lastUsedAt: Date | null;
  calls30d: number;
  replyKb30d: number;
}

export async function mcpConnections(authIn: AuthPayload | null): Promise<McpConnectionView[]> {
  assertAdmin(authIn);
  const live = await AiOAuthToken.aggregate<{ _id: string; clientName: string; connectedAt: Date; lastUsedAt: Date | null }>([
    { $match: { revokedAt: null, refreshExpiresAt: { $gt: new Date() } } },
    { $group: { _id: "$clientId", clientName: { $last: "$clientName" }, connectedAt: { $min: "$createdAt" }, lastUsedAt: { $max: "$lastUsedAt" } } },
    { $sort: { connectedAt: -1 } },
  ]);
  const since = new Date(Date.now() - 30 * 86400_000);
  const usage = await AiMcpCall.aggregate<{ _id: string; calls: number; bytes: number }>([
    { $match: { at: { $gte: since } } },
    { $group: { _id: "$clientName", calls: { $sum: 1 }, bytes: { $sum: "$replyBytes" } } },
  ]);
  const byName = new Map(usage.map((u) => [u._id, u]));
  return live.map((c) => ({
    clientId: c._id,
    clientName: c.clientName,
    connectedAt: c.connectedAt,
    lastUsedAt: c.lastUsedAt ?? null,
    calls30d: byName.get(c.clientName)?.calls ?? 0,
    replyKb30d: Math.round((byName.get(c.clientName)?.bytes ?? 0) / 102.4) / 10,
  }));
}

export async function revokeMcpConnection(authIn: AuthPayload | null, clientId: string): Promise<boolean> {
  const auth = assertAdmin(authIn);
  const res = await AiOAuthToken.updateMany({ clientId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  await writeAudit({ eventKind: "AI_MCP_REVOKED", actorId: auth.userId, actorRole: auth.role, targetKind: "AiOAuthClient", meta: { clientId, tokens: res.modifiedCount } });
  return res.modifiedCount > 0;
}

