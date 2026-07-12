import { Schema, model, Document, Types } from "mongoose";

/**
 * SectionAttendanceAssignment — a per-day/date-range MARKER OVERRIDE (AT2.1,
 * D-#64): Principal/Office assign any teacher to mark an attendance UNIT for
 * `[fromKey, toKey]` (inclusive, local date keys). Without a covering assignment
 * the marker is routine-derived — the unit's first-class teacher (D-#278) —
 * falling back to the section's `classTeacherId` (CT-2).
 *
 * Unit shaping (D-#278) mirrors `StudentAttendanceDay`: exactly one of `sectionId`
 * (Nursery/KG + Class 1–5 leftovers) or `subjectGroupId` (a Class 1–5 Quran group)
 * is set, so an admin can override the marker of either capture unit.
 *
 * Append-only history in the ClassTeacherAssignment spirit (ADR-008): rows are
 * never edited; a mistaken assignment is deactivated (`active:false`, stamped),
 * which preserves who-was-responsible-when for the escalation log. A teacher may
 * hold assignments on multiple units for the same day (no cap — surfaced in
 * the admin view, D-#64).
 */
export interface ISectionAttendanceAssignment extends Document {
  _id: Types.ObjectId;
  /** Set for a section unit; mutually exclusive with `subjectGroupId`. */
  sectionId?: Types.ObjectId;
  /** Set for a Quran-group unit (D-#278); mutually exclusive with `sectionId`. */
  subjectGroupId?: Types.ObjectId;
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
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    subjectGroupId: { type: Schema.Types.ObjectId, ref: "SubjectGroup" },
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

// Exactly one of sectionId / subjectGroupId (unit shaping, D-#278).
SectionAttendanceAssignmentSchema.pre("validate", function (next) {
  const hasSection = !!this.sectionId;
  const hasGroup = !!this.subjectGroupId;
  if (hasSection === hasGroup) {
    next(new Error("SectionAttendanceAssignment requires exactly one of sectionId / subjectGroupId"));
    return;
  }
  next();
});

// Marker resolution for (unit, date): active rows with fromKey ≤ key ≤ toKey.
SectionAttendanceAssignmentSchema.index({ sectionId: 1, active: 1, fromKey: 1, toKey: 1 });
SectionAttendanceAssignmentSchema.index({ subjectGroupId: 1, active: 1, fromKey: 1, toKey: 1 });
SectionAttendanceAssignmentSchema.index({ teacherId: 1, active: 1, fromKey: 1 });

export const SectionAttendanceAssignment = model<ISectionAttendanceAssignment>(
  "SectionAttendanceAssignment",
  SectionAttendanceAssignmentSchema,
);
