import { Schema, model, Document, Types } from "mongoose";

/**
 * StudentLeaveApplication — RECORDED-ONLY (AT-3, D-#66): there is no approval
 * step (CT-3 stays deferred). A guardian asks for leave (via the future portal)
 * or Office records it on their behalf today; the record's only job is the
 * absent ⇄ application linkage — "absent with no application" is a first-class
 * reportable state (AT3.2/§8). Visible to the class teacher and Office.
 * Identity/operational plane (ADR-005) — NO corpus path.
 */
export interface IStudentLeaveApplication extends Document {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  /** First day of leave, `YYYY-MM-DD` (local), inclusive. */
  fromKey: string;
  /** Last day of leave, inclusive. */
  toKey: string;
  reason: string;
  /** The User who recorded it (Office/Principal now; guardian via the portal later). */
  submittedBy: Types.ObjectId;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const StudentLeaveApplicationSchema = new Schema<IStudentLeaveApplication>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    fromKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    toKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    reason: { type: String, required: true, trim: true },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    submittedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// Coverage lookups: applications for a student overlapping a range (AT3.2).
StudentLeaveApplicationSchema.index({ studentId: 1, fromKey: 1, toKey: 1 });

export const StudentLeaveApplication = model<IStudentLeaveApplication>(
  "StudentLeaveApplication",
  StudentLeaveApplicationSchema,
);
