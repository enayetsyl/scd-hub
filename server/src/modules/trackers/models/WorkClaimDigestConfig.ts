import { Schema, model, Document, Types } from "mongoose";

/**
 * WorkClaimDigestConfig (D-#710) — who ELSE gets the 10:30 guardian-claim digest.
 *
 * Every active Principal and Office user is always a recipient; this row only adds
 * people the Principal names (owner ruling 2026-10-04: Akter Hossen and Tazkir, two
 * teachers who chase the others). A recipient here may also open the claim queue and
 * nudge from it — a digest that links to a page its reader cannot open is a dead end.
 *
 * At most ONE row (`key: "SINGLETON"`); a missing row reads as "no extra
 * recipients" — read-time default, NEVER seeded by a startup/bulk write against the
 * shared live DB (D-#97). Edited in-app via `setWorkClaimDigestRecipients`
 * (Principal only). Identity/operational plane — no corpus path (ADR-005).
 */
export interface IWorkClaimDigestConfig extends Document {
  _id: Types.ObjectId;
  /** Always "SINGLETON" — at most one config row. */
  key: string;
  /** Users who receive the digest in addition to every Principal and Office user. */
  extraRecipientIds: Types.ObjectId[];
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const WorkClaimDigestConfigSchema = new Schema<IWorkClaimDigestConfig>(
  {
    key: { type: String, required: true, unique: true, default: "SINGLETON" },
    extraRecipientIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

export const WorkClaimDigestConfig = model<IWorkClaimDigestConfig>(
  "WorkClaimDigestConfig",
  WorkClaimDigestConfigSchema,
);
