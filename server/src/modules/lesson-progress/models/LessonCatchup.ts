/**
 * LessonCatchup — the Office's corrective action on a শাখা × subject that is behind its lesson plan
 * or where many students missed a lesson (LP-4, D-#827). The work itself is an ordinary work-board
 * Task (D-#701: due date, done / blocked, reminders); this row is the record that ties the task to
 * the শাখা × subject and keeps what the progress looked like when it was raised.
 *
 * Operational plane (names a teacher via the task); no corpus path.
 */
import { Schema, model, Document, Types } from "mongoose";

export interface ILessonCatchup extends Document {
  _id: Types.ObjectId;
  sectionId: Types.ObjectId;
  subject: string;
  taskId: Types.ObjectId;
  createdBy: Types.ObjectId;
  /** Progress when raised: finished / total sessions, sessions behind the parallel শাখা, skipped. */
  snapshot: { finished: number; total: number; lagSessions: number; skipped: number };
  /** The session keys the catch-up names (skipped / missed by many), if the Office picked any. */
  sessionKeys: string[];
  createdAt: Date;
  updatedAt: Date;
}

const LessonCatchupSchema = new Schema<ILessonCatchup>(
  {
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    subject: { type: String, required: true },
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    snapshot: {
      finished: { type: Number, required: true },
      total: { type: Number, required: true },
      lagSessions: { type: Number, required: true },
      skipped: { type: Number, required: true },
    },
    sessionKeys: { type: [String], default: [] },
  },
  { timestamps: true },
);

LessonCatchupSchema.index({ sectionId: 1, subject: 1, createdAt: -1 });
LessonCatchupSchema.index({ taskId: 1 }, { unique: true });

export const LessonCatchup = model<ILessonCatchup>("LessonCatchup", LessonCatchupSchema);
