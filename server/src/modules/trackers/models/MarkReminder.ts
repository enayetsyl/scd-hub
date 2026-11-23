import { Schema, model, Document, Types } from "mongoose";
import { HW_SUBJECTS, type HwSubject } from "@scd/shared";

/**
 * The Sunday mark-submission ladder's server state (D-#889/#890,
 * docs/prd-mark-submission-guard.md §2).
 *
 * MarkReminderAck — one row per (person × day × stage) once that pop-up was closed, so
 * "shown once per day" holds on every device. Closing the 09:00 pop-up also writes MORNING:
 * after the stronger reminder, the gentler one has nothing left to say.
 *
 * MarkEscalation — the 09:30 snapshot of unmarked items for one day. Snapshotted, not
 * re-read, so the Office's pop-up names the people who were late at 09:30 even after they
 * mark; the pop-up adds a live "marked since" flag per row.
 */
export const MARK_REMINDER_STAGES = ["MORNING", "NINE", "ESCALATION"] as const;
export type MarkReminderStage = (typeof MARK_REMINDER_STAGES)[number];

export interface IMarkReminderAck extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  dateKey: string;
  stage: MarkReminderStage;
  createdAt: Date;
}

const MarkReminderAckSchema = new Schema<IMarkReminderAck>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    dateKey: { type: String, required: true },
    stage: { type: String, enum: MARK_REMINDER_STAGES, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
MarkReminderAckSchema.index({ userId: 1, dateKey: 1, stage: 1 }, { unique: true });

export const MarkReminderAck = model<IMarkReminderAck>("MarkReminderAck", MarkReminderAckSchema);

/** AL-9: which question the row is about — "RECORDS" = nobody marked who handed in (2026 ladder); "MARKS" = the
 *  per-question marks are not entered / the paper is not confirmed after its deadline. */
export const MARK_ROW_STAGES = ["RECORDS", "MARKS"] as const;
export type MarkRowStage = (typeof MARK_ROW_STAGES)[number];

export interface MarkEscalationRow {
  /** The tracker item's id (an AssignmentItem; for `tracker` HOMEWORK a HomeworkItem). */
  asItemId: Types.ObjectId;
  asId: string;
  sectionId: Types.ObjectId;
  subject: HwSubject;
  /** The deliverer + any due-day proxy (D-#889). */
  teacherIds: Types.ObjectId[];
  /** AL-9 — absent on 2026 rows, which read as RECORDS / ASSIGNMENT. */
  stage?: MarkRowStage;
  tracker?: "HOMEWORK" | "ASSIGNMENT";
  paperId?: Types.ObjectId;
}

export interface IMarkEscalation extends Document {
  _id: Types.ObjectId;
  dateKey: string;
  rows: MarkEscalationRow[];
  createdAt: Date;
}

const RowSchema = new Schema<MarkEscalationRow>(
  {
    asItemId: { type: Schema.Types.ObjectId, required: true },
    asId: { type: String, required: true },
    sectionId: { type: Schema.Types.ObjectId, required: true },
    subject: { type: String, enum: HW_SUBJECTS, required: true },
    teacherIds: { type: [Schema.Types.ObjectId], default: [] },
    stage: { type: String, enum: MARK_ROW_STAGES },
    tracker: { type: String, enum: ["HOMEWORK", "ASSIGNMENT"] },
    paperId: { type: Schema.Types.ObjectId },
  },
  { _id: false },
);

const MarkEscalationSchema = new Schema<IMarkEscalation>(
  {
    dateKey: { type: String, required: true },
    rows: { type: [RowSchema], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
MarkEscalationSchema.index({ dateKey: 1 }, { unique: true });

export const MarkEscalation = model<IMarkEscalation>("MarkEscalation", MarkEscalationSchema);
