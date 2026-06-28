import { Schema, model, Document, Types } from "mongoose";

/**
 * Append-only log of class-teacher / support-teacher assignment changes (CT-1,
 * D-#53). Every set/clear/add/remove appends a row with the actor + timestamp —
 * never mutated (ADR-008 audit pattern) — because teachers move between subjects/
 * classes often and these assignments gate auditable duties (attendance, leave,
 * report-card sign-off). Identity-plane; no corpus path.
 */
export interface IClassTeacherAssignment extends Document {
  _id: Types.ObjectId;
  sectionId: Types.ObjectId;
  role: "class_teacher" | "support" | "homework_confirmer";
  /** The affected teacher (null when a class teacher is cleared). */
  teacherId?: Types.ObjectId;
  op: "assigned" | "cleared" | "removed";
  actorId: Types.ObjectId;
  at: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ClassTeacherAssignmentSchema = new Schema<IClassTeacherAssignment>(
  {
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    role: { type: String, enum: ["class_teacher", "support", "homework_confirmer"], required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User" },
    op: { type: String, enum: ["assigned", "cleared", "removed"], required: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, required: true },
  },
  { timestamps: true },
);

ClassTeacherAssignmentSchema.index({ sectionId: 1, at: -1 });

export const ClassTeacherAssignment = model<IClassTeacherAssignment>(
  "ClassTeacherAssignment",
  ClassTeacherAssignmentSchema,
);
