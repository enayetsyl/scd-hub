import { Schema, model, Document, Types } from "mongoose";

/**
 * A child's place in one class and section for a span of dates (YC-1, docs/prd-year-change.md §2.1,
 * D-#1460 YC-D1 hybrid model). `Student.classId/sectionId` stays the CURRENT pointer; this record is
 * the dated history that past-date readers use.
 *
 * No roll number (D-#1463): the school orders and labels children by the student ID.
 * `startKey` / `endKey` are Dhaka date keys (`YYYY-MM-DD`); `endKey` is the LAST day of the span.
 */
export type EnrolmentStatus = "PLANNED" | "ACTIVE" | "CLOSED";
export type EnrolmentOutcome = "PROMOTED" | "REPEATED" | "LEFT" | "MOVED";
export const ENROLMENT_STATUSES: readonly EnrolmentStatus[] = ["PLANNED", "ACTIVE", "CLOSED"];
export const ENROLMENT_OUTCOMES: readonly EnrolmentOutcome[] = ["PROMOTED", "REPEATED", "LEFT", "MOVED"];

export interface IEnrolment extends Document {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  academicYearId: Types.ObjectId;
  classId: Types.ObjectId;
  classLevel: number;
  sectionId: Types.ObjectId;
  status: EnrolmentStatus;
  startKey: string;
  endKey?: string;
  outcome?: EnrolmentOutcome;
  runId?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const EnrolmentSchema = new Schema<IEnrolment>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    academicYearId: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true },
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    classLevel: { type: Number, required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    status: { type: String, enum: ENROLMENT_STATUSES, required: true, default: "ACTIVE" },
    startKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    endKey: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    outcome: { type: String, enum: ENROLMENT_OUTCOMES },
    runId: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

EnrolmentSchema.index({ studentId: 1, academicYearId: 1, startKey: 1 }, { unique: true });
EnrolmentSchema.index({ sectionId: 1, status: 1 });
EnrolmentSchema.index({ academicYearId: 1, classId: 1 });

export const Enrolment = model<IEnrolment>("Enrolment", EnrolmentSchema);
