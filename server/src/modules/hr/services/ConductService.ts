/**
 * ConductService (HR-4; prd-hr §5.2, H5.3, D-#113) — the disciplinary ladder with
 * enforced order + recorded due-process hearing + gross-misconduct fast-track.
 *
 *   recordConductStep   — raise a `draft` step; the ladder order is asserted first
 *                         (verbal→written→final→termination, no rung-skip; gross
 *                         misconduct may jump to final/termination).
 *   recordConductHearing— capture the person's response/hearing BEFORE finalisation
 *                         (*'adl*, not optional) → `hearing_held`.
 *   finalizeConductStep — the disciplinary judgement (Principal-only at the resolver):
 *                         requires a recorded hearing; a `termination` step writes
 *                         employmentStatus → terminated (the offboarding trigger).
 *   lapseExpiredConduct — LAZY warning lapse (D-#21 posture): a finalised step past
 *                         its `liveUntil` → `lapsed`, stays on file, stops counting.
 *
 * Confidential (satr): Principal/Office + the subject's own record (H5.5); supervisors
 * never see conduct. Identity plane, behind the ADR-005 firewall (NO corpus path).
 */
import { Types } from "mongoose";
import type { ConductStage } from "@scd/shared";
import { ConductRecord, type IConductRecord } from "../models/ConductRecord";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { writeAudit } from "../../platform/services/AuditService";
import { assertStageAllowed, isLiveForEscalation, PerformanceError } from "./conductLadder";
import { parseDateKey } from "./dates";

/** Lazily lapse any finalised warning whose `liveUntil` has passed (D-#21 posture).
 *  Stamps `status: "lapsed"` (stays on file, never deleted) + audits once per lapse. */
export async function lapseExpiredConduct(staffProfileId: string, now: Date = new Date()): Promise<void> {
  const expired = await ConductRecord.find({
    staffProfileId: new Types.ObjectId(staffProfileId),
    status: "finalized",
    liveUntil: { $ne: null, $lt: now },
  })
    .select("_id stage liveUntil")
    .lean();
  for (const r of expired) {
    await ConductRecord.updateOne({ _id: r._id, status: "finalized" }, { status: "lapsed" });
    await writeAudit({
      eventKind: "CONDUCT_WARNING_LAPSED",
      actorId: undefined,
      targetId: r._id,
      targetKind: "ConductRecord",
      meta: { staffProfileId, stage: r.stage, liveUntil: r.liveUntil },
    });
  }
}

/** The staff member's currently-live finalised ladder stages (lapse applied first). */
async function liveFinalizedStages(staffProfileId: string, now: Date): Promise<ConductStage[]> {
  await lapseExpiredConduct(staffProfileId, now);
  const rows = await ConductRecord.find({
    staffProfileId: new Types.ObjectId(staffProfileId),
    status: "finalized",
  })
    .select("stage status liveUntil")
    .lean();
  return rows
    .filter((r) => isLiveForEscalation(r as { status: string; liveUntil?: Date | null }, now))
    .map((r) => r.stage as ConductStage);
}

export interface RecordConductInput {
  staffProfileId: string;
  stage: ConductStage;
  issue: string;
  category?: string;
  evidence?: string;
  grossMisconduct?: boolean;
  actorId: string;
}

export async function recordConductStep(input: RecordConductInput): Promise<IConductRecord> {
  if (!input.issue.trim()) throw new PerformanceError("An issue description is required");
  const staff = await StaffProfile.findById(input.staffProfileId).select("active").lean();
  if (!staff) throw new PerformanceError("Staff profile not found");

  const now = new Date();
  const liveStages = await liveFinalizedStages(input.staffProfileId, now);
  // Enforce the ladder order (or the gross-misconduct fast-track).
  assertStageAllowed(input.stage, liveStages, !!input.grossMisconduct);

  const rec = await ConductRecord.create({
    staffProfileId: new Types.ObjectId(input.staffProfileId),
    stage: input.stage,
    status: "draft",
    grossMisconduct: !!input.grossMisconduct,
    issue: input.issue.trim(),
    category: input.category?.trim() ?? null,
    evidence: input.evidence?.trim() ?? null,
    issuedBy: new Types.ObjectId(input.actorId),
  });

  await writeAudit({
    eventKind: "CONDUCT_STEP_RECORDED",
    actorId: input.actorId,
    targetId: rec._id,
    targetKind: "ConductRecord",
    meta: { staffProfileId: input.staffProfileId, stage: input.stage, grossMisconduct: !!input.grossMisconduct },
  });
  return rec;
}

export async function recordConductHearing(
  recordId: string,
  hearingNote: string,
  actorId: string,
): Promise<IConductRecord> {
  if (!hearingNote.trim()) throw new PerformanceError("A hearing/response note is required ('adl)");
  const rec = await ConductRecord.findById(recordId);
  if (!rec) throw new PerformanceError("Conduct record not found");
  if (rec.status !== "draft" && rec.status !== "hearing_held") {
    throw new PerformanceError("A hearing can only be recorded before the step is finalised");
  }
  rec.hearingNote = hearingNote.trim();
  rec.hearingHeldAt = new Date();
  rec.status = "hearing_held";
  await rec.save();

  await writeAudit({
    eventKind: "CONDUCT_HEARING_RECORDED",
    actorId,
    targetId: rec._id,
    targetKind: "ConductRecord",
    meta: { staffProfileId: rec.staffProfileId.toString(), stage: rec.stage },
  });
  return rec;
}

export interface FinalizeConductInput {
  recordId: string;
  actorId: string;
  liveUntilKey?: string; // YYYY-MM-DD lapse date for a warning (parked period — data)
  outcome?: string;
}

export async function finalizeConductStep(input: FinalizeConductInput): Promise<IConductRecord> {
  const rec = await ConductRecord.findById(input.recordId);
  if (!rec) throw new PerformanceError("Conduct record not found");
  if (rec.status === "finalized" || rec.status === "lapsed") {
    throw new PerformanceError("This conduct step is already finalised");
  }
  // Due process: the hearing must have been recorded BEFORE finalisation ('adl).
  if (rec.status !== "hearing_held" || !rec.hearingHeldAt) {
    throw new PerformanceError(
      "The person's response/hearing must be recorded before this step is finalised ('adl)",
    );
  }
  rec.status = "finalized";
  rec.finalizedBy = new Types.ObjectId(input.actorId);
  rec.finalizedAt = new Date();
  if (input.liveUntilKey) rec.liveUntil = parseDateKey(input.liveUntilKey); // validates the key
  if (input.outcome !== undefined) rec.outcome = input.outcome.trim();
  await rec.save();

  await writeAudit({
    eventKind: "CONDUCT_STEP_FINALIZED",
    actorId: input.actorId,
    targetId: rec._id,
    targetKind: "ConductRecord",
    meta: { staffProfileId: rec.staffProfileId.toString(), stage: rec.stage, liveUntil: rec.liveUntil },
  });

  // A termination step writes the employment status + is the offboarding trigger
  // (HR-5/H6 — the offboarding workflow itself is the next slice's court).
  if (rec.stage === "termination") {
    await StaffProfile.findByIdAndUpdate(rec.staffProfileId, { employmentStatus: "terminated" });
    await writeAudit({
      eventKind: "STAFF_TERMINATED",
      actorId: input.actorId,
      targetId: rec.staffProfileId,
      targetKind: "StaffProfile",
      meta: { conductRecordId: rec._id.toString() },
    });
  }
  return rec;
}

/** All conduct records for a staff member (lazy-lapse applied), newest first. */
export async function conductForStaff(staffProfileId: string): Promise<IConductRecord[]> {
  await lapseExpiredConduct(staffProfileId);
  return ConductRecord.find({ staffProfileId: new Types.ObjectId(staffProfileId) })
    .sort({ createdAt: -1 })
    .lean() as unknown as Promise<IConductRecord[]>;
}
