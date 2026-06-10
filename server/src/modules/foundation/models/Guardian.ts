import { Schema, model, Document, Types } from "mongoose";

/** Guardian auth can use email, phone, or school unique-ID (ADR-016, D-#9). */
export type GuardianIdentifierKind = "email" | "phone" | "school_id";

export interface IGuardian extends Document {
  _id: Types.ObjectId;
  /** Flexible login identifier: what was provided at creation. */
  identifierKind: GuardianIdentifierKind;
  identifier: string;
  /** Email is optional — only present when identifierKind === "email" or added separately. */
  email?: string;
  /** Optional: absent for contact-only guardians imported from the roster (loginEnabled=false, D-#31).
   *  Required in practice before a guardian can authenticate (enforced at login, not in the schema). */
  passwordHash?: string;
  /** Whether this guardian can log in to the portal. Roster-imported contacts start false. */
  loginEnabled: boolean;
  name: string;
  phone?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const GuardianSchema = new Schema<IGuardian>(
  {
    identifierKind: {
      type: String,
      enum: ["email", "phone", "school_id"],
      required: true,
    },
    identifier: { type: String, required: true, trim: true },
    email: { type: String, sparse: true, lowercase: true, trim: true },
    passwordHash: { type: String },
    loginEnabled: { type: Boolean, default: false },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Unique per identifier kind+value so different kinds don't collide
GuardianSchema.index({ identifierKind: 1, identifier: 1 }, { unique: true });

export const Guardian = model<IGuardian>("Guardian", GuardianSchema);
