import { Schema, model, Document, Types } from "mongoose";
import { GUARDIAN_VIEW_SURFACES } from "@scd/shared";
import type { GuardianViewSurface } from "@scd/shared";

/**
 * GuardianView (GE-2, D-#465) — the ONE record that a family actually looked at
 * something. Identity plane: it names a guardian and a student, so it lives here and
 * NOT in `modules/corpus`, which the ADR-005 fail-closed firewall test forbids from
 * importing any identity model.
 *
 * THREE deliberate departures from the audit log (ADR-008), because this collection
 * answers a different question and would wreck that one if it behaved the same way:
 *
 * 1. NOT append-per-event. One row per (guardian × surface × refId × Dhaka day),
 *    upserted with `$inc: { count }`. A guardian pull-to-refreshing the home screen
 *    twenty times is one engaged day, not twenty data points — and raw per-tap rows
 *    would outgrow every other collection in the database within a term.
 * 2. TTL-expiring at 180 days. The audit log is forensic and kept forever; usage
 *    telemetry that survives its own usefulness is just storage cost on a free tier
 *    (SH-1/D-#414 watches exactly that ceiling).
 * 3. NOT written to `audits`. Mixing ~10 view rows per guardian-session into the
 *    security log would bury the LOGIN_FAIL / PERMISSION_DENIED rows it exists to
 *    make findable.
 *
 * Fields are counts and ids only — never note text, marks, or message bodies. The
 * report says a family opened পাঠ নোট, never what it said.
 */
export interface IGuardianView extends Document {
  _id: Types.ObjectId;
  guardianId: Types.ObjectId;
  /** Which child the view was about. Absent for surfaces that aren't per-child. */
  studentId?: Types.ObjectId;
  surface: GuardianViewSurface;
  /** The specific item opened (classNoteId, classTestId, …) when the surface has one. */
  refId?: string;
  /** Dhaka-local YYYY-MM-DD — the collapse key, same convention as attendance. */
  dayKey: string;
  /** Opens on this day. Incremented, never reset. */
  count: number;
  /** First open on this day. */
  firstAt: Date;
  /** Most recent open on this day — what "last seen" reads. */
  lastAt: Date;
}

const GuardianViewSchema = new Schema<IGuardianView>(
  {
    guardianId: { type: Schema.Types.ObjectId, ref: "Guardian", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student" },
    surface: { type: String, enum: GUARDIAN_VIEW_SURFACES, required: true },
    refId: { type: String },
    dayKey: { type: String, required: true },
    count: { type: Number, required: true, default: 1 },
    firstAt: { type: Date, required: true },
    lastAt: { type: Date, required: true },
  },
  { timestamps: false, versionKey: false },
);

// The collapse contract. `refId` is absent on screen-level surfaces, and Mongo treats
// every missing value as the SAME key in a non-sparse index — which is exactly what we
// want here: all HOME opens for a guardian on a day fold into one row.
GuardianViewSchema.index(
  { guardianId: 1, surface: 1, refId: 1, studentId: 1, dayKey: 1 },
  { unique: true, name: "guardian_view_day_unique" },
);
// The report's two hot reads: one guardian's activity, and a surface's popularity.
GuardianViewSchema.index({ guardianId: 1, lastAt: -1 });
GuardianViewSchema.index({ surface: 1, lastAt: -1 });
// Retention (see 2. above). 180 days from the day's LAST open.
GuardianViewSchema.index({ lastAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

export const GuardianView = model<IGuardianView>("GuardianView", GuardianViewSchema);
