/**
 * ReviewVoiceNote — one recorded clip on a review round (VN-1, D-#1658).
 *
 * A reviewer can speak a comment instead of typing it: several clips per round, each with an
 * optional "spot" tag (a step / section of the plan, e.g. Hook, Exit-check). AUDIO is the source of truth; an
 * automatic transcript is added after sending (VN-T1, D-#1662). The bytes are a StoredFile (kind `review_voice_note`, Drive
 * backed); this row is the clip's handle and carries its length and spot.
 *
 * Draft vs sent: a clip is a DRAFT (`submitted: false`) from the moment it is recorded — kept
 * server-side so an app restart or a dropped connection loses nothing — and becomes part of the
 * review when the reviewer submits the verdict (`submitted: true`). A draft is visible to its
 * reviewer only; a submitted clip also to the plan author and the review managers.
 *
 * `docType` is stored so the same row serves question reviews later (VN-2); the read gate picks the
 * manager permission from it.
 *
 * Identity plane (a teacher's voice): behind the ADR-005 firewall, never imported by the corpus.
 */
import { Schema, model, Document, Types } from "mongoose";

export const TRANSCRIPT_STATUSES = ["PENDING", "DONE", "FAILED", "QUOTA", "NO_KEY", "OFF"] as const;
export type TranscriptStatus = (typeof TRANSCRIPT_STATUSES)[number];

export interface IReviewVoiceNote extends Document {
  _id: Types.ObjectId;
  assignmentId: Types.ObjectId;
  artifactId: Types.ObjectId;
  reviewerId: Types.ObjectId;
  docType: string;
  /** The StoredFile holding the audio. */
  fileId: Types.ObjectId;
  /** audio/wav (web) or audio/aac (Android) — tells the player which file type to cache. */
  mime: string;
  /** Length in seconds (≤ 90). */
  seconds: number;
  /** Optional spot tag (a plan step / section label), ≤ 80 chars. */
  spot?: string;
  /** False while a draft; true once the reviewer has submitted the verdict. */
  submitted: boolean;
  /** VN-T1 (D-#1662): the automatic transcript. Absent until the clip is sent. Audio stays the source of truth. */
  transcript?: string;
  transcriptStatus?: TranscriptStatus;
  transcriptModel?: string;
  transcribedAt?: Date;
  /** Attempts made so far (max 3) and when the last one started — drive the retry sweep. */
  transcriptTries?: number;
  transcriptAttemptAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewVoiceNoteSchema = new Schema<IReviewVoiceNote>(
  {
    assignmentId: { type: Schema.Types.ObjectId, ref: "ReviewAssignment", required: true },
    artifactId: { type: Schema.Types.ObjectId, ref: "ContentArtifact", required: true },
    reviewerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    docType: { type: String, required: true },
    fileId: { type: Schema.Types.ObjectId, ref: "StoredFile", required: true },
    mime: { type: String, required: true },
    seconds: { type: Number, required: true, min: 0 },
    spot: { type: String },
    submitted: { type: Boolean, required: true, default: false },
    transcript: { type: String },
    transcriptStatus: { type: String, enum: TRANSCRIPT_STATUSES },
    transcriptModel: { type: String },
    transcribedAt: { type: Date },
    transcriptTries: { type: Number, min: 0 },
    transcriptAttemptAt: { type: Date },
  },
  { timestamps: true },
);

// A round's clips, oldest first (the list, the count cap, the submit flip).
ReviewVoiceNoteSchema.index({ assignmentId: 1, createdAt: 1 });
// Retry sweep (VN-T1): clips still waiting for a transcript.
ReviewVoiceNoteSchema.index({ transcriptStatus: 1, transcriptAttemptAt: 1 });
// File-gate lookup: which clip owns this StoredFile.
ReviewVoiceNoteSchema.index({ fileId: 1 }, { unique: true });

export const ReviewVoiceNote = model<IReviewVoiceNote>("ReviewVoiceNote", ReviewVoiceNoteSchema);
