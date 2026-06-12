import { Schema, model, Document, Types } from "mongoose";

/**
 * StaffNameAlias — a remembered mapping from an export name to a StaffProfile
 * (AT1.2, D-#67). The biometric export omits the ID column, so rows are matched
 * by name; when a name doesn't uniquely resolve to one active profile the Admin
 * maps it once and the mapping persists here, so every future upload auto-matches.
 *
 * `aliasNorm` is the normalized form (lowercased, whitespace-collapsed) the
 * importer matches on; `alias` preserves the sheet's original spelling for the UI.
 */
export interface IStaffNameAlias extends Document {
  _id: Types.ObjectId;
  alias: string;
  aliasNorm: string;
  staffProfileId: Types.ObjectId;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const StaffNameAliasSchema = new Schema<IStaffNameAlias>(
  {
    alias: { type: String, required: true, trim: true },
    aliasNorm: { type: String, required: true, unique: true },
    staffProfileId: { type: Schema.Types.ObjectId, ref: "StaffProfile", required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

export const StaffNameAlias = model<IStaffNameAlias>("StaffNameAlias", StaffNameAliasSchema);
