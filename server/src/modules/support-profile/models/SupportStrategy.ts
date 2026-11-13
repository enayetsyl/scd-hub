import { Schema, model, Document, Types } from "mongoose";
import { SUPPORT_STRATEGY_KINDS, type SupportStrategyKind } from "@scd/shared";

/** SupportStrategy (§5.4) — the per-child strategy library. Counts are DERIVED on read from the
 *  approved reports' `strategyLinks` (D-#85), never stored here. */
export interface ISupportStrategy extends Document {
  _id: Types.ObjectId;
  profileId: Types.ObjectId;
  titleBn: string;
  howBn: string;
  sayBn: string;
  kind: SupportStrategyKind;
  needTag: string | null;
  functionTag: string | null;
  starterKey: string | null;
  contextTags: string[];
  status: "ACTIVE" | "RETIRED";
  createdFromReportId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const SupportStrategySchema = new Schema<ISupportStrategy>(
  {
    profileId: { type: Schema.Types.ObjectId, ref: "SupportProfile", required: true },
    titleBn: { type: String, required: true, maxlength: 90 },
    howBn: { type: String, default: "", maxlength: 400 },
    sayBn: { type: String, default: "", maxlength: 120 },
    kind: { type: String, enum: SUPPORT_STRATEGY_KINDS, required: true },
    needTag: { type: String, default: null },
    functionTag: { type: String, default: null },
    starterKey: { type: String, default: null },
    contextTags: { type: [String], default: [] },
    status: { type: String, enum: ["ACTIVE", "RETIRED"], default: "ACTIVE" },
    createdFromReportId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);
SupportStrategySchema.index({ profileId: 1, status: 1 });

export const SupportStrategy = model<ISupportStrategy>("SupportStrategy", SupportStrategySchema);
