import { Schema, model, Document, Types } from "mongoose";
import { TEACHER_ATTENDANCE_STATUSES, type TeacherAttendanceStatus } from "@scd/shared";

/**
 * TeacherAttendanceDay — one staff member's status for one date, parsed from the
 * daily biometric "Employee Attendance Report" Excel snapshot (AT-1, D-#63).
 *
 * Snapshot semantics (AT1.5): a re-upload for an already-imported date REPLACES
 * that date's rows wholesale — rows are only ever written by the importer, never
 * hand-edited. Identity/operational plane (ADR-005) — NO corpus path.
 *
 * `status` is read off the sheet's legend (§4): ✔ PRESENT, 𝓛 LATE (symbol only,
 * no grace computation), ✘ → LEAVE iff a staff leave record covers the date else
 * ABSENT (until a staff-leave source exists, ✘ = ABSENT — AT1.4), ℞ ignored
 * (skipped at parse, never stored).
 */
export interface ITeacherAttendanceDay extends Document {
  _id: Types.ObjectId;
  staffProfileId: Types.ObjectId;
  /** Local school day, `YYYY-MM-DD` — read from the SHEET header, not "today". */
  dateKey: string;
  status: TeacherAttendanceStatus;
  /** First punch as printed on the sheet (e.g. "06:53 AM"), when present. */
  punchIn?: string;
  /** Second punch, when present. */
  punchOut?: string;
  /** The sheet's shift text (e.g. "Syl Morning Shift 7:00-12:00"). */
  shift?: string;
  importedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TeacherAttendanceDaySchema = new Schema<ITeacherAttendanceDay>(
  {
    staffProfileId: { type: Schema.Types.ObjectId, ref: "StaffProfile", required: true },
    dateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    status: { type: String, enum: TEACHER_ATTENDANCE_STATUSES, required: true },
    punchIn: { type: String, trim: true },
    punchOut: { type: String, trim: true },
    shift: { type: String, trim: true },
    importedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

// Once per staff per day; the date index serves the daily roster + summaries (§8).
TeacherAttendanceDaySchema.index({ staffProfileId: 1, dateKey: 1 }, { unique: true });
TeacherAttendanceDaySchema.index({ dateKey: 1 });

export const TeacherAttendanceDay = model<ITeacherAttendanceDay>(
  "TeacherAttendanceDay",
  TeacherAttendanceDaySchema,
);
