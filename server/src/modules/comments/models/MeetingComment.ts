/**
 * MeetingComment — the consolidated Positive + Concern note a child's CLASS TEACHER
 * writes for a parents' meeting (CM-5, prd-comments-meetings §3, D-#124). ONE per
 * (student × meeting). Replaces the re-typed `Comments.xlsx` Positive/Negative columns.
 *
 *   meetingId / studentId — the (meeting × child) this note belongs to (unique pair).
 *   authorUserId          — the authenticated class teacher who wrote it (J-CM6).
 *   positiveText          — what went well (face-to-face talking point).
 *   concernText           — what to work on.
 *
 * Authored ONLY by the section's class teacher (`assertIsClassTeacher`, the D-#42/#45
 * parent-comms coordinator duty) — NOT Office/Principal (J-CM6). The meeting comment is
 * for in-meeting / printed use and is **never shown in the guardian portal** (J-CM8) —
 * the guardian shape structurally cannot reach it.
 *
 * Build ruling D-#145 convention: NO `schoolId` (single-school live repo). Identity
 * plane behind the ADR-005 firewall (names studentId) — no corpus path.
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IMeetingComment extends Document {
  _id: Types.ObjectId;
  meetingId: Types.ObjectId;
  studentId: Types.ObjectId;
  /** The authenticated class teacher who authored it. */
  authorUserId: Types.ObjectId;
  positiveText: string;
  concernText: string;
  createdAt: Date;
  updatedAt: Date;
}

const MeetingCommentSchema = new Schema<IMeetingComment>(
  {
    meetingId: { type: Schema.Types.ObjectId, ref: "ParentMeeting", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    authorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    positiveText: { type: String, default: "", trim: true },
    concernText: { type: String, default: "", trim: true },
  },
  { timestamps: true },
);

// One consolidated note per (student × meeting) — the upsert key (saveMeetingComment).
MeetingCommentSchema.index({ meetingId: 1, studentId: 1 }, { unique: true });
// The comparison timeline reads a child's notes across meetings, newest first.
MeetingCommentSchema.index({ studentId: 1, createdAt: -1 });

export const MeetingComment = model<IMeetingComment>("MeetingComment", MeetingCommentSchema);
