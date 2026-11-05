import { Schema, model, Document, Types } from "mongoose";
import {
  STAFF_MISTAKE_KINDS,
  STAFF_MISTAKE_STATUSES,
  type StaffMistakeKind,
  type StaffMistakeStatus,
} from "@scd/shared";

/**
 * StaffMistake (D-#936, docs/prd-staff-mistakes.md §1) — one caught mistake for one person,
 * with the person's reason and the reviewer's decision. The source keeps its own detail
 * (a `MarkCorrectionNote` for `MARK_CORRECTION`); this row is what the person explains and
 * what Office / the Principal decide.
 *
 * Lighter than ConductRecord, like the note it grew from (D-#893): no stage, no hearing,
 * never feeds the conduct ladder by itself. Identity/operational plane behind ADR-005.
 */
export interface IStaffMistake extends Document {
  _id: Types.ObjectId;
  /** Whose mistake it is — the person who made the wrong mark, not whoever corrected it. */
  staffUserId: Types.ObjectId;
  kind: StaffMistakeKind;
  /** 1 = the wrong thing already reached someone; 2 = caught before; 3 = missed duty. */
  tier: number;
  /** The source row (MarkCorrectionNote._id for MARK_CORRECTION). */
  sourceId: Types.ObjectId;
  /** Dhaka day the mistake was caught. */
  dateKey: string;
  status: StaffMistakeStatus;
  reasonCode?: string | null;
  reasonText?: string | null;
  explainedAt?: Date | null;
  explainDueAt: Date;
  /** Counted because the deadline passed with no explanation. */
  autoCounted: boolean;
  decidedBy?: Types.ObjectId | null;
  decidedAt?: Date | null;
  decisionNote?: string | null;
  movedFromId?: Types.ObjectId | null;
  movedToId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const StaffMistakeSchema = new Schema<IStaffMistake>(
  {
    staffUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: STAFF_MISTAKE_KINDS, required: true },
    tier: { type: Number, required: true, min: 1, max: 3 },
    sourceId: { type: Schema.Types.ObjectId, required: true },
    dateKey: { type: String, required: true },
    status: { type: String, enum: STAFF_MISTAKE_STATUSES, required: true },
    reasonCode: { type: String, default: null },
    reasonText: { type: String, default: null },
    explainedAt: { type: Date, default: null },
    explainDueAt: { type: Date, required: true },
    autoCounted: { type: Boolean, default: false },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: null },
    movedFromId: { type: Schema.Types.ObjectId, default: null },
    movedToId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

StaffMistakeSchema.index({ kind: 1, sourceId: 1, staffUserId: 1 }, { unique: true });
StaffMistakeSchema.index({ staffUserId: 1, createdAt: -1 });
StaffMistakeSchema.index({ status: 1, explainDueAt: 1 });

export const StaffMistake = model<IStaffMistake>("StaffMistake", StaffMistakeSchema);
