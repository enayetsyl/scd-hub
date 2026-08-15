/**
 * AssignmentItem — Layer A of the Assignment Tracker (PRD §3, AS-T1/AS-T2).
 *
 * ONE item per (week × section × subject), materialized when the teacher runs
 * the delivery pass against a schedule entry (the expected grid itself is
 * computed on read from AssignmentSchedule — an AssignmentItem row exists only
 * once delivery happened). `deliveryDate` + `dueDate` are resolved server-side
 * per the §4 holiday rolls (D-#86), never client-supplied.
 *
 * Counts (# delivered / # not-received / # submitted / # missing) are DERIVED
 * from the Layer-B records (PRD §1 — never typed), so this model stores none.
 *
 * Rides the existing `assignment` tracker-kind (D-#85) — no new tracker-kind,
 * no envelope/harness sync. Operational/identity plane behind ADR-005.
 */
import { Schema, model, Document, Types } from "mongoose";
import { HW_SUBJECTS, ROSTER_CLASS_LEVEL_MIN, ROSTER_CLASS_LEVEL_MAX } from "@scd/shared";
import type { HwSubject } from "@scd/shared";

export interface IAssignmentItem extends Document {
  _id: Types.ObjectId;
  /** AS_ID — AS-C{class}-{SUBJECT}-{nnnn} (D-#34 numbering pattern). Unique, year-continuous. */
  asId: string;
  academicYearId: Types.ObjectId;
  /** The rotation entry this item realizes (subdocument _id on AssignmentSchedule.entries). */
  scheduleEntryId: Types.ObjectId;
  /** 1-based week of the year (relative to the schedule's term anchor). */
  weekNumber: number;
  /** ((weekNumber−1) mod 4)+1 — denormalised for roll-ups. */
  cycleWeek: number;
  classId: Types.ObjectId;
  classLevel: number;
  sectionId: Types.ObjectId;
  subject: HwSubject;
  teacherId: Types.ObjectId;
  /** Resolved per §4 rule 1 (delivery anchor, holiday → previous open day). */
  deliveryDate: Date;
  /** Resolved per §4 rule 2 (due anchor, holiday → next open day). */
  dueDate: Date;
  /** Optional link to an assembled AS set (D-#88) — content-free items equally valid. */
  setId?: Types.ObjectId;
  /** Teacher-set marks ceiling; checking validates 0 ≤ marks ≤ totalMarks (D-#87). */
  totalMarks?: number;
  /** D-#478: the teacher's brief "what is the assignment" — REQUIRED at the delivery
   *  pass (optional on the schema only for pre-D-#478 rows). The homework twin has
   *  carried this since D-#317; without it a guardian looking at a late assignment
   *  sees an AS_ID and nothing else, and — unlike homework — there is no class note
   *  to fall back on, because an assignment is weekly and links to no slot. */
  description?: string;
  /** AS-T6 (D-#274): declared minutes for the weekly load ceiling. Summed per
   *  (section × week); confirmAssignmentWeek blocks the week over AS_WEEKLY_CEILING_MIN. */
  estMinutes: number;
  /** AS-T6: DRAFT after deliver (no student records yet), ISSUED after the week
   *  is confirmed under the ceiling (records spawned). */
  status: "DRAFT" | "ISSUED";
  /** AS-T6: the present/absent roster captured at deliver, consumed at confirm
   *  to spawn the per-student records. Cleared once ISSUED. */
  draftRoster?: { studentId: Types.ObjectId; present: boolean }[];
  issuedAt?: Date;
  issuedBy?: Types.ObjectId;
  deliveredBy: Types.ObjectId;
  deliveredAt: Date;
  /** Assignment sheet/instruction files attached at the delivery pass (≤5,
   *  `assignment_attachment` kind, D-#298) — the homework D-#297 pattern. */
  attachmentIds?: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const AssignmentItemSchema = new Schema<IAssignmentItem>(
  {
    asId: { type: String, required: true, unique: true },
    academicYearId: { type: Schema.Types.ObjectId, required: true },
    scheduleEntryId: { type: Schema.Types.ObjectId, required: true },
    weekNumber: { type: Number, required: true, min: 1 },
    cycleWeek: { type: Number, required: true, min: 1, max: 4 },
    classId: { type: Schema.Types.ObjectId, required: true },
    classLevel: { type: Number, required: true, min: ROSTER_CLASS_LEVEL_MIN, max: ROSTER_CLASS_LEVEL_MAX },
    sectionId: { type: Schema.Types.ObjectId, required: true },
    subject: { type: String, enum: HW_SUBJECTS, required: true },
    teacherId: { type: Schema.Types.ObjectId, required: true },
    deliveryDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    setId: { type: Schema.Types.ObjectId },
    totalMarks: { type: Number, min: 1 },
    description: { type: String, trim: true },
    estMinutes: { type: Number, required: true, min: 0, default: 20 },
    status: { type: String, enum: ["DRAFT", "ISSUED"], required: true, default: "DRAFT" },
    draftRoster: {
      type: [{ studentId: { type: Schema.Types.ObjectId, required: true }, present: { type: Boolean, required: true } }],
      default: undefined,
    },
    issuedAt: { type: Date },
    issuedBy: { type: Schema.Types.ObjectId },
    deliveredBy: { type: Schema.Types.ObjectId, required: true },
    deliveredAt: { type: Date, required: true },
    attachmentIds: { type: [Schema.Types.ObjectId], ref: "StoredFile", default: undefined },
  },
  { timestamps: true },
);

// One item per realized (week × section × subject) — a second delivery pass for
// the same expected cell is a duplicate, not a new item.
AssignmentItemSchema.index(
  { academicYearId: 1, weekNumber: 1, sectionId: 1, subject: 1 },
  { unique: true },
);
// Prep-prompt / roll-up lookups: "which entries did this teacher already deliver
// this week" and per-class summaries.
AssignmentItemSchema.index({ academicYearId: 1, weekNumber: 1, teacherId: 1 });
AssignmentItemSchema.index({ academicYearId: 1, classId: 1, weekNumber: 1 });
// Reverse lookup for the GET /files/:id read gate (which item owns this file?).
AssignmentItemSchema.index({ attachmentIds: 1 }, { sparse: true });

export const AssignmentItem = model<IAssignmentItem>("AssignmentItem", AssignmentItemSchema);
