import type { Types } from "mongoose";
import { Audit, type AuditEventKind } from "../models/Audit";

interface AuditParams {
  eventKind: AuditEventKind;
  actorId?: Types.ObjectId | string;
  actorRole?: string;
  targetId?: Types.ObjectId | string;
  targetKind?: string;
  windowEndedAt?: Date;
  meta?: Record<string, unknown>;
}

/** Fire-and-forget append to the audit log. Never throws — a log failure must
 *  never take down the main request. Failures are logged to stderr only. */
export async function writeAudit(params: AuditParams): Promise<void> {
  try {
    await Audit.create({
      ...params,
      eventAt: new Date(),
    });
  } catch (err) {
    console.error("[AuditService] Failed to write audit event:", err);
  }
}
