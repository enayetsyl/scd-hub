import { Schema, model, Document, Types } from "mongoose";
import { ACTIVITY_COPY_KINDS, ACTIVITY_COPY_STATUSES, type ActivityCopyKind, type ActivityCopyStatus } from "@scd/shared";

/**
 * One printed page (AS-2, D-#988). `serial` is what the QR in the corner carries ("AS-000231");
 * scanning it finds the sheet and, once registered, the child. STOCK = tray paper with no child
 * on it; PERSONAL = printed for one child (guardian request or a desk print).
 */
export interface IActivityCopy extends Document {
  _id: Types.ObjectId;
  serial: number;
  sheetId: Types.ObjectId;
  kind: ActivityCopyKind;
  printRunId: string;
  status: ActivityCopyStatus;
  issueId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ActivityCopySchema = new Schema<IActivityCopy>(
  {
    serial: { type: Number, required: true },
    sheetId: { type: Schema.Types.ObjectId, ref: "ActivitySheet", required: true },
    kind: { type: String, enum: ACTIVITY_COPY_KINDS, required: true },
    printRunId: { type: String, required: true },
    status: { type: String, enum: ACTIVITY_COPY_STATUSES, required: true, default: "IN_TRAY" },
    issueId: { type: Schema.Types.ObjectId, ref: "ActivityIssue" },
  },
  { timestamps: true },
);

ActivityCopySchema.index({ serial: 1 }, { unique: true });
ActivityCopySchema.index({ sheetId: 1, status: 1 });
ActivityCopySchema.index({ printRunId: 1 });

export const ActivityCopy = model<IActivityCopy>("ActivityCopy", ActivityCopySchema);

/** "AS-000231" ⇄ 231. The QR and the printed label carry the long form; typing "231" works too. */
export const copyCode = (serial: number): string => `AS-${String(serial).padStart(6, "0")}`;
export function parseCopyCode(raw: string): number | null {
  const m = (raw ?? "").trim().toUpperCase().match(/^(?:AS[\s-]*)?0*(\d{1,9})$/);
  return m ? Number(m[1]) : null;
}
