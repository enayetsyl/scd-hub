import { Schema, model, Document, Types } from "mongoose";
import type { Role, Permission } from "@scd/shared";
import { ROLES, PERMISSIONS } from "@scd/shared";

export interface IUser extends Document {
  _id: Types.ObjectId;
  /** Login identifier — email OR phone (at least one present, D-#60). Both sparse-unique. */
  email?: string;
  /** Phone login for staff provisioned from a StaffProfile (D-#60). Sparse-unique. */
  phone?: string;
  passwordHash: string;
  role: Role;
  name: string;
  active: boolean;
  /** Per-user access control (AC-1, D-#193). All three default [] ⇒ identical-to-today
   *  (zero migration; an absent field reads as empty). `role` is the PRIMARY template;
   *  effective = (∪ [role, ...additionalTemplates] ∪ granted) − revoked − reserved(non-Principal).
   *  See shared `effectivePermissions` / `callerHasPermission`. */
  additionalTemplates: Role[];      // ASSIGNABLE_TEMPLATES only (TEACHER/OFFICE) — enforced at write
  grantedPermissions: Permission[]; // per-user adds (reserved-locked perms rejected at write)
  revokedPermissions: Permission[]; // per-user removes (a revoke always wins)
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    // email/phone are both optional but at least one is required as a login identifier (D-#60).
    // sparse so multiple docs may omit either without colliding on the unique index.
    email: { type: String, required: false, unique: true, sparse: true, lowercase: true, trim: true },
    phone: { type: String, required: false, unique: true, sparse: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    name: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
    // Per-user access control (AC-1, D-#193) — additive, default [] (zero migration).
    additionalTemplates: { type: [String], enum: ROLES, default: [] },
    grantedPermissions: { type: [String], enum: [...PERMISSIONS], default: [] },
    revokedPermissions: { type: [String], enum: [...PERMISSIONS], default: [] },
  },
  { timestamps: true },
);

// email + phone sparse-unique indexes created by the `unique: true, sparse: true` field options above.
// MIGRATION (live Atlas): the pre-existing non-sparse `email_1` index must be dropped once so
// the sparse index can replace it (allows phone-only staff users with no email). See CHANGELOG.

export const User = model<IUser>("User", UserSchema);
