import { Schema, model, Document, Types } from "mongoose";

/**
 * WorkCardPull (WB-5, D-#702) — "I'll take that one." An OFFICE-queue auto card
 * (a print job, a leave application) normally sits on the desk's own board
 * (primary-role OFFICE logins). While every desk login is on approved leave, the
 * backups — the OFFICE-template teacher-admins and the Principal — see those cards
 * too, and may PULL one: from then on it sits on the puller's board alone until its
 * source closes (delivered / decided). The pull is the only stored thing; the card
 * itself stays a projection.
 *
 * One pull per (kind, sourceId): re-pulling moves it. Releasing deletes the row.
 */
export interface IWorkCardPull extends Document {
  _id: Types.ObjectId;
  kind: string;
  sourceId: Types.ObjectId;
  userId: Types.ObjectId;
  pulledBy: Types.ObjectId;
  pulledAt: Date;
}

const WorkCardPullSchema = new Schema<IWorkCardPull>(
  {
    kind: { type: String, required: true },
    sourceId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    pulledBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    pulledAt: { type: Date, required: true },
  },
  { timestamps: true },
);

WorkCardPullSchema.index({ kind: 1, sourceId: 1 }, { unique: true });
WorkCardPullSchema.index({ userId: 1 });

export const WorkCardPull = model<IWorkCardPull>("WorkCardPull", WorkCardPullSchema);
