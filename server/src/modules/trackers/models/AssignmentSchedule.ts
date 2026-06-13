/**
 * AssignmentSchedule — the admin-managed weekly assignment plan (AS-T1, D-#86).
 *
 * ONE document per academic year: a term anchor date + the cadence config +
 * a 4-week ROTATION of entries (cycleWeek 1–4 × section × subject → teacher).
 * Week N of the year maps to cycleWeek ((N−1) mod 4)+1; the 52-week expected
 * grid is COMPUTED on read (assignmentCalendar.ts), never stored (PRD §3).
 *
 * `deliveryDayOfWeek` / `dueDayOfWeek` are admin-configurable (D-#86, defaults
 * THU=4 / SUN=0) and must be FULL school weekdays (Sun–Thu, 0–4): Friday is
 * off and Saturday is Quran-only — Quran is excluded from this tracker (D-#36),
 * so neither may host an anchor (service-validated).
 *
 * Operational/identity plane (teacher + section refs) behind the ADR-005
 * firewall — never imported by the corpus module. Rides the existing
 * `assignment` tracker-kind: no new vocab, no wire-contract sync (PRD header).
 */
import { Schema, model, Document, Types } from "mongoose";
import { HW_SUBJECTS } from "@scd/shared";
import type { HwSubject } from "@scd/shared";

export interface IAssignmentScheduleEntry {
  _id: Types.ObjectId;
  /** Position in the 4-week rotation (1–4). */
  cycleWeek: number;
  classId: Types.ObjectId;
  /** Content class level 1..5 — mirrors the homework axis (D-#34 numbering needs it). */
  classLevel: number;
  sectionId: Types.ObjectId;
  /** HW_SUBJECTS axis (D-#36 — Quran excluded, lives in the Quran Tracker). */
  subject: HwSubject;
  teacherId: Types.ObjectId;
}

export interface IAssignmentSchedule extends Document {
  _id: Types.ObjectId;
  academicYearId: Types.ObjectId;
  /** Week 1 begins on this date; week N covers [termStart + (N−1)·7d, +7d). */
  termStartDate: Date;
  /** Delivery anchor weekday, 0=Sun … 4=Thu (default THU; D-#86). */
  deliveryDayOfWeek: number;
  /** Due anchor weekday, 0=Sun … 4=Thu (default SUN; D-#86). */
  dueDayOfWeek: number;
  entries: Types.DocumentArray<IAssignmentScheduleEntry>;
  createdAt: Date;
  updatedAt: Date;
}

const AssignmentScheduleEntrySchema = new Schema<IAssignmentScheduleEntry>({
  cycleWeek: { type: Number, required: true, min: 1, max: 4 },
  classId: { type: Schema.Types.ObjectId, required: true },
  classLevel: { type: Number, required: true, min: 1, max: 5 },
  sectionId: { type: Schema.Types.ObjectId, required: true },
  subject: { type: String, enum: HW_SUBJECTS, required: true },
  teacherId: { type: Schema.Types.ObjectId, required: true },
});

const AssignmentScheduleSchema = new Schema<IAssignmentSchedule>(
  {
    academicYearId: { type: Schema.Types.ObjectId, required: true, unique: true },
    termStartDate: { type: Date, required: true },
    deliveryDayOfWeek: { type: Number, required: true, min: 0, max: 4, default: 4 },
    dueDayOfWeek: { type: Number, required: true, min: 0, max: 4, default: 0 },
    entries: { type: [AssignmentScheduleEntrySchema], default: [] },
  },
  { timestamps: true },
);

export const AssignmentSchedule = model<IAssignmentSchedule>(
  "AssignmentSchedule",
  AssignmentScheduleSchema,
);
