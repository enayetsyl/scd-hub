import { Schema, model, Document, Types } from "mongoose";
import { EDITABLE_ROLES, type EditableRole } from "@scd/shared";

/**
 * A role-template edit (PM, D-#791): the Principal's switches for one editable role,
 * stored as a DELTA on the code default in `FEATURE_CATALOGUE`. One row per role.
 *
 *   granted — catalogue actions turned ON that the code default leaves off
 *   revoked — catalogue actions turned OFF that the code default turns on
 *
 * A delta (not a stored full set) means a later release's new default action still reaches
 * the role unless the Principal turned that action off. Absent row ⇒ the code default.
 * Identity plane (access-control); no corpus path (ADR-005).
 */
export interface IRoleTemplateOverride extends Document {
  _id: Types.ObjectId;
  role: EditableRole;
  granted: string[];
  revoked: string[];
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RoleTemplateOverrideSchema = new Schema<IRoleTemplateOverride>(
  {
    role: { type: String, enum: EDITABLE_ROLES, required: true, unique: true },
    granted: { type: [String], default: [] },
    revoked: { type: [String], default: [] },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const RoleTemplateOverride = model<IRoleTemplateOverride>("RoleTemplateOverride", RoleTemplateOverrideSchema);
