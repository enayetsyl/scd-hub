/**
 * LessonDelivery — what one class note says was taught from the lesson plan (LP-1, D-#820/#822).
 *
 * One row per class note, upserted with it and deleted with it. A session is named by its
 * STABLE key (class level × subject × chapter × session index) — a re-import makes a new
 * artifact version, so `artifactId` is only the version that was current when marked.
 *
 * `rosterStudentIds` is the section's active students at marking time: students carry no
 * section history (the 2026-10-01 C4/C5 split moved them in place), so this snapshot is what
 * ties a child to the lessons their class was taught (LP-3, D-#823).
 *
 * Operational/identity plane (names students and a teacher); no corpus path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";
import { LESSON_NONE_REASONS, type LessonNoneReason } from "@scd/shared";

export interface ILessonDeliverySession {
  chapter: string;
  /** পাঠ / অধ্যায় / Unit / Lesson — snapshot, so a past note reads like the plan did. */
  anchorWord?: string;
  sessionIndex: number;
  sessionOf: number;
  artifactId?: Types.ObjectId;
  titleBn: string;
  /** false = started, continues next class (চলমান). */
  finished: boolean;
}

export interface ILessonDelivery extends Document {
  _id: Types.ObjectId;
  noteId: Types.ObjectId;
  slotId: Types.ObjectId;
  sectionId: Types.ObjectId;
  classLevel: number;
  subject: string;
  dateKey: string;
  /** The publisher of the note — a cover counts as that day's teacher. */
  teacherId: Types.ObjectId;
  sessions: ILessonDeliverySession[];
  noneReason?: LessonNoneReason;
  noneNote?: string;
  rosterStudentIds: Types.ObjectId[];
  /** The roster's attendance units at marking (`section:<id>` / `subjectgroup:<id>`, usually one or two).
   *  Group membership is not dated, so after a split this is the only way to find the record a child
   *  was marked on that day (LP-3, D-#823). */
  attendanceUnits?: string[];
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SessionSchema = new Schema<ILessonDeliverySession>(
  {
    chapter: { type: String, required: true },
    anchorWord: { type: String },
    sessionIndex: { type: Number, required: true, min: 1 },
    sessionOf: { type: Number, required: true, min: 1 },
    artifactId: { type: Schema.Types.ObjectId, ref: "ContentArtifact" },
    titleBn: { type: String, required: true },
    finished: { type: Boolean, required: true },
  },
  { _id: false },
);

const LessonDeliverySchema = new Schema<ILessonDelivery>(
  {
    noteId: { type: Schema.Types.ObjectId, ref: "ClassNote", required: true },
    slotId: { type: Schema.Types.ObjectId, ref: "RoutineSlot", required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    classLevel: { type: Number, required: true },
    subject: { type: String, required: true },
    dateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sessions: { type: [SessionSchema], default: [] },
    noneReason: { type: String, enum: LESSON_NONE_REASONS },
    noneNote: { type: String, trim: true },
    rosterStudentIds: { type: [Schema.Types.ObjectId], ref: "Student", default: [] },
    attendanceUnits: { type: [String], default: undefined },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

LessonDeliverySchema.index({ noteId: 1 }, { unique: true });
// The শাখা tracker: one section × subject in date order.
LessonDeliverySchema.index({ sectionId: 1, subject: 1, dateKey: 1 });
// The student link: every delivery a child sat on the roster of.
LessonDeliverySchema.index({ rosterStudentIds: 1, subject: 1 });

export const LessonDelivery = model<ILessonDelivery>("LessonDelivery", LessonDeliverySchema);
