import { Schema, model, Document, Types } from "mongoose";

/**
 * AttendanceCorrectionNote (D-#944, docs/prd-staff-mistakes.md §10) — which children changed
 * when a day's absent list was submitted again or amended. Before this only the absent COUNT
 * reached the audit log, so a correction could not say who was flipped.
 *
 * ONE note per (unit × day × the day's marker × episode) — the marker owns the mistake even
 * when Office corrects it; each change is appended with who made it. Once the entry behind a
 * note has been explained or decided, the next change that day opens a new episode, so a
 * later correction gets its own reason instead of hiding under an earlier answer. The
 * StaffMistake row (kind ATTENDANCE_CORRECTION) points here. Behind ADR-005.
 */
export const ATTENDANCE_MARKS = ["ABSENT", "PRESENT"] as const;
export type AttendanceMark = (typeof ATTENDANCE_MARKS)[number];

export interface AttendanceCorrectionChange {
  studentId: Types.ObjectId;
  from: AttendanceMark;
  to: AttendanceMark;
  at: Date;
  by: Types.ObjectId;
}

export interface IAttendanceCorrectionNote extends Document {
  _id: Types.ObjectId;
  staffUserId: Types.ObjectId;
  unitType: "section" | "subjectGroup";
  unitId: Types.ObjectId;
  dateKey: string;
  episode: number;
  changes: AttendanceCorrectionChange[];
  createdAt: Date;
  updatedAt: Date;
}

const ChangeSchema = new Schema<AttendanceCorrectionChange>(
  {
    studentId: { type: Schema.Types.ObjectId, required: true },
    from: { type: String, enum: ATTENDANCE_MARKS, required: true },
    to: { type: String, enum: ATTENDANCE_MARKS, required: true },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const AttendanceCorrectionNoteSchema = new Schema<IAttendanceCorrectionNote>(
  {
    staffUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    unitType: { type: String, enum: ["section", "subjectGroup"], required: true },
    unitId: { type: Schema.Types.ObjectId, required: true },
    dateKey: { type: String, required: true },
    episode: { type: Number, default: 1 },
    changes: { type: [ChangeSchema], default: [] },
  },
  { timestamps: true },
);

AttendanceCorrectionNoteSchema.index({ unitType: 1, unitId: 1, dateKey: 1, staffUserId: 1, episode: 1 }, { unique: true });

export const AttendanceCorrectionNote = model<IAttendanceCorrectionNote>("AttendanceCorrectionNote", AttendanceCorrectionNoteSchema);
