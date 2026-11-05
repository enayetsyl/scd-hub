import { Schema, model, Document, Types } from "mongoose";

/**
 * A managed storybook tag (SB-1, D-#986) — "প্রকৃতি · Nature". Books and series
 * hold tag ids, so a rename shows everywhere at once; a merge moves the ids to
 * the surviving tag and retires the other (active: false, kept for history).
 */
export interface IStoryTag extends Document {
  _id: Types.ObjectId;
  nameBn: string;
  nameEn?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const StoryTagSchema = new Schema<IStoryTag>(
  {
    nameBn: { type: String, required: true, trim: true },
    nameEn: { type: String, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

StoryTagSchema.index({ nameBn: 1 });

export const StoryTag = model<IStoryTag>("StoryTag", StoryTagSchema);
