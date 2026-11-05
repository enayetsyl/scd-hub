import { Schema, model, Document, Types } from "mongoose";

/**
 * A storybook age band (SB-1, D-#981): which class levels' guardians see the
 * series tagged with it. Admin DATA with read-time defaults when no row exists
 * (the D-#97 pattern) — see `storyAgeBands()`. It filters browsing only; it
 * never limits what the desk may issue to a child.
 */
export interface IStoryAgeBand extends Document {
  _id: Types.ObjectId;
  /** Stable key referenced by StorySeries.ageBandCode, e.g. "3-6". */
  code: string;
  labelBn: string;
  ageMin: number;
  ageMax: number;
  /** Roster class levels (-1 Nursery, 0 KG, 1..5). */
  classLevels: number[];
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const StoryAgeBandSchema = new Schema<IStoryAgeBand>(
  {
    code: { type: String, required: true, trim: true },
    labelBn: { type: String, required: true, trim: true },
    ageMin: { type: Number, required: true, min: 0 },
    ageMax: { type: Number, required: true, min: 0 },
    classLevels: { type: [Number], default: [] },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

StoryAgeBandSchema.index({ code: 1 }, { unique: true });

export const StoryAgeBand = model<IStoryAgeBand>("StoryAgeBand", StoryAgeBandSchema);
