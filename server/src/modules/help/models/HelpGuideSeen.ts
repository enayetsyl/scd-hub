/**
 * HelpGuideSeen (D-#972) — which help guides one person already knows about, for the
 * "নতুন" badge.
 *
 * The row is created on the person's FIRST Help open with every guide they could see
 * then (the baseline: nothing is "new" on day one). Opening a guide adds its id. A
 * guide they can see but whose id is not here is new: one a later permission
 * unlocked, or one added in a later release. The badge clears once it is opened.
 *
 * One row per account: `ownerKind` + `ownerId` (a staff User or a portal Guardian;
 * the two id spaces are separate collections, so the kind is part of the key).
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IHelpGuideSeen extends Document {
  _id: Types.ObjectId;
  ownerKind: "USER" | "GUARDIAN";
  ownerId: Types.ObjectId;
  guideIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

const HelpGuideSeenSchema = new Schema<IHelpGuideSeen>(
  {
    ownerKind: { type: String, enum: ["USER", "GUARDIAN"], required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true },
    guideIds: { type: [String], default: [] },
  },
  { timestamps: true },
);

HelpGuideSeenSchema.index({ ownerKind: 1, ownerId: 1 }, { unique: true });

export const HelpGuideSeen = model<IHelpGuideSeen>("HelpGuideSeen", HelpGuideSeenSchema);
