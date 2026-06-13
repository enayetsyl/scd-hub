import { Schema, model, Document, Types } from "mongoose";
import {
  CONDUCT_STAGES,
  CONDUCT_RECORD_STATUSES,
  type ConductStage,
  type ConductRecordStatus,
} from "@scd/shared";

/**
 * ConductRecord (HR-4; prd-hr §5.2, H5.3, D-#113) — one step on the disciplinary
 * ladder. The ladder ENFORCES ORDER (verbal → written → final → termination): a
 * normal step may not skip a rung above the highest currently-live finalised stage;
 * a `grossMisconduct` fast-track may jump straight to final/termination.
 *
 * Due process (*'adl*, not optional): a step is `draft` when raised, the person's
 * response/hearing is captured BEFORE finalisation (→ `hearing_held`), and only then
 * may the issuer finalise it (the disciplinary judgement, a PRINCIPAL-only sign-off,
 * D-#112). A finalised warning carries a `liveUntil` lapse date — once past it the
 * step `lapsed`: it stops counting toward escalation but STAYS ON FILE as history
 * (never deleted). Lapse is LAZY at read time (D-#21/library posture). The lapse
 * period per stage is PARKED (§10) — `liveUntil` is admin-supplied data, not a
 * baked-in constant.
 *
 * Finalising a `termination` step writes `StaffProfile.employmentStatus → terminated`
 * and is the offboarding trigger (HR-5/H6 — wiring stays in the offboarding module).
 *
 * Confidential (satr): visible to Principal/Office + the subject's own record only;
 * supervisors NEVER see conduct (H5.5/H7.3). Identity plane, behind the ADR-005
 * firewall (NO corpus path).
 */
export interface IConductRecord extends Document {
  _id: Types.ObjectId;
  staffProfileId: Types.ObjectId;
  stage: ConductStage;
  status: ConductRecordStatus;
  /** Skips the ladder order — may jump to final/termination (H5.3). */
  grossMisconduct: boolean;
  issue: string;
  category?: string | null;
  evidence?: string | null;
  /** The captured response/hearing (recorded before finalisation, *'adl*). */
  hearingNote?: string | null;
  hearingHeldAt?: Date | null;
  /** Lapse date for a finalised warning (null = never lapses). Parked period (§10). */
  liveUntil?: Date | null;
  outcome?: string | null;
  issuedBy: Types.ObjectId;
  finalizedBy?: Types.ObjectId | null;
  finalizedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ConductRecordSchema = new Schema<IConductRecord>(
  {
    staffProfileId: { type: Schema.Types.ObjectId, ref: "StaffProfile", required: true },
    stage: { type: String, enum: CONDUCT_STAGES, required: true },
    status: { type: String, enum: CONDUCT_RECORD_STATUSES, required: true, default: "draft" },
    grossMisconduct: { type: Boolean, default: false },
    issue: { type: String, required: true, trim: true },
    category: { type: String, trim: true, default: null },
    evidence: { type: String, trim: true, default: null },
    hearingNote: { type: String, trim: true, default: null },
    hearingHeldAt: { type: Date, default: null },
    liveUntil: { type: Date, default: null },
    outcome: { type: String, trim: true, default: null },
    issuedBy: { type: Schema.Types.ObjectId, required: true },
    finalizedBy: { type: Schema.Types.ObjectId, default: null },
    finalizedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

ConductRecordSchema.index({ staffProfileId: 1, createdAt: -1 });
ConductRecordSchema.index({ staffProfileId: 1, status: 1, stage: 1 });

export const ConductRecord = model<IConductRecord>("ConductRecord", ConductRecordSchema);
