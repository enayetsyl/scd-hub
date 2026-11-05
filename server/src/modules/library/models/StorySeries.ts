import { Schema, model, Document, Types } from "mongoose";
import { STORY_SERIES_STATUSES, type StorySeriesStatus } from "@scd/shared";

/**
 * A storybook series (SB-1, D-#980) — the layer over library titles that the
 * guardian catalogue browses. Its books are ordinary `BookTitle` rows carrying
 * `seriesId` + `seriesNo`; copies, loans and the waitlist stay the library's.
 * Only PUBLISHED series reach guardians, and only of their child's age band.
 */
export interface IStorySeries extends Document {
  _id: Types.ObjectId;
  /** 2–4 capital letters, unique (TRE) — the prefix of every copy code. */
  code: string;
  nameBn: string;
  nameEn?: string;
  ageBandCode: string;
  tagIds: Types.ObjectId[];
  aboutBn?: string;
  /** "এই সিরিজে শিশু যা শিখবে" points. */
  learnPointsBn: string[];
  /** A `storybook_page` StoredFile — defaults to the first book's cover. */
  coverFileId?: Types.ObjectId;
  sortOrder: number;
  status: StorySeriesStatus;
  createdAt: Date;
  updatedAt: Date;
}

const StorySeriesSchema = new Schema<IStorySeries>(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    nameBn: { type: String, required: true, trim: true },
    nameEn: { type: String, trim: true },
    ageBandCode: { type: String, required: true, trim: true },
    tagIds: { type: [Schema.Types.ObjectId], ref: "StoryTag", default: [] },
    aboutBn: { type: String, trim: true },
    learnPointsBn: { type: [String], default: [] },
    coverFileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    sortOrder: { type: Number, default: 0 },
    status: { type: String, enum: STORY_SERIES_STATUSES, required: true, default: "DRAFT" },
  },
  { timestamps: true },
);

StorySeriesSchema.index({ code: 1 }, { unique: true });
StorySeriesSchema.index({ status: 1, ageBandCode: 1, sortOrder: 1 });

export const StorySeries = model<IStorySeries>("StorySeries", StorySeriesSchema);
