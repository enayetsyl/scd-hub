import { Schema, model, Document, Types } from "mongoose";

/**
 * ClassTestCorrectionNote (D-#945, docs/prd-staff-mistakes.md §11) — what changed after
 * guardians had already been shown a class test:
 *
 *   MARKS    a result published again with different marks / present-absent; one line per child
 *   SCRIPTS  published scripts pulled back (the pages were wrong or unreadable)
 *
 * ONE note per (test × kind × owner × episode). The owner is whoever entered the published
 * marks (MARKS) or published the scripts (SCRIPTS). A new episode starts once the entry behind
 * the previous one has been explained or decided. The StaffMistake row points here.
 */
export const CLASS_TEST_CORRECTION_KINDS = ["MARKS", "SCRIPTS"] as const;
export type ClassTestCorrectionKind = (typeof CLASS_TEST_CORRECTION_KINDS)[number];

export interface ClassTestCorrectionChange {
  studentId?: Types.ObjectId | null;
  fromMarks?: number | null;
  toMarks?: number | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  at: Date;
  by: Types.ObjectId;
}

export interface IClassTestCorrectionNote extends Document {
  _id: Types.ObjectId;
  testId: Types.ObjectId;
  kind: ClassTestCorrectionKind;
  staffUserId: Types.ObjectId;
  episode: number;
  changes: ClassTestCorrectionChange[];
  createdAt: Date;
  updatedAt: Date;
}

const ChangeSchema = new Schema<ClassTestCorrectionChange>(
  {
    studentId: { type: Schema.Types.ObjectId, default: null },
    fromMarks: { type: Number, default: null },
    toMarks: { type: Number, default: null },
    fromStatus: { type: String, default: null },
    toStatus: { type: String, default: null },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const ClassTestCorrectionNoteSchema = new Schema<IClassTestCorrectionNote>(
  {
    testId: { type: Schema.Types.ObjectId, ref: "ClassTest", required: true },
    kind: { type: String, enum: CLASS_TEST_CORRECTION_KINDS, required: true },
    staffUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    episode: { type: Number, default: 1 },
    changes: { type: [ChangeSchema], default: [] },
  },
  { timestamps: true },
);

ClassTestCorrectionNoteSchema.index({ testId: 1, kind: 1, staffUserId: 1, episode: 1 }, { unique: true });

export const ClassTestCorrectionNote = model<IClassTestCorrectionNote>("ClassTestCorrectionNote", ClassTestCorrectionNoteSchema);
