/**
 * ParentMeetingRelease — the per-child SNAPSHOT of the numbers a family sees once the
 * Principal publishes a parents' meeting to guardians (D-#1633).
 *
 * The owner (15 Nov 2026): show guardians the figures as printed (attendance, class
 * tests, homework, assignment) with the section-best row, and the FINAL Principal/Office
 * comment — never a class- or subject-teacher comment. The numbers are frozen here so what
 * a family reads is what was printed for the meeting; the final comment is NOT copied (it
 * is read live, so a later correction shows).
 *
 * THIS MODEL HOLDS NUMBERS ONLY. There is deliberately no text field: no teacher comment,
 * no draft, no note can ever be stored on it, so no guardian read path built on it can leak
 * one (the structural half of the D-#1633 rule).
 *
 *   snapshotSource — "computed" (built by the service at publish from `MeetingBriefService`'s
 *                    number helpers) or "printed" (loaded by `load-meeting-release-snapshots`
 *                    from the brief rows that were actually printed; wins over a recompute).
 *
 * Identity plane (names a studentId) behind the ADR-005 firewall — no corpus path.
 * No schoolId (D-#145).
 */
import { Schema, model, Document, Types } from "mongoose";

export type ReleaseSnapshotSource = "computed" | "printed";
export const RELEASE_SNAPSHOT_SOURCES: ReleaseSnapshotSource[] = ["computed", "printed"];

export interface IReleaseNumbers {
  attendance: { presentDays: number; markedDays: number; absentDays: number; leaveDays: number };
  classTests: { avgPercent: number | null; sat: number; held: number };
  homework: { submitted: number; received: number };
  assignment: { submitted: number; received: number };
}

export interface IReleaseClassBest {
  withheld: boolean;
  attendancePresentDays: number | null;
  classTestAvgPct: number | null;
  homeworkPct: number | null;
  assignmentPct: number | null;
}

export interface IParentMeetingRelease extends Document {
  _id: Types.ObjectId;
  meetingId: Types.ObjectId;
  studentId: Types.ObjectId;
  window: { fromKey: string; toKey: string };
  numbers: IReleaseNumbers;
  classBest: IReleaseClassBest | null;
  snapshotSource: ReleaseSnapshotSource;
  createdAt: Date;
  updatedAt: Date;
}

const num = { type: Number, required: true, default: 0 };

const ParentMeetingReleaseSchema = new Schema<IParentMeetingRelease>(
  {
    meetingId: { type: Schema.Types.ObjectId, ref: "ParentMeeting", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    window: {
      fromKey: { type: String, required: true },
      toKey: { type: String, required: true },
    },
    numbers: {
      attendance: { presentDays: num, markedDays: num, absentDays: num, leaveDays: num },
      classTests: { avgPercent: { type: Number, default: null }, sat: num, held: num },
      homework: { submitted: num, received: num },
      assignment: { submitted: num, received: num },
    },
    classBest: {
      type: new Schema(
        {
          withheld: { type: Boolean, required: true },
          attendancePresentDays: { type: Number, default: null },
          classTestAvgPct: { type: Number, default: null },
          homeworkPct: { type: Number, default: null },
          assignmentPct: { type: Number, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    snapshotSource: { type: String, enum: RELEASE_SNAPSHOT_SOURCES, required: true },
  },
  { timestamps: true },
);

ParentMeetingReleaseSchema.index({ meetingId: 1, studentId: 1 }, { unique: true });

export const ParentMeetingRelease = model<IParentMeetingRelease>("ParentMeetingRelease", ParentMeetingReleaseSchema);
