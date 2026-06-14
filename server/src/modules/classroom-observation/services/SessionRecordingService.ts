/**
 * SessionRecordingService (CO-2, prd-classroom-observation §CO-2, D-#149) — persist
 * the YouTube-unlisted footage of a session + the row read.
 *
 *   recordSessionRecording — Principal/Office persist a client-uploaded video
 *                            (youtubeVideoId) against a session anchor. The video
 *                            already lives on YouTube as "unlisted" (client-side
 *                            GIS upload); the server stores ONLY the id + anchor —
 *                            never a Google secret. Audited (SESSION_RECORDING_LINKED).
 *   getSessionRecording    — one recording by id (the resolver gates who may read it:
 *                            Principal/Office directly, or anyone who can read a linked
 *                            observation via the nested `recording` field).
 *   parseYoutubeVideoId    — the PURE id extractor/validator (an 11-char id, or a
 *                            pasted YouTube URL containing one). No DB/clock.
 *
 * RBAC (observation:upload) is enforced by the RESOLVER. Identity/operational plane
 * (names teacherId/uploadedBy); NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import {
  SessionRecording,
  type ISessionRecording,
  type RecordingPrivacyStatus,
} from "../models/SessionRecording";
import { writeAudit } from "../../platform/services/AuditService";

export class SessionRecordingError extends Error {}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export interface SessionRecordingShape {
  id: string;
  routineSlotId: string | null;
  sectionId: string | null;
  subjectGroupId: string | null;
  subject: string;
  teacherId: string;
  classDate: string;
  periodNumber: number | null;
  youtubeVideoId: string;
  privacyStatus: RecordingPrivacyStatus;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
}

function shape(d: ISessionRecording): SessionRecordingShape {
  return {
    id: d._id.toString(),
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
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function oid(id: string, label: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw new SessionRecordingError(`Invalid ${label}`);
  return new Types.ObjectId(id);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A YouTube video id is exactly 11 chars from [A-Za-z0-9_-]. */
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YT_URL_PATTERNS = [
  /[?&]v=([A-Za-z0-9_-]{11})/,      // watch?v=ID
  /youtu\.be\/([A-Za-z0-9_-]{11})/,  // youtu.be/ID
  /\/embed\/([A-Za-z0-9_-]{11})/,    // /embed/ID
  /\/shorts\/([A-Za-z0-9_-]{11})/,   // /shorts/ID
];

/**
 * PURE: accept the client's youtubeVideoId — either the bare 11-char id (what the
 * Data API returns) or a pasted YouTube URL containing one — and return the id.
 * Throws on anything else (so a typo'd/empty id never lands as a dead recording).
 */
export function parseYoutubeVideoId(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) throw new SessionRecordingError("youtubeVideoId is required");
  if (YT_ID_RE.test(s)) return s;
  for (const p of YT_URL_PATTERNS) {
    const m = s.match(p);
    if (m) return m[1];
  }
  throw new SessionRecordingError(
    "youtubeVideoId must be an 11-character YouTube id (or a YouTube URL containing one)",
  );
}

/**
 * The session anchor: EXACTLY ONE of sectionId / subjectGroupId, a non-empty subject,
 * a valid teacherId, and a YYYY-MM-DD classDate. Form-agnostic (a recording carries no
 * REF-11 vs Quran form — the HW_SUBJECTS check belongs to the observation, not here).
 */
function assertAnchor(input: {
  subject: string;
  sectionId?: string | null;
  subjectGroupId?: string | null;
}): { sectionId: Types.ObjectId | null; subjectGroupId: Types.ObjectId | null; subject: string } {
  const hasSection = !!input.sectionId;
  const hasGroup = !!input.subjectGroupId;
  if (hasSection === hasGroup) {
    throw new SessionRecordingError(
      "Provide exactly one of sectionId or subjectGroupId (the session anchor)",
    );
  }
  const subject = (input.subject ?? "").trim();
  if (!subject) throw new SessionRecordingError("subject is required");
  return {
    sectionId: hasSection ? oid(input.sectionId as string, "sectionId") : null,
    subjectGroupId: hasGroup ? oid(input.subjectGroupId as string, "subjectGroupId") : null,
    subject,
  };
}

// ---------------------------------------------------------------------------
// recordSessionRecording (Principal/Office persist a client-uploaded video)
// ---------------------------------------------------------------------------

export interface RecordSessionRecordingInput {
  subject: string;
  teacherId: string;
  classDate: string;
  youtubeVideoId: string;
  sectionId?: string | null;
  subjectGroupId?: string | null;
  routineSlotId?: string | null;
  periodNumber?: number | null;
  /** The authenticated uploader (Principal/Office). */
  actorId: string;
}

export async function recordSessionRecording(
  input: RecordSessionRecordingInput,
): Promise<SessionRecordingShape> {
  const youtubeVideoId = parseYoutubeVideoId(input.youtubeVideoId);
  if (!DATE_RE.test(input.classDate ?? "")) {
    throw new SessionRecordingError("classDate must be YYYY-MM-DD");
  }
  const teacherId = oid(input.teacherId, "teacherId");
  const anchor = assertAnchor({
    subject: input.subject,
    sectionId: input.sectionId,
    subjectGroupId: input.subjectGroupId,
  });

  const doc = await SessionRecording.create({
    subject: anchor.subject,
    teacherId,
    classDate: input.classDate,
    sectionId: anchor.sectionId,
    subjectGroupId: anchor.subjectGroupId,
    routineSlotId: input.routineSlotId ? oid(input.routineSlotId, "routineSlotId") : null,
    periodNumber: input.periodNumber ?? null,
    youtubeVideoId,
    privacyStatus: "unlisted",
    uploadedBy: oid(input.actorId, "actorId"),
  });

  await writeAudit({
    eventKind: "SESSION_RECORDING_LINKED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "SessionRecording",
    meta: { youtubeVideoId, teacherId: input.teacherId, classDate: input.classDate },
  });

  return shape(doc);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getSessionRecording(recordingId: string): Promise<SessionRecordingShape | null> {
  if (!Types.ObjectId.isValid(recordingId)) throw new SessionRecordingError("Invalid recording id");
  const doc = (await SessionRecording.findById(recordingId).lean()) as ISessionRecording | null;
  return doc ? shape(doc) : null;
}
