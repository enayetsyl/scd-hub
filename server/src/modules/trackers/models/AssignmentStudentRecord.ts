/**
 * AssignmentStudentRecord — Layer B of the Assignment Tracker (PRD §3, AS-T2).
 *
 * One record per student × item, carried by the SHARED lifecycle engine
 * (trackers/lifecycle.ts, D-#37 — this tracker is its designed second
 * consumer): GIVEN | ABSENT_REDELIVER → DUE → SUBMITTED | CHASE → CHECKED →
 * (optional) RESUBMIT → RETURNED.
 *
 * IDENTITY-BEARING, operational plane only (ADR-005 — same posture as
 * HomeworkStudentRecord): stores the real `studentId`; the corpus module never
 * imports it; the J5.6 fail-closed firewall test stays green.
 *
 * Checking fields (D-#87): `result ∈ HW_RESULTS` + optional `marks`
 * (0 ≤ marks ≤ item.totalMarks, service-validated) + optional Bangla
 * `feedback`. A resubmission (AS-T3) is a NEW record on the SAME `asId` with
 * `resubOf` set — teacher-OPTIONAL on any result, never automatic (the
 * deliberate difference from homework's WRONG-auto-spawn). NOT unique on
 * {asItemId, studentId} for exactly that reason (HW-T3 precedent).
 */
import { Schema, model, Document, Types } from "mongoose";
import { LIFECYCLE_STATES, HW_RESULTS } from "@scd/shared";
import type { LifecycleState, HwResult } from "@scd/shared";

/** One STATE_DATES entry — the timestamped audit trail of transitions. */
export interface AssignmentStateStamp {
  state: LifecycleState;
  at: Date;
  /** Acting user (D-#338 revert authorization); absent on pre-D-#338 stamps and system sweeps. */
  by?: Types.ObjectId;
}

export interface IAssignmentStudentRecord extends Document {
  _id: Types.ObjectId;
  asItemId: Types.ObjectId;
  /** Denormalised AS_ID — same id across the original + any resubmission. */
  asId: string;
  studentId: Types.ObjectId;
  sectionId: Types.ObjectId;
  classId: Types.ObjectId;
  state: LifecycleState;
  stateDates: AssignmentStateStamp[];
  /** The item's due date (assignment-wide, not per student); a redelivery keeps it. */
  dueDate?: Date;
  /** Increments each time the record (re)enters CHASE. */
  chaseCount: number;
  /** Recorded at CHECKED (D-#87). */
  result?: HwResult;
  /** Optional marks, 0 ≤ marks ≤ item.totalMarks (D-#87; service-validated). */
  marks?: number;
  /** Optional teacher feedback (free text, Bangla expected; D-#87). */
  feedback?: string;
  /** → the prior record this resubmission re-issues (AS-T3). */
  resubOf?: Types.ObjectId;
  issuedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AssignmentStateStampSchema = new Schema<AssignmentStateStamp>(
  {
    state: { type: String, enum: LIFECYCLE_STATES, required: true },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, required: false },
  },
  { _id: false },
);

const AssignmentStudentRecordSchema = new Schema<IAssignmentStudentRecord>(
  {
    asItemId: { type: Schema.Types.ObjectId, required: true },
    asId: { type: String, required: true },
    studentId: { type: Schema.Types.ObjectId, required: true },
    sectionId: { type: Schema.Types.ObjectId, required: true },
    classId: { type: Schema.Types.ObjectId, required: true },
    state: { type: String, enum: LIFECYCLE_STATES, required: true },
    stateDates: { type: [AssignmentStateStampSchema], default: [] },
    dueDate: { type: Date },
    chaseCount: { type: Number, required: true, default: 0 },
    result: { type: String, enum: HW_RESULTS },
    marks: { type: Number, min: 0 },
    feedback: { type: String },
    resubOf: { type: Schema.Types.ObjectId },
    issuedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

// NOT unique on (asItemId, studentId): a resubmission is a legitimate second
// record on the same item (AS-T3 / HW-T3 precedent).
AssignmentStudentRecordSchema.index({ asItemId: 1, studentId: 1 });
AssignmentStudentRecordSchema.index({ studentId: 1, state: 1 });
AssignmentStudentRecordSchema.index({ asItemId: 1, state: 1 });
// Office chase list (AS-T4) scans by state across items.
AssignmentStudentRecordSchema.index({ state: 1, dueDate: 1 });
AssignmentStudentRecordSchema.index({ resubOf: 1 });

export const AssignmentStudentRecord = model<IAssignmentStudentRecord>(
  "AssignmentStudentRecord",
  AssignmentStudentRecordSchema,
);
