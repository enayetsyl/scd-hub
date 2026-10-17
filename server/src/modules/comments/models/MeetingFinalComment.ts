/**
 * MeetingFinalComment — layer 1 of the parents'-meeting comment chain (MC-1,
 * docs/prd-meeting-comments.md §1, D-#752): the Principal's / Office's word, the first
 * thing the person meeting the guardian reads. ONE per (meeting × student).
 *
 *   source — how it was started from the class teacher's summary:
 *            AS_IS  = the summary accepted unchanged (its text copied here, so a later
 *                     edit of nothing upstream can move the final),
 *            EDITED = a copy of the summary, edited,
 *            OWN    = a separate comment written from scratch.
 *            The class teacher's own row (MeetingComment) is never overwritten.
 *   authorUserId — the last Principal/Office who saved it (shown on the brief).
 *
 * Staff-only (D-#124): the guardian sees it only on a printed brief handed over.
 * Identity plane — no corpus path (ADR-005). No schoolId (D-#145).
 */
import { Schema, model, Document, Types } from "mongoose";

export const MEETING_FINAL_SOURCES = ["AS_IS", "EDITED", "OWN"] as const;
export type MeetingFinalSource = (typeof MEETING_FINAL_SOURCES)[number];

export interface IMeetingFinalComment extends Document {
  _id: Types.ObjectId;
  meetingId: Types.ObjectId;
  studentId: Types.ObjectId;
  source: MeetingFinalSource;
  strengths: string;
  concerns: string;
  authorUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MeetingFinalCommentSchema = new Schema<IMeetingFinalComment>(
  {
    meetingId: { type: Schema.Types.ObjectId, ref: "ParentMeeting", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    source: { type: String, enum: MEETING_FINAL_SOURCES, required: true },
    strengths: { type: String, default: "", trim: true },
    concerns: { type: String, default: "", trim: true },
    authorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

MeetingFinalCommentSchema.index({ meetingId: 1, studentId: 1 }, { unique: true });

export const MeetingFinalComment = model<IMeetingFinalComment>("MeetingFinalComment", MeetingFinalCommentSchema);
