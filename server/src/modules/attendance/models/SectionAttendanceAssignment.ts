import { Schema, model, Document, Types } from "mongoose";

/**
 * SectionAttendanceAssignment — a per-day/date-range MARKER OVERRIDE (AT2.1,
 * D-#64): Principal/Office assign any teacher to mark a section's attendance for
 * `[fromKey, toKey]` (inclusive, local date keys). Without a covering assignment
 * the marker defaults to the section's `classTeacherId` (CT-2).
 *
 * Append-only history in the ClassTeacherAssignment spirit (ADR-008): rows are
 * never edited; a mistaken assignment is deactivated (`active:false`, stamped),
 * which preserves who-was-responsible-when for the escalation log. A teacher may
 * hold assignments on multiple sections for the same day (no cap — surfaced in
 * the admin view, D-#64).
 */
export interface ISectionAttendanceAssignment extends Document {
  _id: Types.ObjectId;
  sectionId: Types.ObjectId;
  teacherId: Types.ObjectId;
  /** First day covered, `YYYY-MM-DD` (local). */
  fromKey: string;
  /** Last day covered, inclusive. Equal to fromKey for a single-day assignment. */
  toKey: string;
  actorId: Types.ObjectId;
  active: boolean;
  revokedBy?: Types.ObjectId;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SectionAttendanceAssignmentSchema = new Schema<ISectionAttendanceAssignment>(
  {
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    fromKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    toKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    active: { type: Boolean, default: true },
    revokedBy: { type: Schema.Types.ObjectId, ref: "User" },
    revokedAt: { type: Date },
  },
  { timestamps: true },
);

// Marker resolution for (section, date): active rows with fromKey ≤ key ≤ toKey.
SectionAttendanceAssignmentSchema.index({ sectionId: 1, active: 1, fromKey: 1, toKey: 1 });
SectionAttendanceAssignmentSchema.index({ teacherId: 1, active: 1, fromKey: 1 });

export const SectionAttendanceAssignment = model<ISectionAttendanceAssignment>(
  "SectionAttendanceAssignment",
  SectionAttendanceAssignmentSchema,
);
