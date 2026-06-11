import { Schema, model, Document, Types } from "mongoose";
import type { Season } from "@scd/shared";

/**
 * An admin-defined date window that sets, for a date range, the duration `season`
 * (regular/winter) AND the **day start time** (D-#55). Winter dates float year to
 * year and the winter start steps up mid-season (07:00 regular → 07:15 → 07:30), so
 * these are data, not constants: a winter is typically TWO windows (same winter
 * season, dayStart 07:15 then 07:30); regular is window(s) at 07:00.
 *
 * `dayStartMinutes` = minutes from midnight (07:00 = 420). Absolute period clock
 * times are computed from this + the grid's cumulative durations. Windows must not
 * overlap in date (enforced in the service). Operational config; no PII.
 */
export interface IScheduleWindow extends Document {
  _id: Types.ObjectId;
  academicYearId: Types.ObjectId;
  fromDate: Date;
  toDate: Date;
  season: Season;
  dayStartMinutes: number;
  label: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ScheduleWindowSchema = new Schema<IScheduleWindow>(
  {
    academicYearId: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    season: { type: String, enum: ["regular", "winter"], required: true },
    dayStartMinutes: { type: Number, required: true, min: 0, max: 1439 },
    label: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

ScheduleWindowSchema.index({ academicYearId: 1, fromDate: 1 });

export const ScheduleWindow = model<IScheduleWindow>("ScheduleWindow", ScheduleWindowSchema);
