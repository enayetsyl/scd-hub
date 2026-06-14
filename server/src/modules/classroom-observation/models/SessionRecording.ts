/**
 * SessionRecording — the YouTube-unlisted footage backing a ClassroomObservation
 * (CO-2, prd-classroom-observation §5). The observation is the system of record; a
 * recording carries the SAME session anchor as the observation it backs, plus the
 * `youtubeVideoId` the client returns after the (LATER app rider) Google-Identity-
 * Services upload. The server never uploads — it stores the id.
 *
 * Privacy is FIXED: `privacyStatus` is always "unlisted" (never a guardian/public
 * surface) — forced in the service, never trusted from a caller.
 *
 * Session anchor MIRRORS ClassroomObservation: `routineSlotId?`, EXACTLY ONE of
 * `sectionId?` / `subjectGroupId?` (validated upstream on the observation), `subject`,
 * the observed `teacherId`, `classDate` (YYYY-MM-DD), `periodNumber?`. The observation's
 * `recordingId` is the authoritative link back (a re-upload relinks it).
 *
 * Build ruling D-#145 convention: NO `schoolId` (single-school live repo). Identity/
 * operational plane (names teacherId/uploadedBy) — no corpus/student path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";

export interface ISessionRecording extends Document {
  _id: Types.ObjectId;
  // --- session anchor (mirrors ClassroomObservation) --------------------------
  routineSlotId?: Types.ObjectId | null;
  sectionId?: Types.ObjectId | null;
  subjectGroupId?: Types.ObjectId | null;
  subject: string;
  /** The OBSERVED teacher (same as the backing observation's teacherId). */
  teacherId: Types.ObjectId;
  classDate: string; // YYYY-MM-DD
  periodNumber?: number | null;
  // --- footage ----------------------------------------------------------------
  /** The YouTube video id the client returns after the unlisted upload (CO-2). */
  youtubeVideoId: string;
  /** ALWAYS "unlisted" — never trusted from a caller. */
  privacyStatus: string;
  /** Who linked the footage (Principal/Office). */
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
    privacyStatus: { type: String, required: true, default: "unlisted" },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

// The observed teacher's footage timeline is the hot read.
SessionRecordingSchema.index({ teacherId: 1, classDate: -1 });

export const SessionRecording = model<ISessionRecording>(
  "SessionRecording",
  SessionRecordingSchema,
);
