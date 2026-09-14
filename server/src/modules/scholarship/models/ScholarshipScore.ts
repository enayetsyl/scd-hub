/**
 * ScholarshipScore — one student's marks on one practice paper, ITEM BY ITEM
 * (SC-2, docs/prd-scholarship-practice.md §5.3, D-#656).
 *
 * This is the row the whole module exists for. Every mark store already in the repo is
 * whole-paper — `ClassTestResult.marks` is one number, `ExamMark.rawMark` is one number
 * per component — so nothing could say WHICH item a student lost marks on, and no
 * topic-wise analysis was derivable from any of them. `itemMarks` is that missing half.
 *
 * ONE row per (paper × student); freely editable, with NO retake/resubmission lifecycle
 * (the ClassTestResult D-#121 posture — a practice mark is a correction, not a workflow).
 *
 *   PRESENT → carries `itemMarks`; the total and every percentage are DERIVED at read
 *             time, never stored (D-#85). A stored total is a second source of truth
 *             that drifts the first time one cell is corrected.
 *   ABSENT  → carries NO itemMarks, and is excluded from every denominator, personal
 *             and class (D-#660, the CT §4 rule).
 *
 * PARTICIPATION IS PER PAPER, NEVER A STUDENT FLAG (D-#660). The Class-5 student who
 * will not sit the scholarship exam is marked ABSENT on each paper — she is not removed
 * from the roster, not given a "candidate" flag, and not filtered out of the class. A
 * flag would have to be maintained, would silently decide months of analysis, and would
 * need a migration the day she starts sitting them; an ABSENT row needs none of that.
 *
 * `publishedAt` / `publishedVersion` exist in the shape now but the release flow is SC-5
 * — this slice never sets them beyond the `publishedVersion: 0` default.
 *
 * Operational/identity plane behind the ADR-005 firewall (names studentId). No corpus
 * path: there is no analytics or export resolver here that could join back to identity.
 */
import { Schema, model, Document, Types } from "mongoose";
import { SCHOLARSHIP_ATTENDANCE_STATUSES } from "@scd/shared";
import type { ScholarshipAttendanceStatus } from "@scd/shared";

export interface IScholarshipItemMark {
  /** Matches a `ScholarshipItem.itemNo` on the paper this score belongs to. */
  itemNo: number;
  /** 0 ≤ marks ≤ that item's declared marks, checked in the service against the paper. */
  marks: number;
}

export interface IScholarshipScore extends Document {
  _id: Types.ObjectId;
  paperId: Types.ObjectId;
  studentId: Types.ObjectId;
  status: ScholarshipAttendanceStatus;
  itemMarks: IScholarshipItemMark[];
  /** Teacher's own note on this attempt — internal, never guardian-facing (J7/D-#68). */
  note?: string;
  enteredBy: Types.ObjectId;
  /** SC-5 only. */
  publishedAt?: Date;
  publishedVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const ScholarshipItemMarkSchema = new Schema<IScholarshipItemMark>(
  {
    itemNo: { type: Number, required: true, min: 1 },
    marks: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const ScholarshipScoreSchema = new Schema<IScholarshipScore>(
  {
    paperId: { type: Schema.Types.ObjectId, ref: "ScholarshipPaper", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    status: { type: String, enum: SCHOLARSHIP_ATTENDANCE_STATUSES, required: true },
    itemMarks: { type: [ScholarshipItemMarkSchema], default: [] },
    note: { type: String, trim: true },
    enteredBy: { type: Schema.Types.ObjectId, required: true },
    publishedAt: { type: Date },
    publishedVersion: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true },
);

// One score per student per paper (the §5.3 invariant; the upsert key).
ScholarshipScoreSchema.index({ paperId: 1, studentId: 1 }, { unique: true });
// The per-student analysis walks every score this student has, across papers (SC-3).
ScholarshipScoreSchema.index({ studentId: 1 });

export const ScholarshipScore = model<IScholarshipScore>("ScholarshipScore", ScholarshipScoreSchema);
