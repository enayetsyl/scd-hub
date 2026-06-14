/**
 * SessionRecording — CO-2 footage (prd-classroom-observation §CO-2, D-#149).
 *
 * One YouTube-unlisted recording of a single taught session, linked to a session
 * anchor. `ClassroomObservation.recordingId` points here; ≥1 observation may
 * reference one recording (CO-7 calibration double-reviews → the unique-per-video
 * constraint keeps one recording per uploaded video).
 *
 * Upload is CLIENT-SIDE (web Google Identity Services + YouTube Data API v3,
 * `privacyStatus: "unlisted"`, `selfDeclaredMadeForKids: false`). The server only
 * persists the resulting `youtubeVideoId` + the anchor — NO Google secret ever
 * reaches the server or any committed file (§CO-2 acceptance: "no secret in any
 * committed file/`/docs`"). Watching needs only the id (unlisted = link-viewable,
 * no auth) so playback works on web AND native.
 *
 * `privacyStatus` is a model-local literal union — VOCAB-FREE (no shared enum); the
 * only value today is "unlisted". Identity/operational plane (names teacherId/
 * uploadedBy) — NO corpus path (ADR-005). NO schoolId (D-#145, single-school).
 */
import { Schema, model, Document, Types } from "mongoose";

/** The only privacy status today — a knowing trade-off (D-#149). Model-local, not vocab. */
export const RECORDING_PRIVACY_STATUSES = ["unlisted"] as const;
export type RecordingPrivacyStatus = (typeof RECORDING_PRIVACY_STATUSES)[number];

export interface ISessionRecording extends Document {
  _id: Types.ObjectId;
  // --- session anchor (mirrors the observation anchor; footage of one session) ---
  routineSlotId?: Types.ObjectId | null;
  /** EXACTLY ONE of sectionId / subjectGroupId is set (validated in the service). */
  sectionId?: Types.ObjectId | null;
  subjectGroupId?: Types.ObjectId | null;
  subject: string;
  /** The OBSERVED teacher who was recorded. */
  teacherId: Types.ObjectId;
  classDate: string; // YYYY-MM-DD
  periodNumber?: number | null;
  // --- footage -----------------------------------------------------------------
  youtubeVideoId: string;
  privacyStatus: RecordingPrivacyStatus;
  /** Who uploaded the footage (Principal/Office, observation:upload). */
  uploadedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SessionRecordingSchema = new Schema<ISessionRecording>(
  {
    routineSlotId: { type: Schema.Types.ObjectId, ref: "RoutineSlot", default: null },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", default: null },
    subjectGroupId: { type: Schema.Types.ObjectId, ref: "SubjectGroup", default: null },
    subject: { type: String, required: true, trim: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    classDate: { type: String, required: true },
    periodNumber: { type: Number, default: null },
    youtubeVideoId: { type: String, required: true, trim: true },
    privacyStatus: {
      type: String,
      enum: RECORDING_PRIVACY_STATUSES,
      required: true,
      default: "unlisted",
    },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

// One recording per uploaded video; the observed teacher's footage timeline.
SessionRecordingSchema.index({ youtubeVideoId: 1 }, { unique: true });
SessionRecordingSchema.index({ teacherId: 1, classDate: -1 });

export const SessionRecording = model<ISessionRecording>("SessionRecording", SessionRecordingSchema);
