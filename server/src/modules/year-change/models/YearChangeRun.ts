import { Schema, model, Document, Types } from "mongoose";

/**
 * One year-change run (YC-4, prd-year-change section 3, D-#1450 YC-D7). Holds what the PLANNED rows
 * alone cannot say: who is leaving, which pre-existing sections got a class teacher from the run
 * (so the undo can put the old one back), and - once the cut-over starts - the before-state of every
 * Student it will change (written FIRST, so a resumed run still undoes byte for byte).
 *
 * Deleted by `undoPrepare` (the audit row keeps the record).
 */
export type YearChangeRunStatus = "PREPARED" | "CUTTING_OVER" | "CUT_OVER";

export interface StudentBefore {
  studentId: string;
  classId: string;
  sectionId: string;
  active: boolean;
  /** Absent keys were absent on the document. */
  rollNumber?: string;
  scholarshipExcluded?: boolean;
  /** ISO time - restored too, so the undo is byte for byte. */
  updatedAt?: string;
}

export interface IYearChangeRun extends Document {
  _id: Types.ObjectId;
  runId: string;
  fromYearId: Types.ObjectId;
  toYearId: Types.ObjectId;
  status: YearChangeRunStatus;
  leaverIds: string[];
  /** Pre-existing next-year sections whose class teacher this run set (previous = null when none). */
  teacherSets: Array<{ sectionId: string; previous: string | null }>;
  before?: StudentBefore[];
  /** YC-6: 2026 routine slots whose effectiveTo this run set (previous = ISO time or null). Undo restores them. */
  routineEnds: Array<{ slotId: string; previous: string | null }>;
  /** YC-6: grants whose expiresAt this run stamped (previous = ISO time or null). Undo restores them. */
  grantExpiries: Array<{ grantId: string; previous: string | null }>;
  improvementEndedIds: string[];
  preparedBy?: Types.ObjectId;
  cutOverBy?: Types.ObjectId;
  cutOverAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const YearChangeRunSchema = new Schema<IYearChangeRun>(
  {
    runId: { type: String, required: true, unique: true },
    fromYearId: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true },
    toYearId: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true },
    status: { type: String, enum: ["PREPARED", "CUTTING_OVER", "CUT_OVER"], required: true, default: "PREPARED" },
    leaverIds: { type: [String], default: [] },
    teacherSets: { type: Schema.Types.Mixed, default: [] },
    before: { type: Schema.Types.Mixed },
    routineEnds: { type: Schema.Types.Mixed, default: [] },
    grantExpiries: { type: Schema.Types.Mixed, default: [] },
    improvementEndedIds: { type: [String], default: [] },
    preparedBy: { type: Schema.Types.ObjectId, ref: "User" },
    cutOverBy: { type: Schema.Types.ObjectId, ref: "User" },
    cutOverAt: { type: Date },
  },
  { timestamps: true },
);

export const YearChangeRun = model<IYearChangeRun>("YearChangeRun", YearChangeRunSchema);
