import { Schema, model, Document, Types } from "mongoose";
import {
  HW_SUBJECTS,
  IMPROVEMENT_SCOPES,
  IMPROVEMENT_REPEATS,
  type HwSubject,
  type ImprovementScope,
  type ImprovementRepeat,
} from "@scd/shared";

/**
 * ImprovementAction (SP-2, docs/prd-student-progress.md §4, D-#735) — a small daily task
 * set by Office/Principal for ONE student or a whole SECTION in one subject, with a
 * teacher part and/or a guardian part over ONE shared schedule of school days.
 *
 * `dayKeys` is the schedule, computed once at create (and again on extend) from the
 * D-#50 calendar and, for SUBJECT_DAYS, the section's live routine. Storing it keeps
 * "which days were owed" stable when the routine or calendar changes later — a tick is
 * judged against the days that were promised, not against today's timetable.
 *
 * The lifecycle state is DERIVED (D-#85): UPCOMING / RUNNING / ENDED from the day keys,
 * STOPPED from `stoppedAt`.
 *
 * Identity plane (names a student and staff) — ADR-005, no corpus path.
 */
export interface IImprovementAction extends Document {
  _id: Types.ObjectId;
  scope: ImprovementScope;
  sectionId: Types.ObjectId;
  classId: Types.ObjectId;
  /** STUDENT scope only. */
  studentId?: Types.ObjectId | null;
  subject: HwSubject;
  reason?: string;
  /** Teacher part — both set or both absent. */
  teacherUserId?: Types.ObjectId | null;
  teacherTask?: string | null;
  /** Guardian part. */
  guardianTask?: string | null;
  repeat: ImprovementRepeat;
  /** The requested number of school days (the length of `dayKeys` after extends). */
  days: number;
  startKey: string;
  /** Scheduled school days, ascending `YYYY-MM-DD`. */
  dayKeys: string[];
  alertClassTeacher: boolean;
  createdBy: Types.ObjectId;
  stoppedAt?: Date | null;
  stoppedBy?: Types.ObjectId | null;
  stopReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ImprovementActionSchema = new Schema<IImprovementAction>(
  {
    scope: { type: String, enum: IMPROVEMENT_SCOPES, required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", default: null },
    subject: { type: String, enum: HW_SUBJECTS, required: true },
    reason: { type: String, trim: true },
    teacherUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    teacherTask: { type: String, trim: true, default: null },
    guardianTask: { type: String, trim: true, default: null },
    repeat: { type: String, enum: IMPROVEMENT_REPEATS, required: true },
    days: { type: Number, required: true, min: 1 },
    startKey: { type: String, required: true },
    dayKeys: { type: [String], required: true },
    alertClassTeacher: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    stoppedAt: { type: Date, default: null },
    stoppedBy: { type: Schema.Types.ObjectId, default: null },
    stopReason: { type: String, trim: true, default: null },
  },
  { timestamps: true },
);

ImprovementActionSchema.index({ sectionId: 1, subject: 1 });
ImprovementActionSchema.index({ studentId: 1 });
ImprovementActionSchema.index({ teacherUserId: 1 });
ImprovementActionSchema.index({ dayKeys: 1 });

export const ImprovementAction = model<IImprovementAction>("ImprovementAction", ImprovementActionSchema);
