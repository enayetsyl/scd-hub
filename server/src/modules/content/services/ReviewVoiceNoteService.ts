/**
 * ReviewVoiceNoteService — voice notes on a review round (VN-1, D-#1658).
 *
 * A reviewer records short clips (up to 90 s each, up to 10 per round) instead of typing; each may
 * carry a "spot" tag. AUDIO is the source of truth (an automatic transcript follows, VN-T1, D-#1662). Clips are saved the moment they are recorded,
 * as DRAFTS, so an app restart or dropped connection before Submit loses nothing; submitting the
 * verdict makes them part of the review.
 *
 *   addReviewVoiceNote     — the assigned reviewer, round still open: upload + save a draft clip.
 *   deleteReviewVoiceNote  — the assigned reviewer, round still open: remove one clip.
 *   listReviewVoiceNotes   — reviewer: all clips; plan author / review managers: submitted only.
 *   attachDraftVoiceNotes  — called by submitPlanReview: drafts become part of the review.
 *   assertReviewVoiceFileReadAccess — the GET /files/:id gate for kind `review_voice_note`:
 *                            exactly the reviewer, the plan author, and the review managers.
 *
 * Reuse: `docType` rides on each clip, so question reviews (VN-2) can call the same functions and
 * only choose their own manager permission via `managerPermissionFor`.
 */
import { Types } from "mongoose";
import { callerHasPermission } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { ReviewAssignment } from "../models/ReviewAssignment";
import { ReviewVoiceNote, type IReviewVoiceNote } from "../models/ReviewVoiceNote";
import { ContentArtifact } from "../models/ContentArtifact";
import { StoredFile } from "../../platform/models/StoredFile";
import { uploadToDrive, deleteFromDrive, DriveUnavailableError } from "../../platform/services/DriveStore";
import { ReviewError, isPlanDocType } from "./ReviewService";

// ---------------------------------------------------------------------------
// Limits + pure helpers (DB-free; unit-tested directly)
// ---------------------------------------------------------------------------

export const MAX_VOICE_NOTES_PER_ROUND = 10;
/** The recorder's own cap (voiceRecorder MAX_RECORD_SECONDS) with a little rounding slack. */
export const MAX_VOICE_NOTE_SECONDS = 90;
const SECONDS_SLACK = 1;
/** 90 s of 16 kHz mono 16-bit WAV is about 2.9 MB; AAC is far smaller. */
export const MAX_VOICE_NOTE_BYTES = 4 * 1024 * 1024;
export const MAX_SPOT_LENGTH = 80;

export const VOICE_NOTE_ERRORS_BN = {
  forbidden: "অনুমতি নেই",
  notFound: "ভয়েস নোটটি পাওয়া যায়নি",
  badAudio: "এই ধরনের রেকর্ডিং রাখা যায় না",
  tooLarge: "রেকর্ডিংটি অনেক বড়",
  tooLong: "একটি রেকর্ডিং সর্বোচ্চ ৯০ সেকেন্ডের হতে পারে",
  empty: "রেকর্ডিংটি খালি",
  tooMany: "একটি রিভিউতে সর্বোচ্চ ১০টি ভয়েস নোট রাখা যায়",
  closed: "এই রিভিউ রাউন্ডটি বন্ধ হয়ে গেছে",
  sentLocked: "জমা দেওয়া ভয়েস নোট মোছা যায় না",
  notPlan: "এই রাউন্ডে এখনো ভয়েস নোট দেওয়া যায় না",
  driveDown: "এই মুহূর্তে রেকর্ডিং সংরক্ষণ করা যাচ্ছে না — পরে আবার চেষ্টা করুন",
} as const;

const AUDIO_EXT: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/aac": "aac",
};

/** `audio/wav;codecs=1` becomes `audio/wav`; null when the type is not one the recorder produces. */
export function normaliseAudioMime(mime: string | null | undefined): string | null {
  const base = (mime ?? "").split(";")[0].trim().toLowerCase();
  return base in AUDIO_EXT ? base : null;
}

/** A spot tag: trimmed, whitespace collapsed, at most 80 chars; blank becomes null. */
export function cleanSpot(spot: string | null | undefined): string | null {
  const t = (spot ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t.slice(0, MAX_SPOT_LENGTH);
}

/** The most base64 text a clip of MAX_VOICE_NOTE_BYTES can take (plus padding slack) — checked BEFORE decoding. */
export const MAX_VOICE_NOTE_BASE64_CHARS = Math.ceil(MAX_VOICE_NOTE_BYTES / 3) * 4 + 8;

/** Does the first bytes look like the format the type claims? WAV: "RIFF....WAVE"; AAC (ADTS): 12-bit 0xFFF sync. */
export function hasAudioHeader(mime: string | null | undefined, head: Buffer): boolean {
  const base = normaliseAudioMime(mime);
  if (base === "audio/wav" || base === "audio/x-wav") {
    return head.length >= 12 && head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WAVE";
  }
  if (base === "audio/aac") return head.length >= 2 && head[0] === 0xff && (head[1] & 0xf0) === 0xf0;
  return false;
}

/** Validate one clip's audio — null when OK, else the Bangla rejection. */
export function validateVoiceNoteAudio(
  mime: string | null | undefined,
  bytes: number,
  seconds: number,
  head?: Buffer,
): string | null {
  if (!normaliseAudioMime(mime)) return VOICE_NOTE_ERRORS_BN.badAudio;
  if (head && bytes > 0 && !hasAudioHeader(mime, head)) return VOICE_NOTE_ERRORS_BN.badAudio;
  if (!(bytes > 0) || !Number.isFinite(seconds) || seconds <= 0) return VOICE_NOTE_ERRORS_BN.empty;
  if (bytes > MAX_VOICE_NOTE_BYTES) return VOICE_NOTE_ERRORS_BN.tooLarge;
  if (seconds > MAX_VOICE_NOTE_SECONDS + SECONDS_SLACK) return VOICE_NOTE_ERRORS_BN.tooLong;
  return null;
}

/** The permission that lets a person read EVERY submitted clip of a round of this doc-type. */
export function managerPermissionFor(docType: string): "plan_review:assign" | "question_review:assign" {
  return docType === "question" ? "question_review:assign" : "plan_review:assign";
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export interface ReviewVoiceNoteDTO {
  id: string;
  assignmentId: string;
  /** The StoredFile id — played through GET /files/:id. */
  fileId: string;
  mime: string;
  seconds: number;
  spot: string | null;
  /** True once the review was submitted; false = a private draft. */
  submitted: boolean;
  /** VN-T1: the automatic transcript — only ever set once DONE; null otherwise. Same row-scope as the clip. */
  transcript: string | null;
  /** PENDING | DONE | FAILED | QUOTA | NO_KEY | OFF; null before the clip is sent. */
  transcriptStatus: string | null;
  createdAt: string;
}

export function toVoiceNoteDTO(d: IReviewVoiceNote): ReviewVoiceNoteDTO {
  return {
    id: d._id.toString(),
    assignmentId: d.assignmentId.toString(),
    fileId: d.fileId.toString(),
    mime: d.mime ?? "audio/wav",
    seconds: d.seconds,
    spot: d.spot ?? null,
    submitted: !!d.submitted,
    transcript: d.transcriptStatus === "DONE" ? d.transcript ?? "" : null,
    transcriptStatus: d.transcriptStatus ?? null,
    createdAt: (d.createdAt ?? new Date()).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Add / delete (the assigned reviewer)
// ---------------------------------------------------------------------------

export interface AddVoiceNoteInput {
  assignmentId: string;
  reviewerId: string;
  audioBase64: string;
  mimeType: string;
  seconds: number;
  spot?: string | null;
}

async function loadOwnOpenRound(assignmentId: string, reviewerId: string) {
  const round = await ReviewAssignment.findById(assignmentId);
  if (!round) throw new ReviewError("Review assignment not found");
  if (round.reviewerId.toString() !== reviewerId) throw new ReviewError("FORBIDDEN: not the assigned reviewer");
  // Same openness rule as submitPlanReview: assigned, or submitted-but-editable.
  if (round.status !== "assigned" && round.status !== "submitted") throw new ReviewError(VOICE_NOTE_ERRORS_BN.closed);
  return round;
}

export async function addReviewVoiceNote(input: AddVoiceNoteInput): Promise<ReviewVoiceNoteDTO> {
  const mime = normaliseAudioMime(input.mimeType);
  // Size first, on the TEXT: a huge string must never be decoded just to be refused.
  if ((input.audioBase64 ?? "").length > MAX_VOICE_NOTE_BASE64_CHARS) throw new ReviewError(VOICE_NOTE_ERRORS_BN.tooLarge);
  const data = Buffer.from(input.audioBase64 ?? "", "base64");
  const bad = validateVoiceNoteAudio(input.mimeType, data.byteLength, input.seconds, data.subarray(0, 12));
  if (bad || !mime) throw new ReviewError(bad ?? VOICE_NOTE_ERRORS_BN.badAudio);

  const round = await loadOwnOpenRound(input.assignmentId, input.reviewerId);
  // Plans only until VN-2 (question rounds have their own gate and screens).
  if (!isPlanDocType(round.docType)) throw new ReviewError(VOICE_NOTE_ERRORS_BN.notPlan);
  const have = await ReviewVoiceNote.countDocuments({ assignmentId: round._id });
  if (have >= MAX_VOICE_NOTES_PER_ROUND) throw new ReviewError(VOICE_NOTE_ERRORS_BN.tooMany);

  const seconds = Math.round(Math.min(input.seconds, MAX_VOICE_NOTE_SECONDS) * 10) / 10;
  const ext = AUDIO_EXT[mime];
  let driveFileId: string;
  try {
    // Drive FIRST — only a successful upload persists metadata (the GP-J8 posture).
    driveFileId = await uploadToDrive({
      name: `${Date.now()}_review-voice.${ext}`,
      mime,
      data,
      year: String(new Date().getFullYear()),
      subfolder: "review-voice",
    });
  } catch (e) {
    if (e instanceof DriveUnavailableError) throw new ReviewError(VOICE_NOTE_ERRORS_BN.driveDown);
    throw e;
  }
  const stored = await StoredFile.create({
    kind: "review_voice_note",
    mime,
    sizeBytes: data.byteLength,
    originalName: `review-voice.${ext}`,
    driveFileId,
    uploadedBy: new Types.ObjectId(input.reviewerId),
  });
  const note = await ReviewVoiceNote.create({
    assignmentId: round._id,
    artifactId: round.artifactId,
    reviewerId: round.reviewerId,
    docType: round.docType,
    fileId: stored._id,
    mime,
    seconds,
    spot: cleanSpot(input.spot) ?? undefined,
    submitted: false,
  });
  // Atomic cap: the early count above is only a fast refusal — two clips racing past it are both
  // inserted, so rank THIS clip among the round's rows (by id) and roll it back if it is over the cap.
  const rank = await ReviewVoiceNote.countDocuments({ assignmentId: round._id, _id: { $lte: note._id } });
  if (rank > MAX_VOICE_NOTES_PER_ROUND) {
    await ReviewVoiceNote.deleteOne({ _id: note._id });
    await StoredFile.deleteOne({ _id: stored._id });
    await deleteFromDrive(driveFileId).catch(() => undefined);
    throw new ReviewError(VOICE_NOTE_ERRORS_BN.tooMany);
  }
  return toVoiceNoteDTO(note);
}

export async function deleteReviewVoiceNote(input: { noteId: string; reviewerId: string }): Promise<boolean> {
  const note = await ReviewVoiceNote.findById(input.noteId);
  if (!note) throw new ReviewError(VOICE_NOTE_ERRORS_BN.notFound);
  if (note.reviewerId.toString() !== input.reviewerId) throw new ReviewError("FORBIDDEN: not your voice note");
  await loadOwnOpenRound(note.assignmentId.toString(), input.reviewerId);
  // A SENT clip is part of the submitted review — deleting it could leave a CHANGES_REQUESTED round
  // with no feedback. Only drafts can be removed.
  if (note.submitted) throw new ReviewError(VOICE_NOTE_ERRORS_BN.sentLocked);

  const stored = (await StoredFile.findById(note.fileId).lean()) as unknown as { driveFileId?: string } | null;
  await ReviewVoiceNote.deleteOne({ _id: note._id });
  await StoredFile.deleteOne({ _id: note.fileId });
  // Best-effort: a Drive hiccup must not leave the clip undeletable from the reviewer's side.
  if (stored?.driveFileId) await deleteFromDrive(stored.driveFileId).catch(() => undefined);
  return true;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface VoiceViewer {
  userId: string;
  /** May this person read every SUBMITTED clip of a round of this doc-type (the review managers)? */
  managerFor: (docType: string) => boolean;
}

/** Is `userId` the author (importer) of the artifact the round reviews? */
async function isPlanAuthor(artifactId: Types.ObjectId | string, userId: string): Promise<boolean> {
  const art = (await ContentArtifact.findById(artifactId).select({ importedBy: 1 }).lean()) as unknown as {
    importedBy?: { toString(): string };
  } | null;
  return !!art?.importedBy && art.importedBy.toString() === userId;
}

/**
 * A round's clips, oldest first. The reviewer sees all of theirs (drafts included); the plan author
 * and the review managers see the SUBMITTED ones; anyone else gets an empty list (a caller who may
 * not read the thread never reaches here — the thread resolver gates first).
 */
export async function listReviewVoiceNotes(assignmentId: string, viewer: VoiceViewer): Promise<ReviewVoiceNoteDTO[]> {
  const round = (await ReviewAssignment.findById(assignmentId).lean()) as unknown as {
    reviewerId: { toString(): string };
    artifactId: Types.ObjectId;
    docType: string;
  } | null;
  if (!round) return [];
  const isReviewer = round.reviewerId.toString() === viewer.userId;
  if (!isReviewer && !viewer.managerFor(round.docType) && !(await isPlanAuthor(round.artifactId, viewer.userId))) return [];
  const filter: Record<string, unknown> = { assignmentId: new Types.ObjectId(assignmentId) };
  if (!isReviewer) filter.submitted = true;
  const docs = (await ReviewVoiceNote.find(filter).sort({ createdAt: 1 }).lean()) as unknown as IReviewVoiceNote[];
  return docs.map(toVoiceNoteDTO);
}

/** How many clips (draft or sent) the reviewer holds on a round — submit counts voice as feedback. */
export async function countReviewVoiceNotes(assignmentId: string, reviewerId: string): Promise<number> {
  return ReviewVoiceNote.countDocuments({
    assignmentId: new Types.ObjectId(assignmentId),
    reviewerId: new Types.ObjectId(reviewerId),
  });
}

// ---------------------------------------------------------------------------
// Submit hook + file gate
// ---------------------------------------------------------------------------

/** On submit: every draft clip of the round becomes part of the review. Returns how many flipped. */
export async function attachDraftVoiceNotes(assignmentId: string, reviewerId: string): Promise<number> {
  const res = await ReviewVoiceNote.updateMany(
    { assignmentId: new Types.ObjectId(assignmentId), reviewerId: new Types.ObjectId(reviewerId), submitted: false },
    { $set: { submitted: true } },
  );
  return res.modifiedCount ?? 0;
}

/**
 * GET /files/:id gate for `review_voice_note`. Exactly: the reviewer who recorded it (draft or
 * sent), and — once the review is submitted — the plan author and the review managers. A file with
 * no clip row (orphan) is refused.
 */
export async function assertReviewVoiceFileReadAccess(ctx: AppContext, fileId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const note = (await ReviewVoiceNote.findOne({ fileId: new Types.ObjectId(fileId) }).lean()) as unknown as
    | IReviewVoiceNote
    | null;
  if (!note) throw new ForbiddenError(VOICE_NOTE_ERRORS_BN.forbidden);
  if (note.reviewerId.toString() === ctx.auth.userId) return;
  if (!note.submitted) throw new ForbiddenError(VOICE_NOTE_ERRORS_BN.forbidden);
  if (callerHasPermission(ctx.auth, managerPermissionFor(note.docType))) return;
  if (await isPlanAuthor(note.artifactId, ctx.auth.userId)) return;
  throw new ForbiddenError(VOICE_NOTE_ERRORS_BN.forbidden);
}
