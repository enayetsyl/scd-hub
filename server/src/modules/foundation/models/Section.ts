import { Schema, model, Document, Types } from "mongoose";
import { DEFAULT_SECTION_CODE } from "@scd/shared";

export interface ISection extends Document {
  _id: Types.ObjectId;
  classId: Types.ObjectId;
  code: string;
  nameBn: string;
  active: boolean;
  /** The section's CLASS TEACHER — the section's **daily coordinator** (D-#42, the
   *  general gate behind `assertIsClassTeacher`): runs homework reconciliation today,
   *  and the future attendance / leave / report-card / parent-comms duties. A TEACHER
   *  User; optional (an unassigned section cannot run a coordinator action until set). */
  classTeacherId?: Types.ObjectId;
  /** Optional SUPPORT / assistant teachers on the section (D-#53) — recorded helpers
   *  (Nursery has one; KG/others may later). NOT the coordinator gate: a support
   *  teacher does not inherit `assertIsClassTeacher` rights. A list of TEACHER Users. */
  supportTeacherIds?: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const SectionSchema = new Schema<ISection>(
  {
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    code: { type: String, required: true, trim: true, default: DEFAULT_SECTION_CODE },
    nameBn: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
    classTeacherId: { type: Schema.Types.ObjectId, ref: "User" },
    supportTeacherIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true },
);

SectionSchema.index({ classId: 1, code: 1 }, { unique: true });

export const Section = model<ISection>("Section", SectionSchema);
