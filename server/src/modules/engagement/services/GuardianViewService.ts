/**
 * GuardianViewService (GE-2, D-#465) — the write half of guardian view tracking.
 *
 * `recordView` is the ONLY writer. It follows the writeAudit posture (ADR-008): a
 * telemetry failure must never take down a guardian's request, so it swallows its own
 * errors to stderr and always resolves. Losing a view row costs a count; failing the
 * request costs the family their child's homework.
 */
import { Types } from "mongoose";
import { GUARDIAN_VIEW_SURFACES } from "@scd/shared";
import type { GuardianViewSurface } from "@scd/shared";
import { GuardianView } from "../models/GuardianView";
import { dhakaDayKey } from "../../../lib/dhakaDay";

export interface RecordViewParams {
  /** Derived from the auth token by the resolver — NEVER from a client argument. */
  guardianId: string | Types.ObjectId;
  surface: string;
  studentId?: string | null;
  refId?: string | null;
}

function isSurface(s: string): s is GuardianViewSurface {
  return (GUARDIAN_VIEW_SURFACES as readonly string[]).includes(s);
}

/** True when the row was recorded. False = rejected/failed, and the caller ignores it. */
export async function recordView(params: RecordViewParams): Promise<boolean> {
  try {
    // An unknown surface is DROPPED, not stored. A typo'd string would otherwise
    // become a permanent phantom row in the popularity ranking that no code ever
    // writes again and no one can explain.
    if (!isSurface(params.surface)) return false;

    const now = new Date();
    const filter: Record<string, unknown> = {
      guardianId: new Types.ObjectId(params.guardianId),
      surface: params.surface,
      dayKey: dhakaDayKey(now),
    };
    // Keys must be ABSENT (not null) to match the unique index's missing-value slot.
    if (params.refId) filter.refId = params.refId;
    if (params.studentId && Types.ObjectId.isValid(params.studentId)) {
      filter.studentId = new Types.ObjectId(params.studentId);
    }

    await GuardianView.updateOne(
      filter,
      { $inc: { count: 1 }, $set: { lastAt: now }, $setOnInsert: { firstAt: now } },
      { upsert: true },
    );
    return true;
  } catch (err) {
    console.error("[GuardianViewService] failed to record view:", err);
    return false;
  }
}
