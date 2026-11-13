import { Schema, model, Document, Types } from "mongoose";

/**
 * WinterBookletChange (D-#1620) — one suggested edit to a booklet block, or a page note
 * (blockId null). Only the reviewer who made it edits or deletes it, and only while OPEN;
 * the Principal accepts or rejects. `stale` = the block's text moved on in a re-import, so
 * `before` no longer matches and the suggestion must be looked at again.
 */
export const WINTER_CHANGE_STATUSES = ["OPEN", "ACCEPTED", "REJECTED", "DELETED"] as const;
export type WinterChangeStatus = (typeof WINTER_CHANGE_STATUSES)[number];

export interface IWinterBookletChange extends Document {
  _id: Types.ObjectId;
  bookletId: Types.ObjectId;
  pageN: number;
  /** null = a note about the whole page. */
  blockId: string | null;
  /** The block's imported text when the suggestion was made. */
  before: string;
  /** The suggested text ("" = remove it). Unused for a pure note. */
  after: string;
  note?: string;
  by: Types.ObjectId;
  status: WinterChangeStatus;
  stale: boolean;
  editedAt?: Date;
  decidedBy?: Types.ObjectId;
  decidedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WinterBookletChangeSchema = new Schema<IWinterBookletChange>(
  {
    bookletId: { type: Schema.Types.ObjectId, ref: "WinterBooklet", required: true },
    pageN: { type: Number, required: true },
    blockId: { type: String, default: null },
    before: { type: String, default: "" },
    after: { type: String, default: "" },
    note: { type: String },
    by: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: WINTER_CHANGE_STATUSES, default: "OPEN" },
    stale: { type: Boolean, default: false },
    editedAt: { type: Date },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
    decidedAt: { type: Date },
  },
  { timestamps: true },
);

WinterBookletChangeSchema.index({ bookletId: 1, pageN: 1, status: 1 });
WinterBookletChangeSchema.index({ bookletId: 1, by: 1 });

export const WinterBookletChange = model<IWinterBookletChange>("WinterBookletChange", WinterBookletChangeSchema);
