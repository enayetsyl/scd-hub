import { Schema, model, Document, Types } from "mongoose";
import { GUARDIAN_FEATURES, type GuardianFeature } from "@scd/shared";

/**
 * Guardian release switch (D-#1011) — ONE row per guardian-facing feature. No row = OFF for
 * every family (never seeded): a feature that reaches prod stays hidden from guardians until
 * someone holding its `*:guardian_access` permission switches it on, for all guardians or for
 * the chosen ones in `guardianIds` (Guardian._id — the guardian login's userId).
 */
export interface IGuardianFeatureAccess extends Document {
  _id: Types.ObjectId;
  feature: GuardianFeature;
  onForAll: boolean;
  guardianIds: Types.ObjectId[];
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const GuardianFeatureAccessSchema = new Schema<IGuardianFeatureAccess>(
  {
    feature: { type: String, enum: GUARDIAN_FEATURES, required: true, unique: true },
    onForAll: { type: Boolean, default: false },
    guardianIds: { type: [{ type: Schema.Types.ObjectId, ref: "Guardian" }], default: [] },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const GuardianFeatureAccess = model<IGuardianFeatureAccess>("GuardianFeatureAccess", GuardianFeatureAccessSchema);
