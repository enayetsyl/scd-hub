import { Schema, model, Document, Types } from "mongoose";
import type { Season, PeriodTrack } from "@scd/shared";

/**
 * The ordered period layout for a school day (D-#51/#55, pinned by D-#57).
 *
 * A grid is keyed by **(audienceKey, season)**. Each period carries its own
 * **durationMin** + a **track** tag (general/quran/arabic) — NOT a fixed clock
 * time: absolute start/end are COMPUTED from the active `ScheduleWindow.dayStart`
 * (D-#55), so the whole grid slides when the start time shifts.
 *
 * Modeling note (faithful refinement of D-#51's "audience × track × season"):
 * the school day is one continuous sequence across tracks (Class 1–5: P1+P2 Quran,
 * P3 Arabic, P5–P8 general), so a day is ONE grid per (audience, season) with each
 * period tagged by track — rather than three separate per-track grid rows to merge.
 * This expresses the same per-track durations while matching the V3 day layout. See
 * D-#58.
 *
 * Known audiences (D-#57): "nursery_kg" (6 periods, ends 10:50, single-period
 * Quran) and "class_1_5" (8 periods, ends 12:00, Quran double at P1+P2). Winter
 * compresses only P1/P2 (45→30).
 */
export interface IGridPeriod {
  number: number;
  durationMin: number;
  isBreak: boolean;
  track: PeriodTrack;
  nameBn: string;
}

export interface IPeriodGrid extends Document {
  _id: Types.ObjectId;
  /** Audience code, e.g. "nursery_kg" | "class_1_5". */
  audienceKey: string;
  /** Roster class levels this grid serves (e.g. [-1,0] or [1,2,3,4,5]). */
  classLevels: number[];
  season: Season;
  periods: IGridPeriod[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const GridPeriodSchema = new Schema<IGridPeriod>(
  {
    number: { type: Number, required: true, min: 1 },
    durationMin: { type: Number, required: true, min: 1 },
    isBreak: { type: Boolean, default: false },
    track: { type: String, enum: ["general", "quran", "arabic"], required: true },
    nameBn: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const PeriodGridSchema = new Schema<IPeriodGrid>(
  {
    audienceKey: { type: String, required: true, trim: true },
    classLevels: { type: [Number], required: true, default: [] },
    season: { type: String, enum: ["regular", "winter"], required: true },
    periods: { type: [GridPeriodSchema], required: true, default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// One grid per audience + season.
PeriodGridSchema.index({ audienceKey: 1, season: 1 }, { unique: true });

export const PeriodGrid = model<IPeriodGrid>("PeriodGrid", PeriodGridSchema);
