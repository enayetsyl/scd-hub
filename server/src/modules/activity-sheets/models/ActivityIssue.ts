import { Schema, model, Document, Types } from "mongoose";
import {
  ACTIVITY_ISSUE_PATHS,
  ACTIVITY_ISSUE_STATUSES,
  ACTIVITY_RESULTS,
  type ActivityIssuePath,
  type ActivityIssueStatus,
  type ActivityResult,
} from "@scd/shared";

/**
 * One sheet in one child's hands (AS-2..AS-4, D-#988). Path TRAY (picked at the office),
 * GUARDIAN (requested in the app, printed with the name in the morning batch, handed out by
 * the class teacher) or DESK_PRINT (printed on the spot). Status REQUESTED → PRINTED → HANDED
 * → RETURNED (result + sticker) | NOT_RETURNED (14 days) | CANCELLED.
 *   - `repeat`: the child had this sheet before (flagged, not blocked; counted once).
 *   - `stickerOwed`: returned through the box — the class teacher hands the sticker over later.
 */
export interface IActivityIssue extends Document {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  sheetId: Types.ObjectId;
  bankId: Types.ObjectId;
  copyId?: Types.ObjectId;
  path: ActivityIssuePath;
  status: ActivityIssueStatus;
  result?: ActivityResult;
  repeat: boolean;
  /** Taken from the tray without a desk scan (busy time) — recorded only at return. */
  unscannedTake: boolean;
  stickerGiven: boolean;
  stickerOwed: boolean;
  requestedBy?: Types.ObjectId;
  requestedAt: Date;
  printedAt?: Date;
  printRunId?: string;
  handedAt?: Date;
  handedBy?: Types.ObjectId;
  returnedAt?: Date;
  checkedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ActivityIssueSchema = new Schema<IActivityIssue>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    sheetId: { type: Schema.Types.ObjectId, ref: "ActivitySheet", required: true },
    bankId: { type: Schema.Types.ObjectId, ref: "ActivityBank", required: true },
    copyId: { type: Schema.Types.ObjectId, ref: "ActivityCopy" },
    path: { type: String, enum: ACTIVITY_ISSUE_PATHS, required: true },
    status: { type: String, enum: ACTIVITY_ISSUE_STATUSES, required: true },
    result: { type: String, enum: ACTIVITY_RESULTS },
    repeat: { type: Boolean, default: false },
    unscannedTake: { type: Boolean, default: false },
    stickerGiven: { type: Boolean, default: false },
    stickerOwed: { type: Boolean, default: false },
    requestedBy: { type: Schema.Types.ObjectId },
    requestedAt: { type: Date, required: true },
    printedAt: { type: Date },
    printRunId: { type: String },
    handedAt: { type: Date },
    handedBy: { type: Schema.Types.ObjectId },
    returnedAt: { type: Date },
    checkedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

ActivityIssueSchema.index({ studentId: 1, status: 1 });
ActivityIssueSchema.index({ studentId: 1, sheetId: 1 });
ActivityIssueSchema.index({ status: 1, path: 1 });
ActivityIssueSchema.index({ printRunId: 1 });

export const ActivityIssue = model<IActivityIssue>("ActivityIssue", ActivityIssueSchema);
