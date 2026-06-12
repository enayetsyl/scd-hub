import { Schema, model, Document, Types } from "mongoose";

/** Many-to-many join: one guardian, many children; one child, many guardians.
 *  Uniform access — no per-link access_level column (ADR-013/016, D-#8). */
export interface IGuardianLink extends Document {
  _id: Types.ObjectId;
  guardianId: Types.ObjectId;
  studentId: Types.ObjectId;
  relation: string;
  /** An inactive link revokes the guardian's portal read for that child (GP-1).
   *  Optional on pre-GP-1 rows: a MISSING value means active (lean reads skip
   *  defaults, and the 194 live links predate the field) — only an explicit
   *  `false` denies. */
  active?: boolean;
  createdAt: Date;
}

const GuardianLinkSchema = new Schema<IGuardianLink>(
  {
    guardianId: { type: Schema.Types.ObjectId, ref: "Guardian", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    relation: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

GuardianLinkSchema.index({ guardianId: 1 });
GuardianLinkSchema.index({ studentId: 1 });
GuardianLinkSchema.index({ guardianId: 1, studentId: 1 }, { unique: true });

export const GuardianLink = model<IGuardianLink>("GuardianLink", GuardianLinkSchema);
