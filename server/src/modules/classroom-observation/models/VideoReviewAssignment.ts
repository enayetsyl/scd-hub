/**
 * VideoReviewAssignment — a class-session video (uploaded to YouTube by the
 * office, the server stores only the LINK) assigned to a teacher for a simple
 * self-review: ঠিক আছে (OK) or সমস্যা আছে (NOT_OK + a mandatory comment).
 *
 * Deliberately lighter than ClassroomObservation (no REF-11 forms/domains):
 * the session context is free-form display text (timeLabel/classLabel/room)
 * plus the date, so the office can log a video in seconds. Statuses are
 * module-local (the HW_NIL_REASONS precedent) — no shared-vocab twin.
 *
 * RBAC rides the EXISTING observation permissions (no new permission):
 * create/overview = observation:upload / observation:manage (Principal+Office);
 * the teacher's list + verdict = observation:review, row-gated to teacherId.
 * Staff-internal; identity plane — no corpus/student path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";

export const VIDEO_REVIEW_STATUSES = ["PENDING", "OK", "NOT_OK"] as const;
export type VideoReviewStatus = (typeof VIDEO_REVIEW_STATUSES)[number];

export interface IVideoReviewAssignment extends Document {
  _id: Types.ObjectId;
  /** Full YouTube link the office pasted (watch/short/youtu.be — validated in the service). */
  youtubeUrl: string;
  /** Session context — date is real (YYYY-MM-DD); the rest is display text. */
  classDate: string;
  timeLabel: string;
  classLabel: string;
  room: string;
  /** The teacher who must watch and give the verdict. */
  teacherId: Types.ObjectId;
  status: VideoReviewStatus;
  /** Mandatory when NOT_OK; null otherwise. */
  comment?: string | null;
  reviewedAt?: Date | null;
  assignedBy: Types.ObjectId;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const VideoReviewAssignmentSchema = new Schema<IVideoReviewAssignment>(
  {
    youtubeUrl: { type: String, required: true, trim: true },
    classDate: { type: String, required: true },
    timeLabel: { type: String, required: true, trim: true },
    classLabel: { type: String, required: true, trim: true },
    room: { type: String, required: true, trim: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, required: true, enum: VIDEO_REVIEW_STATUSES, default: "PENDING" },
    comment: { type: String, default: null, trim: true },
    reviewedAt: { type: Date, default: null },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

// The teacher's pending worklist and the office's status board are the hot reads.
VideoReviewAssignmentSchema.index({ teacherId: 1, status: 1, classDate: -1 });

export const VideoReviewAssignment = model<IVideoReviewAssignment>(
  "VideoReviewAssignment",
  VideoReviewAssignmentSchema,
);
