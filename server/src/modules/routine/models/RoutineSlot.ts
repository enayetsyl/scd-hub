import { Schema, model, Document, Types } from "mongoose";
import type { DayOfWeek, RoutineSubject, PeriodTrack } from "@scd/shared";

/**
 * One weekly routine slot (R-2): `(group × day × period) → subject, teacher, room`.
 *
 * The group is either a general `Section` (groupType "section") or a cross-grade
 * `SubjectGroup` (groupType "subjectgroup", Quran/Arabic). `classId` is the section's
 * class (section slots only) — used by the scope binding (D-#49). A `break` period
 * (e.g. Tiffin) takes no subject/teacher. A Quran double-period is TWO adjacent
 * single-period slots (D-#56), each its own row — possibly different teachers.
 *
 * Effective-dated: a slot is live for `[effectiveFrom, effectiveTo)` (open-ended when
 * `effectiveTo` is null), so a mid-term edit never rewrites the past (D-#47(3)).
 * Operational/identity plane (names a teacher); no corpus path.
 */
export interface IRoutineSlot extends Document {
  _id: Types.ObjectId;
  groupType: "section" | "subjectgroup";
  groupId: Types.ObjectId;
  /** The section's class (section slots only) — for the scope binding. */
  classId?: Types.ObjectId;
  dayOfWeek: DayOfWeek;
  periodNumber: number;
  subject: RoutineSubject;
  track: PeriodTrack;
  isBreak: boolean;
  teacherId?: Types.ObjectId;
  roomId?: Types.ObjectId;
  effectiveFrom: Date;
  effectiveTo?: Date;
  active: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RoutineSlotSchema = new Schema<IRoutineSlot>(
  {
    groupType: { type: String, enum: ["section", "subjectgroup"], required: true },
    groupId: { type: Schema.Types.ObjectId, required: true, refPath: "groupType" },
    classId: { type: Schema.Types.ObjectId, ref: "Class" },
    dayOfWeek: {
      type: String,
      enum: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
      required: true,
    },
    periodNumber: { type: Number, required: true, min: 1 },
    subject: { type: String, required: true },
    track: { type: String, enum: ["general", "quran", "arabic"], required: true },
    isBreak: { type: Boolean, default: false },
    teacherId: { type: Schema.Types.ObjectId, ref: "User" },
    roomId: { type: Schema.Types.ObjectId, ref: "Room" },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

// Query helpers for the conflict engine + routine-for-date resolution.
RoutineSlotSchema.index({ dayOfWeek: 1, periodNumber: 1, active: 1 });
RoutineSlotSchema.index({ groupType: 1, groupId: 1, active: 1 });
RoutineSlotSchema.index({ teacherId: 1, active: 1 });

export const RoutineSlot = model<IRoutineSlot>("RoutineSlot", RoutineSlotSchema);
