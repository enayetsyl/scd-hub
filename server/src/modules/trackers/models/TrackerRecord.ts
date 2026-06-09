/**
 * TrackerRecord — one document per tracker session (J4, REQ-TRACK).
 *
 * One per set × section open/close cycle.  Status: open → closed.
 * Entries are de-identified (pseudoStudentId = sha256(studentId), ADR-005).
 *
 * Per-type entry fields:
 *   CT  — score (number)
 *   AS  — submitted (boolean)
 *   HW  — complete (boolean)
 */
import { Schema, model, Document, Types } from "mongoose";
import { TRACKER_KINDS } from "@scd/shared";
import type { TrackerKind } from "@scd/shared";

export interface TrackerEntry {
  /** sha256 hash of studentId — no identity in the document body (ADR-005). */
  pseudoStudentId: string;
  /** CT only */
  score?: number;
  /** AS only */
  submitted?: boolean;
  /** HW only */
  complete?: boolean;
}

export interface ITrackerRecord extends Document {
  _id: Types.ObjectId;
  trackerKind: TrackerKind;
  setId: Types.ObjectId;
  sectionId: Types.ObjectId;
  classId: Types.ObjectId;
  entries: TrackerEntry[];
  status: "open" | "closed";
  createdBy: Types.ObjectId;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TrackerEntrySchema = new Schema<TrackerEntry>(
  {
    pseudoStudentId: { type: String, required: true },
    score: { type: Number },
    submitted: { type: Boolean },
    complete: { type: Boolean },
  },
  { _id: false },
);

const TrackerRecordSchema = new Schema<ITrackerRecord>(
  {
    trackerKind: { type: String, enum: TRACKER_KINDS, required: true },
    setId: { type: Schema.Types.ObjectId, required: true },
    sectionId: { type: Schema.Types.ObjectId, required: true },
    classId: { type: Schema.Types.ObjectId, required: true },
    entries: { type: [TrackerEntrySchema], default: [] },
    status: { type: String, enum: ["open", "closed"], required: true, default: "open" },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    closedAt: { type: Date },
  },
  { timestamps: true },
);

TrackerRecordSchema.index({ sectionId: 1, status: 1 });
TrackerRecordSchema.index({ setId: 1, sectionId: 1 });
TrackerRecordSchema.index({ trackerKind: 1, sectionId: 1 });

export const TrackerRecord = model<ITrackerRecord>("TrackerRecord", TrackerRecordSchema);
