import { Schema, model, Document, Types } from "mongoose";

/**
 * StudentAttendanceDay — ONE record per (section, local day): the absent-only
 * capture (AT2.3/AT2.4, D-#63). The marker taps the absentees; every enrolled
 * student NOT listed is present. Identity/operational plane (ADR-005) — NO
 * corpus path.
 *
 * Group shaping (§7): general attendance is per `Section`; Quran/Arabic
 * SubjectGroup attendance is a fast-follow that reuses this model with
 * `subjectGroupId` in place of `sectionId` — exactly one of the two is set.
 *
 * Lock rule (O2): the day is editable by the marker until end of day; after
 * that only Principal/Office may amend (`amendStudentAttendance`, audited) —
 * enforced in the service, not here.
 */
export interface IStudentAttendanceDay extends Document {
  _id: Types.ObjectId;
  sectionId?: Types.ObjectId;
  subjectGroupId?: Types.ObjectId;
  /** Local school day, `YYYY-MM-DD`. */
  dateKey: string;
  absentStudentIds: Types.ObjectId[];
  markedBy: Types.ObjectId;
  markedAt: Date;
  /** Set when a past day is amended by Principal/Office (O2). */
  amendedBy?: Types.ObjectId;
  amendedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const StudentAttendanceDaySchema = new Schema<IStudentAttendanceDay>(
  {
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    subjectGroupId: { type: Schema.Types.ObjectId, ref: "SubjectGroup" },
    dateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    absentStudentIds: [{ type: Schema.Types.ObjectId, ref: "Student" }],
    markedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    markedAt: { type: Date, required: true },
    amendedBy: { type: Schema.Types.ObjectId, ref: "User" },
    amendedAt: { type: Date },
  },
  { timestamps: true },
);

// Exactly one of sectionId / subjectGroupId (§7 shaping).
StudentAttendanceDaySchema.pre("validate", function (next) {
  const hasSection = !!this.sectionId;
  const hasGroup = !!this.subjectGroupId;
  if (hasSection === hasGroup) {
    next(new Error("StudentAttendanceDay requires exactly one of sectionId / subjectGroupId"));
    return;
  }
  next();
});

// Once daily per group (AT2.4) — partial unique so the two shapes don't collide.
StudentAttendanceDaySchema.index(
  { sectionId: 1, dateKey: 1 },
  { unique: true, partialFilterExpression: { sectionId: { $exists: true } } },
);
StudentAttendanceDaySchema.index(
  { subjectGroupId: 1, dateKey: 1 },
  { unique: true, partialFilterExpression: { subjectGroupId: { $exists: true } } },
);
StudentAttendanceDaySchema.index({ dateKey: 1 });

export const StudentAttendanceDay = model<IStudentAttendanceDay>(
  "StudentAttendanceDay",
  StudentAttendanceDaySchema,
);
