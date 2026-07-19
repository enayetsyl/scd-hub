/**
 * HomeworkStudentRecord — Layer B of the Homework Tracker (handoff §2.2, HW-T1).
 *
 * One record per student × item — the carrier of the 6-stage lifecycle (§3).
 *
 * IDENTITY-BEARING, by contract (handoff §9): Layer-B records are "named,
 * per-student" on the OPERATIONAL plane, so this stores the real `studentId`
 * (unlike the de-identified generic `TrackerRecord`, which pseudonymises). This
 * is allowed — the ADR-005 firewall only forbids the CORPUS plane from joining
 * back to identity. This model lives in the trackers (operational) module and is
 * NEVER imported by the corpus module; only de-identified aggregates cross
 * (handoff §8.4, built in HW-T4). The fail-closed firewall test (J5.6) stays green.
 *
 * A resubmission (HW-T3) is a NEW record on the SAME `hwId` with `resubOf` set —
 * never a new HW_ID, never a new stream (handoff §3 / REF-07 §4.1). The `topup*`
 * fields are reserved for HW-T3 and unused in HW-T1.
 */
import { Schema, model, Document, Types } from "mongoose";
import { LIFECYCLE_STATES, HW_RESULTS } from "@scd/shared";
import type { LifecycleState, HwResult } from "@scd/shared";

/** One STATE_DATES entry — the timestamped audit trail of transitions (§2.2). */
export interface StateStamp {
  state: LifecycleState;
  at: Date;
  /** Acting user (D-#338 revert authorization); absent on pre-D-#338 stamps and system sweeps. */
  by?: Types.ObjectId;
}

export interface IHomeworkStudentRecord extends Document {
  _id: Types.ObjectId;
  /** HW_REF → Layer A. */
  hwItemId: Types.ObjectId;
  /** Denormalised HW_ID — same id across the original + any resubmission (traceability, §2.2). */
  hwId: string;
  /** STUDENT_ID — identity-bearing, operational plane only (handoff §9). */
  studentId: Types.ObjectId;
  sectionId: Types.ObjectId;
  classId: Types.ObjectId;
  /** STATE — current atomic lifecycle state (§3). */
  state: LifecycleState;
  /** STATE_DATES — a timestamp per transition (audit trail, §2.2). */
  stateDates: StateStamp[];
  /** Submission due date (default = next school day after issue, §3 stage 3). */
  dueDate?: Date;
  /** CHASE_COUNT — increments each time the record (re)enters CHASE (§3 stage 4). */
  chaseCount: number;
  /** RESULT — recorded at Checked (§2.2; only WRONG auto-spawns a resubmission). */
  result?: HwResult;
  /** RESUB_OF → the prior record this resubmission re-issues (HW-T3). */
  resubOf?: Types.ObjectId;
  /** TOPUP_* — reserved for HW-T3 (only valid on a resubmission record, §5). */
  topupFlag: boolean;
  topupQids: string[];
  topupTime?: number;
  /** Optional teacher-attached checked-ANSWER file (GP-A, D-#70) — per student,
   *  per record (a resubmission record may carry its own). Child PII (ADR-005):
   *  download is link-gated; never any corpus path, never a public URL. */
  answerFileId?: Types.ObjectId;
  issuedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const StateStampSchema = new Schema<StateStamp>(
  {
    state: { type: String, enum: LIFECYCLE_STATES, required: true },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, required: false },
  },
  { _id: false },
);

const HomeworkStudentRecordSchema = new Schema<IHomeworkStudentRecord>(
  {
    hwItemId: { type: Schema.Types.ObjectId, required: true },
    hwId: { type: String, required: true },
    studentId: { type: Schema.Types.ObjectId, required: true },
    sectionId: { type: Schema.Types.ObjectId, required: true },
    classId: { type: Schema.Types.ObjectId, required: true },
    state: { type: String, enum: LIFECYCLE_STATES, required: true },
    stateDates: { type: [StateStampSchema], default: [] },
    dueDate: { type: Date },
    chaseCount: { type: Number, required: true, default: 0 },
    result: { type: String, enum: HW_RESULTS },
    resubOf: { type: Schema.Types.ObjectId },
    topupFlag: { type: Boolean, required: true, default: false },
    topupQids: { type: [String], default: [] },
    topupTime: { type: Number },
    answerFileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    issuedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

// Lookups by item+student, by student, and by state (chase/checking queues, §8).
// NOT unique on (hwItemId, studentId): a resubmission (HW-T3) is a SECOND record
// for the same student+item, distinguished by `resubOf` (handoff §3 / §5.4) — the
// original + each resubmission of the same HW_ID coexist.
HomeworkStudentRecordSchema.index({ hwItemId: 1, studentId: 1 });
HomeworkStudentRecordSchema.index({ studentId: 1, state: 1 });
HomeworkStudentRecordSchema.index({ hwItemId: 1, state: 1 });
HomeworkStudentRecordSchema.index({ resubOf: 1 });

export const HomeworkStudentRecord = model<IHomeworkStudentRecord>(
  "HomeworkStudentRecord",
  HomeworkStudentRecordSchema,
);
