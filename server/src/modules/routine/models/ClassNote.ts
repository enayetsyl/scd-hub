import { Schema, model, Document, Types } from "mongoose";
import type { RoutineSubject } from "@scd/shared";

/**
 * A class-note / daily-diary entry (R-5, D-#52): the subject teacher posts WHAT WAS
 * TAUGHT for a slot on a date, plus a link to the day's homework (the existing HW-T1
 * `HomeworkItem` declaration — NOT a second homework path). One note per (slot, date).
 * Guardians read it (the on-publish notification rides the deferred push pipeline).
 *
 * `groupType`/`groupId` are denormalized from the slot so a group's notes for a date
 * are a single query. Operational/identity plane (names a teacher); no corpus path.
 */
export interface IClassNote extends Document {
  _id: Types.ObjectId;
  slotId: Types.ObjectId;
  groupType: "section" | "subjectgroup";
  groupId: Types.ObjectId;
  date: Date;
  subject: RoutineSubject;
  taughtSummaryBn: string;
  /** Link to the day's HW-T1 declaration (reused, not duplicated). */
  homeworkItemId?: Types.ObjectId;
  /** Optional StoredFile attachments (≤5, classnote_attachment kind). */
  attachmentIds?: Types.ObjectId[];
  publishedBy: Types.ObjectId;
  publishedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ClassNoteSchema = new Schema<IClassNote>(
  {
    slotId: { type: Schema.Types.ObjectId, ref: "RoutineSlot", required: true },
    groupType: { type: String, enum: ["section", "subjectgroup"], required: true },
    groupId: { type: Schema.Types.ObjectId, required: true },
    date: { type: Date, required: true },
    subject: { type: String, required: true },
    taughtSummaryBn: { type: String, required: true, trim: true },
    homeworkItemId: { type: Schema.Types.ObjectId, ref: "HomeworkItem" },
    attachmentIds: { type: [Schema.Types.ObjectId], ref: "StoredFile", default: undefined },
    publishedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    publishedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// One note per slot per date; group+date listing.
ClassNoteSchema.index({ slotId: 1, date: 1 }, { unique: true });
ClassNoteSchema.index({ groupType: 1, groupId: 1, date: 1 });
// A guardian opening an attachment resolves the OWNING note by file id — the pointer
// runs note→file, so this sparse multikey index backs that reverse lookup.
ClassNoteSchema.index({ attachmentIds: 1 }, { sparse: true });

export const ClassNote = model<IClassNote>("ClassNote", ClassNoteSchema);
