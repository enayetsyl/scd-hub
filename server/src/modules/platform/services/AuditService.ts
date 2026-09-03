import type { Types } from "mongoose";
import { Audit, type AuditEventKind } from "../models/Audit";
import { currentAuditActor } from "./auditActor";

interface AuditParams {
  eventKind: AuditEventKind;
  actorId?: Types.ObjectId | string;
  actorRole?: string;
  targetId?: Types.ObjectId | string;
  targetKind?: string;
  windowEndedAt?: Date;
  meta?: Record<string, unknown>;
}

/**
 * Attribute a row to the human who actually caused it (D-#638).
 *
 * Ordinary request: returns the params untouched — no store, no change, and every
 * existing row keeps the shape it has always had.
 *
 * Inside a "View as" session: the row names the PRINCIPAL and the borrowed account moves
 * to `onBehalfOf`. The owner's rule is that the log says who moved something, not whose
 * account it moved through, and inverting here means it holds for every event kind the
 * app has — not just the ones someone remembered to update.
 *
 * `onBehalfOf` prefers the call site's own `actorId` over the token's subject: a few
 * writes name a target other than the caller, and the row should record the account the
 * write was actually attributed to before the inversion.
 */
function attribute(params: AuditParams): AuditParams & { onBehalfOf?: Types.ObjectId | string } {
  const override = currentAuditActor();
  if (!override) return params;
  return {
    ...params,
    actorId: override.impersonatorId,
    actorRole: override.impersonatorRole,
    onBehalfOf: params.actorId ?? override.onBehalfOf,
  };
}

/** Fire-and-forget append to the audit log. Never throws — a log failure must
 *  never take down the main request. Failures are logged to stderr only. */
export async function writeAudit(params: AuditParams): Promise<void> {
  try {
    await Audit.create({
      ...attribute(params),
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
      rows.map((r) => ({ ...attribute(r), eventAt })),
      { ordered: false },
    );
  } catch (err) {
    console.error("[AuditService] Failed to write audit batch:", err);
  }
}
