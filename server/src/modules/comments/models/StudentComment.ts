/**
 * StudentComment — the daily, typed teacher observation log about a child (CM-1,
 * prd-comments-meetings §3, D-#114/#115). Replaces the Student-Complain Google
 * Form→Sheet (which had no permanent store, manual per-row WhatsApp, and #REF!
 * columns).
 *
 *   type ∈ COMMENT_TYPES        — the Form's M-column taxonomy (required).
 *   sentiment ∈ COMMENT_SENTIMENTS — CONCERN to act on / POSITIVE to share.
 *   text                        — the free-text body (subject-free, about the child).
 *   attachmentIds[]             — the field is present now; the upload route +
 *                                 delivery are CM-2 (this slice never populates it
 *                                 beyond a client-passed list).
 *   deliveredAt? / deliveryChannels[] — stamped by the CM-2 delivery flow; their
 *                                 presence makes the comment IMMUTABLE (a correction
 *                                 is a new comment, §3).
 *
 * Editable by the AUTHOR until `deliveredAt` is set, then immutable. PERMANENT —
 * never deleted (the CM-5 cross-meeting comparison timeline depends on full history).
 *
 * The author is the AUTHENTICATED teacher (`authorUserId`) — the Form's free-text
 * "ustaz" field is dropped (§3, D-#115). `sectionId` is the child's REAL section,
 * resolved server-side from the student, never client-supplied.
 *
 * Build ruling D-#145 convention: NO `schoolId` (single-school live repo — the CT/MT
 * precedent). Identity plane behind the ADR-005 firewall (names studentId) — no
 * corpus path.
 */
import { Schema, model, Document, Types } from "mongoose";
import { COMMENT_TYPES, COMMENT_SENTIMENTS } from "@scd/shared";
import type { CommentType, CommentSentiment } from "@scd/shared";

export interface IStudentComment extends Document {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  /** The child's REAL section, resolved server-side from the student (D-#115). */
  sectionId: Types.ObjectId;
  /** The authenticated teacher who recorded it. */
  authorUserId: Types.ObjectId;
  type: CommentType;
  sentiment: CommentSentiment;
  text: string;
  /** StoredFile ids — the upload route is CM-2 (field present now). */
  attachmentIds: Types.ObjectId[];
  /** Set by the CM-2 delivery flow; once set the comment is immutable (§3). */
  deliveredAt?: Date;
  /** Channels the CM-2 delivery actually used (wa.me / inbox / push). */
  deliveryChannels: string[];
  createdAt: Date;
  updatedAt: Date;
}

const StudentCommentSchema = new Schema<IStudentComment>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    authorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: COMMENT_TYPES, required: true },
    sentiment: { type: String, enum: COMMENT_SENTIMENTS, required: true },
    text: { type: String, required: true, trim: true },
    attachmentIds: { type: [Schema.Types.ObjectId], default: [] },
    deliveredAt: { type: Date },
    deliveryChannels: { type: [String], default: [] },
  },
  { timestamps: true },
);

// The child's timeline + the section worklist are the hot reads (newest first).
StudentCommentSchema.index({ studentId: 1, createdAt: -1 });
StudentCommentSchema.index({ sectionId: 1, createdAt: -1 });

export const StudentComment = model<IStudentComment>("StudentComment", StudentCommentSchema);
