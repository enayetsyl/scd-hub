import { Schema, model, Document, Types } from "mongoose";
import { HW_SUBJECTS, type HwSubject } from "@scd/shared";

/**
 * MarkCorrectionNote (D-#892/#893, docs/prd-mark-submission-guard.md §4) — the staff-file
 * record of a same-day mark correction: a child the teacher marked "not brought" (a CHASE
 * stamp made by a person, today) was flipped to submitted, or the chase undone, the same
 * Dhaka day. Owner ruling 2026-11-02: that is always the teacher's mistake — the guardian
 * has already been told the work was not brought.
 *
 * ONE note per (tracker × item × the person who made the chase × day); the children are
 * appended as they are flipped, so one wrong pass is one note, not ten. The note belongs to
 * whoever made the CHASE stamp (`staffUserId`), even when someone else corrected it.
 *
 * Deliberately lighter than ConductRecord (owner: "yes lighter version"): no stage, no
 * hearing, no lapse, and it never feeds the conduct ladder. Shown in the staff file as
 * "নম্বর জমায় ভুল". Identity/operational plane behind ADR-005 (no corpus path).
 */
export const MARK_CORRECTION_TRACKERS = ["HOMEWORK", "ASSIGNMENT"] as const;
export type MarkCorrectionTracker = (typeof MARK_CORRECTION_TRACKERS)[number];

/** FLIP: the record went CHASE → SUBMITTED. UNDO: the chase itself was undone (D-#338). */
export const MARK_CORRECTION_VIAS = ["FLIP", "UNDO"] as const;
export type MarkCorrectionVia = (typeof MARK_CORRECTION_VIAS)[number];

export interface MarkCorrectionStudent {
  studentId: Types.ObjectId;
  recordId: Types.ObjectId;
  chasedAt: Date;
  correctedAt: Date;
  correctedBy: Types.ObjectId;
  via: MarkCorrectionVia;
}

export interface IMarkCorrectionNote extends Document {
  _id: Types.ObjectId;
  /** The person who made the wrong CHASE mark. */
  staffUserId: Types.ObjectId;
  tracker: MarkCorrectionTracker;
  itemId: Types.ObjectId;
  /** HW_ID / AS_ID, snapshotted for the list. */
  itemCode: string;
  sectionId: Types.ObjectId;
  subject: HwSubject;
  /** Dhaka day of the chase and the correction (they are the same day by definition). */
  dateKey: string;
  students: MarkCorrectionStudent[];
  createdAt: Date;
  updatedAt: Date;
}

const StudentSchema = new Schema<MarkCorrectionStudent>(
  {
    studentId: { type: Schema.Types.ObjectId, required: true },
    recordId: { type: Schema.Types.ObjectId, required: true },
    chasedAt: { type: Date, required: true },
    correctedAt: { type: Date, required: true },
    correctedBy: { type: Schema.Types.ObjectId, required: true },
    via: { type: String, enum: MARK_CORRECTION_VIAS, required: true },
  },
  { _id: false },
);

const MarkCorrectionNoteSchema = new Schema<IMarkCorrectionNote>(
  {
    staffUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    tracker: { type: String, enum: MARK_CORRECTION_TRACKERS, required: true },
    itemId: { type: Schema.Types.ObjectId, required: true },
    itemCode: { type: String, required: true },
    sectionId: { type: Schema.Types.ObjectId, required: true },
    subject: { type: String, enum: HW_SUBJECTS, required: true },
    dateKey: { type: String, required: true },
    students: { type: [StudentSchema], default: [] },
  },
  { timestamps: true },
);

MarkCorrectionNoteSchema.index({ tracker: 1, itemId: 1, staffUserId: 1, dateKey: 1 }, { unique: true });
MarkCorrectionNoteSchema.index({ staffUserId: 1, createdAt: -1 });
MarkCorrectionNoteSchema.index({ createdAt: -1 });

export const MarkCorrectionNote = model<IMarkCorrectionNote>("MarkCorrectionNote", MarkCorrectionNoteSchema);
