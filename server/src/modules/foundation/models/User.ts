import { Schema, model, Document, Types } from "mongoose";
import type { Role } from "@scd/shared";
import { ROLES } from "@scd/shared";

export interface IUser extends Document {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  role: Role;
  name: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    name: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// email unique index already created by the `unique: true` field option above

export const User = model<IUser>("User", UserSchema);
