/**
 * SessionRecordingService (CO-2, prd-classroom-observation §5) — store the YouTube-
 * unlisted footage that backs a ClassroomObservation and link it back.
 *
 *   recordSessionFootage    — Principal/Office attach the `youtubeVideoId` the client
 *                             returned (the actual upload is a LATER app rider). Loads
 *                             the backing observation, copies its session anchor onto a
 *                             new SessionRecording, FORCES privacyStatus "unlisted", sets
 *                             the observation's `recordingId` (a re-upload relinks — the
 *                             prior id is captured for the audit). Audited.
 *   recordingForObservation — the linked recording (resolved via observation.recordingId,
 *                             the authoritative link) or null.
 *
 * Role RBAC (observation:upload / :read) is enforced by the RESOLVER; this service
 * trusts the actor + validates the footage id.
 *
 * Identity/operational plane (names teacherId/uploadedBy); NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { ClassroomObservation, type IClassroomObservation } from "../models/ClassroomObservation";
import { SessionRecording, type ISessionRecording } from "../models/SessionRecording";
import { ClassroomObservationError } from "./ClassroomObservationService";
import { writeAudit } from "../../platform/services/AuditService";

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export interface SessionRecordingShape {
  id: string;
  /** The backing observation this footage is linked from (recordingId). */
  observationId: string | null;
  routineSlotId: string | null;
  sectionId: string | null;
  subjectGroupId: string | null;
  subject: string;
  teacherId: string;
  classDate: string;
  periodNumber: number | null;
  youtubeVideoId: string;
  privacyStatus: string;
  uploadedBy: string;
  createdAt: string;
}

function toShape(d: ISessionRecording, observationId?: string | null): SessionRecordingShape {
  return {
    id: d._id.toString(),
    observationId: observationId ?? null,
    routineSlotId: d.routineSlotId ? d.routineSlotId.toString() : null,
    sectionId: d.sectionId ? d.sectionId.toString() : null,
    subjectGroupId: d.subjectGroupId ? d.subjectGroupId.toString() : null,
    subject: d.subject,
    teacherId: d.teacherId.toString(),
    classDate: d.classDate,
    periodNumber: d.periodNumber ?? null,
    youtubeVideoId: d.youtubeVideoId,
    privacyStatus: d.privacyStatus,
    uploadedBy: d.uploadedBy.toString(),
    createdAt: new Date(d.createdAt).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// recordSessionFootage — link the client-returned footage to an observation
// ---------------------------------------------------------------------------

export interface RecordSessionFootageInput {
  /** The backing observation. */
  observationId: string;
  /** The YouTube video id the client returned after the unlisted upload. */
  youtubeVideoId: string;
  /** The authenticated uploader (Principal/Office). */
  actorId: string;
  actorRole?: string;
}

export async function recordSessionFootage(
  input: RecordSessionFootageInput,
): Promise<SessionRecordingShape> {
  if (!Types.ObjectId.isValid(input.observationId)) {
    throw new ClassroomObservationError("Invalid observation id");
  }
  const youtubeVideoId = (input.youtubeVideoId ?? "").trim();
  if (!youtubeVideoId) {
    throw new ClassroomObservationError("একটি YouTube ভিডিও আইডি প্রয়োজন");
  }

  const obs = (await ClassroomObservation.findById(input.observationId)) as IClassroomObservation | null;
  if (!obs) throw new ClassroomObservationError("পর্যবেক্ষণটি পাওয়া যায়নি");

  // Copy the observation's session anchor; privacyStatus is ALWAYS forced "unlisted".
  const recording = await SessionRecording.create({
    routineSlotId: obs.routineSlotId ?? null,
    sectionId: obs.sectionId ?? null,
    subjectGroupId: obs.subjectGroupId ?? null,
    subject: obs.subject,
    teacherId: obs.teacherId,
    classDate: obs.classDate,
    periodNumber: obs.periodNumber ?? null,
    youtubeVideoId,
    privacyStatus: "unlisted",
    uploadedBy: new Types.ObjectId(input.actorId),
  });

  // Relink the observation (a re-upload replaces the prior recording link).
  const priorRecordingId = obs.recordingId ? obs.recordingId.toString() : null;
  obs.recordingId = recording._id;
  await obs.save();

  await writeAudit({
    eventKind: "SESSION_RECORDING_ADDED",
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetId: obs._id,
    targetKind: "ClassroomObservation",
    meta: {
      prior: { recordingId: priorRecordingId },
      next: { recordingId: recording._id.toString(), youtubeVideoId },
    },
  });

  return toShape(recording, obs._id.toString());
}

// ---------------------------------------------------------------------------
// recordingForObservation — the linked recording (via observation.recordingId)
// ---------------------------------------------------------------------------

export async function recordingForObservation(
  observationId: string,
): Promise<SessionRecordingShape | null> {
  if (!Types.ObjectId.isValid(observationId)) {
    throw new ClassroomObservationError("Invalid observation id");
  }
  const obs = (await ClassroomObservation.findById(observationId).lean()) as IClassroomObservation | null;
  if (!obs || !obs.recordingId) return null;
  const doc = (await SessionRecording.findById(obs.recordingId).lean()) as ISessionRecording | null;
  return doc ? toShape(doc, obs._id.toString()) : null;
}
