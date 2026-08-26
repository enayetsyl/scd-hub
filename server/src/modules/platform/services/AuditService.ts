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

/**
 * The same append, for MANY rows in ONE round trip (D-#549).
 *
 * Identical semantics to calling `writeAudit` per row — same fields, same stamping, same
 * never-throws contract — and it exists purely because the per-row version costs a network
 * round trip each. A bulk operation over 244 questions was spending more time writing its
 * audit log than doing the work the log describes.
 *
 * `ordered: false` so one rejected row cannot discard the rest of the batch; the audit log
 * is append-only, and a partial log beats no log.
 */
export async function writeAuditMany(rows: AuditParams[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    const eventAt = new Date();
    await Audit.insertMany(
      rows.map((r) => ({ ...r, eventAt })),
      { ordered: false },
    );
  } catch (err) {
    console.error("[AuditService] Failed to write audit batch:", err);
  }
}
