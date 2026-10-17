/**
 * MeetingSubjectNote — layer 3 of the parents'-meeting comment chain (MC-1,
 * docs/prd-meeting-comments.md §1–§2, D-#752/#753). ONE row per (meeting × student ×
 * subject): it is both the ROSTER entry ("this teacher owes a comment on this child")
 * and, once written, the comment itself.
 *
 *   sectionId / classId — the child's own section/class when the roster was built (the
 *                         progress board groups by these; a Quran-group subject still
 *                         files under the child's section).
 *   subject             — a ROUTINE_SUBJECT code.
 *   teacherId           — who the routine names for it (most periods wins). Only this
 *                         teacher may write the row.
 *   strengths/concerns  — the two boxes every layer has (owner, 2026-10-16). Need NOT be
 *                         about the subject — a subject teacher writes about the child.
 *   writtenAt/writtenBy — set on the first save; a written row survives a roster rebuild.
 *   skippedAt/…         — the Office/Principal skipped this subject for the section
 *                         (teacher on leave / left) so the class teacher is not held up.
 *
 * Staff-only: never shown in the guardian portal (D-#124). Identity plane (names a
 * student) — no corpus path (ADR-005). No schoolId (D-#145).
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IMeetingSubjectNote extends Document {
  _id: Types.ObjectId;
  meetingId: Types.ObjectId;
  studentId: Types.ObjectId;
  sectionId: Types.ObjectId;
  classId: Types.ObjectId;
  subject: string;
  teacherId: Types.ObjectId;
  strengths: string;
  concerns: string;
  writtenAt?: Date | null;
  writtenBy?: Types.ObjectId | null;
  skippedAt?: Date | null;
  skippedBy?: Types.ObjectId | null;
  skipReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const MeetingSubjectNoteSchema = new Schema<IMeetingSubjectNote>(
  {
    meetingId: { type: Schema.Types.ObjectId, ref: "ParentMeeting", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    subject: { type: String, required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    strengths: { type: String, default: "", trim: true },
    concerns: { type: String, default: "", trim: true },
    writtenAt: { type: Date, default: null },
    writtenBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    skippedAt: { type: Date, default: null },
    skippedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    skipReason: { type: String, default: null, trim: true },
  },
  { timestamps: true },
);

// The roster key — one row per (meeting × child × subject).
MeetingSubjectNoteSchema.index({ meetingId: 1, studentId: 1, subject: 1 }, { unique: true });
// A teacher's Today card: "my rows in this meeting".
MeetingSubjectNoteSchema.index({ meetingId: 1, teacherId: 1 });
// The progress board and the skip: rows of a section.
MeetingSubjectNoteSchema.index({ meetingId: 1, sectionId: 1, subject: 1 });
// Last meeting's note for the same child + subject.
MeetingSubjectNoteSchema.index({ studentId: 1, subject: 1, createdAt: -1 });

export const MeetingSubjectNote = model<IMeetingSubjectNote>("MeetingSubjectNote", MeetingSubjectNoteSchema);
