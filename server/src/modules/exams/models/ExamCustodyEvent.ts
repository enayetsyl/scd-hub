/**
 * ExamCustodyEvent — one physical handover (EX-6, docs/prd-exams.md §6, D-#382).
 *
 * THE OWNER'S CORE ASK. The scanned mark sheets carry the checker's and rechecker's names
 * and signatures, but no counts, no issue/return record, and no way to answer "how many
 * question papers went out, how many came back". This row is that record.
 *
 * The rule, and the reason the model looks like this:
 *   · the GIVER creates the event with `declaredCount` → PENDING_ACK;
 *   · ONLY the named receiver may acknowledge it, supplying `countedCount`;
 *   · equal counts → ACKNOWLEDGED;
 *   · DIFFERENT counts → DISPUTED, a VALID TERMINAL STATE holding BOTH numbers and a
 *     mandatory note. The app never overwrites one person's count with the other's —
 *     that is the entire point of keeping a chain rather than a logbook.
 *
 * One model spans all 12 stages rather than a model per stage: the shape is identical
 * (who, to whom, how many, acknowledged?) and a per-stage model would multiply the same
 * guards twelve times.
 */
import { Schema, model, Document, Types } from "mongoose";
import { CUSTODY_STAGES, CUSTODY_ITEM_KINDS, CUSTODY_EVENT_STATUSES } from "@scd/shared";
import type { CustodyStage, CustodyItemKind, CustodyEventStatus } from "@scd/shared";

export interface IExamCustodyEvent extends Document {
  _id: Types.ObjectId;
  examId: Types.ObjectId;
  /** Null = an exam-wide movement (a whole day's scripts), set = one paper's. */
  paperId?: Types.ObjectId;
  stage: CustodyStage;
  itemKind: CustodyItemKind;
  fromUserId: Types.ObjectId;
  toUserId: Types.ObjectId;
  /** What the giver says they handed over. */
  declaredCount: number;
  /** What the receiver actually counted. Undefined until acknowledged. */
  countedCount?: number;
  status: CustodyEventStatus;
  /** The giver's signature. */
  handedOverAt: Date;
  handedOverBy: Types.ObjectId;
  /** The receiver's signature. */
  acknowledgedAt?: Date;
  acknowledgedBy?: Types.ObjectId;
  /** MANDATORY when the counts differ — a bare mismatch with no explanation is useless. */
  discrepancyNote?: string;
  /** Photo of the bundle / the signed sheet (StoredFile ids). */
  attachmentFileIds?: Types.ObjectId[];
  cancelledAt?: Date;
  cancelledBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ExamCustodyEventSchema = new Schema<IExamCustodyEvent>(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    paperId: { type: Schema.Types.ObjectId, ref: "ExamPaper" },
    stage: { type: String, enum: CUSTODY_STAGES, required: true },
    itemKind: { type: String, enum: CUSTODY_ITEM_KINDS, required: true },
    fromUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    toUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    declaredCount: { type: Number, required: true, min: 0 },
    countedCount: { type: Number, min: 0 },
    status: { type: String, enum: CUSTODY_EVENT_STATUSES, required: true, default: "PENDING_ACK" },
    handedOverAt: { type: Date, required: true, default: () => new Date() },
    handedOverBy: { type: Schema.Types.ObjectId, required: true },
    acknowledgedAt: { type: Date },
    acknowledgedBy: { type: Schema.Types.ObjectId },
    discrepancyNote: { type: String, trim: true },
    attachmentFileIds: [{ type: Schema.Types.ObjectId, ref: "StoredFile" }],
    cancelledAt: { type: Date },
    cancelledBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

ExamCustodyEventSchema.index({ examId: 1, stage: 1 });
ExamCustodyEventSchema.index({ paperId: 1, stage: 1 });
// "What am I waiting to acknowledge?" — the teacher's inbox (EX-8).
ExamCustodyEventSchema.index({ toUserId: 1, status: 1 });

export const ExamCustodyEvent = model<IExamCustodyEvent>("ExamCustodyEvent", ExamCustodyEventSchema);
