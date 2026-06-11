import { Schema, model, Document, Types } from "mongoose";

/**
 * A cover/substitution for one routine slot on one date (R-4, D-#22). When a
 * teacher is absent, an admin assigns a cover teacher for specific (date, slot)s.
 * For a Section slot it is backed by a time-bounded **proxy ScopeGrant** (D-#20)
 * so the cover gains the covered class's read/write for the window; for a Quran/
 * Arabic SubjectGroup slot there is no content scope, so no grant is created (the
 * substitution is still recorded so the views show the cover).
 *
 * Date-specific: a substitution only overrides its own date — the routine resolves
 * back to the substantive teacher otherwise; the proxy grant auto-expires on its
 * own window (D-#20/#21), not re-implemented here. Operational/identity plane.
 */
export interface IRoutineSubstitution extends Document {
  _id: Types.ObjectId;
  slotId: Types.ObjectId;
  /** The covered date (local midnight). */
  date: Date;
  coverTeacherId: Types.ObjectId;
  /** The substantive teacher being covered (snapshot from the slot). */
  absentTeacherId?: Types.ObjectId;
  reason?: string;
  /** The backing proxy ScopeGrant (Section slots only). */
  proxyGrantId?: Types.ObjectId;
  active: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RoutineSubstitutionSchema = new Schema<IRoutineSubstitution>(
  {
    slotId: { type: Schema.Types.ObjectId, ref: "RoutineSlot", required: true },
    date: { type: Date, required: true },
    coverTeacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    absentTeacherId: { type: Schema.Types.ObjectId, ref: "User" },
    reason: { type: String, trim: true },
    proxyGrantId: { type: Schema.Types.ObjectId, ref: "ScopeGrant" },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

RoutineSubstitutionSchema.index({ slotId: 1, date: 1, active: 1 });
RoutineSubstitutionSchema.index({ coverTeacherId: 1, active: 1 });

export const RoutineSubstitution = model<IRoutineSubstitution>(
  "RoutineSubstitution",
  RoutineSubstitutionSchema,
);
