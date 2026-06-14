/**
 * MeetingCommentService (CM-5, prd-comments-meetings §3/§6, D-#124) — the class-teacher
 * meeting note + the comparison reads + the guardian portal reads. NO new vocab/perm.
 *
 *   saveMeetingComment   — upsert ONE Positive+Concern note per (student × meeting); the
 *                          author is the authenticated class teacher (the RESOLVER runs
 *                          `assertIsClassTeacher` on the child's server-resolved section,
 *                          J-CM6); audited MEETING_COMMENT_SAVED.
 *   studentCommentTimeline — DERIVED (D-#44): a child's prior MeetingComments chronological
 *                          + a daily-StudentComment by-type rollup since the most recent
 *                          meeting (D-#202).
 *   meetingComparison    — for a specific meeting: this note + prior notes + the by-type
 *                          rollup of daily comments between the previous meeting and this one.
 *   childComments        — GUARDIAN read: the child's DELIVERED daily comments only, in a
 *                          shape that STRUCTURALLY omits every staff-only field (J-CM8).
 *   childMeetingSlot     — GUARDIAN read: the family's own slot for a meeting (no staff note).
 *
 * Reads are gated by the RESOLVER (`tracker:read` OR `roster:manage` for staff;
 * `guardian:read_child` + `assertGuardianOfStudent` for guardians). Identity-plane
 * (names studentIds); NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { COMMENT_TYPES } from "@scd/shared";
import type { CommentType, CommentSentiment } from "@scd/shared";
import { MeetingComment, type IMeetingComment } from "../models/MeetingComment";
import { StudentComment, type IStudentComment } from "../models/StudentComment";
import { ParentMeeting, type IParentMeeting } from "../models/ParentMeeting";
import { ParentMeetingSlot, type IParentMeetingSlot } from "../models/ParentMeetingSlot";
import { writeAudit } from "../../platform/services/AuditService";

/** A surfaced service error (Bangla-friendly message), mirroring the tracker pattern. */
export class MeetingCommentError extends Error {}

// ===========================================================================
// Shapes
// ===========================================================================

/** A meeting note WITH its meeting context (staff comparison view). */
export interface MeetingCommentEntry {
  id: string;
  meetingId: string;
  instanceLabel: string;
  meetingDate: string;
  studentId: string;
  authorUserId: string;
  positiveText: string;
  concernText: string;
  createdAt: string;
  updatedAt: string;
}

/** One bucket of the daily-comment by-type rollup (J-CM7). */
export interface CommentTypeCount {
  type: CommentType;
  count: number;
}

export interface StudentCommentTimeline {
  studentId: string;
  /** Prior meeting notes, chronological (oldest → newest). */
  meetingComments: MeetingCommentEntry[];
  /** Daily-comment by-type rollup since the most recent meeting (D-#202). */
  rollupSinceLastMeeting: CommentTypeCount[];
  /** The meeting the rollup window opens at (null when there is no past meeting). */
  sinceMeetingId: string | null;
  sinceMeetingDate: string | null;
}

export interface MeetingComparison {
  meetingId: string;
  instanceLabel: string;
  meetingDate: string;
  studentId: string;
  /** This meeting's note for the child (null until the class teacher writes it). */
  current: MeetingCommentEntry | null;
  /** Notes from earlier meetings, chronological. */
  prior: MeetingCommentEntry[];
  /** Daily-comment by-type rollup between the previous meeting and this one. */
  rollupSincePrevious: CommentTypeCount[];
  previousMeetingId: string | null;
  previousMeetingDate: string | null;
}

/** GUARDIAN-facing daily comment — STRUCTURALLY omits authorUserId / sectionId /
 *  deliveryChannels (staff-only). Delivered comments only, so deliveredAt is set. */
export interface GuardianStudentComment {
  id: string;
  type: CommentType;
  sentiment: CommentSentiment;
  text: string;
  attachmentIds: string[];
  deliveredAt: string;
  createdAt: string;
}

/** GUARDIAN-facing meeting slot — omits familyKey / studentIds / attendanceRemark. */
export interface GuardianMeetingSlot {
  meetingId: string;
  instanceLabel: string;
  meetingDate: string;
  slotTime: number | null;
  onCall: boolean;
  classLabels: string[];
  order: number;
  dispatchedAt: string | null;
  attended: boolean | null;
}

// ===========================================================================
// Pure helper (no DB/clock — unit-tested directly)
// ===========================================================================

/** Roll a list of daily-comment types into a stable per-type count over ALL
 *  COMMENT_TYPES (every type present, count 0 when none) — J-CM7. Pure. */
export function rollupByType(types: string[]): CommentTypeCount[] {
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  return (COMMENT_TYPES as readonly CommentType[]).map((type) => ({
    type,
    count: counts.get(type) ?? 0,
  }));
}

// ===========================================================================
// Shapers
// ===========================================================================

function entryShape(d: IMeetingComment, meeting: { instanceLabel: string; meetingDate: Date }): MeetingCommentEntry {
  return {
    id: d._id.toString(),
    meetingId: d.meetingId.toString(),
    instanceLabel: meeting.instanceLabel,
    meetingDate: new Date(meeting.meetingDate).toISOString(),
    studentId: d.studentId.toString(),
    authorUserId: d.authorUserId.toString(),
    positiveText: d.positiveText ?? "",
    concernText: d.concernText ?? "",
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}

// ===========================================================================
// saveMeetingComment (upsert one per student × meeting — J-CM6)
// ===========================================================================

export interface SaveMeetingCommentInput {
  meetingId: string;
  studentId: string;
  positiveText?: string;
  concernText?: string;
  /** The authenticated class teacher (ctx.auth.userId). */
  actorId: string;
}

export async function saveMeetingComment(input: SaveMeetingCommentInput): Promise<MeetingCommentEntry> {
  if (!Types.ObjectId.isValid(input.meetingId)) throw new MeetingCommentError("Invalid meeting id");
  if (!Types.ObjectId.isValid(input.studentId)) throw new MeetingCommentError("Invalid student id");

  const meeting = (await ParentMeeting.findById(input.meetingId)
    .select("instanceLabel meetingDate")
    .lean()) as unknown as { instanceLabel: string; meetingDate: Date } | null;
  if (!meeting) throw new MeetingCommentError("Meeting not found");

  const positiveText = (input.positiveText ?? "").trim();
  const concernText = (input.concernText ?? "").trim();
  if (!positiveText && !concernText) {
    throw new MeetingCommentError("A meeting comment needs a positive or a concern note");
  }

  const doc = (await MeetingComment.findOneAndUpdate(
    { meetingId: new Types.ObjectId(input.meetingId), studentId: new Types.ObjectId(input.studentId) },
    { $set: { positiveText, concernText, authorUserId: new Types.ObjectId(input.actorId) } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )) as IMeetingComment;

  await writeAudit({
    eventKind: "MEETING_COMMENT_SAVED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "MeetingComment",
    meta: { meetingId: input.meetingId, studentId: input.studentId },
  });

  return entryShape(doc, meeting);
}

// ===========================================================================
// Comparison reads (DERIVED — D-#44)
// ===========================================================================

/** Load the (date,label) for a set of meeting ids, in one query. */
async function loadMeetingMeta(
  meetingIds: Types.ObjectId[],
): Promise<Map<string, { instanceLabel: string; meetingDate: Date }>> {
  if (meetingIds.length === 0) return new Map();
  const metas = (await ParentMeeting.find({ _id: { $in: meetingIds } })
    .select("instanceLabel meetingDate")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; instanceLabel: string; meetingDate: Date }>;
  return new Map(metas.map((m) => [m._id.toString(), { instanceLabel: m.instanceLabel, meetingDate: m.meetingDate }]));
}

/** A child's daily-comment types in a created-at window (for the rollup). */
async function dailyTypesInWindow(
  studentId: string,
  after: Date | null,
  upTo: Date | null,
): Promise<string[]> {
  const filter: Record<string, unknown> = { studentId: new Types.ObjectId(studentId) };
  const createdAt: Record<string, Date> = {};
  if (after) createdAt.$gt = after;
  if (upTo) createdAt.$lte = upTo;
  if (Object.keys(createdAt).length) filter.createdAt = createdAt;
  const docs = (await StudentComment.find(filter).select("type").lean()) as unknown as Array<{ type: string }>;
  return docs.map((d) => d.type);
}

export async function studentCommentTimeline(studentId: string): Promise<StudentCommentTimeline> {
  if (!Types.ObjectId.isValid(studentId)) throw new MeetingCommentError("Invalid student id");

  const notes = (await MeetingComment.find({ studentId: new Types.ObjectId(studentId) })
    .lean()) as unknown as IMeetingComment[];
  const meta = await loadMeetingMeta(notes.map((n) => n.meetingId));
  const meetingComments = notes
    .map((n) => {
      const m = meta.get(n.meetingId.toString());
      return m ? entryShape(n, m) : null;
    })
    .filter((e): e is MeetingCommentEntry => e !== null)
    .sort((a, b) => new Date(a.meetingDate).getTime() - new Date(b.meetingDate).getTime());

  // The rollup window opens at the most recent meeting (school-wide), D-#202.
  const lastMeeting = (await ParentMeeting.findOne({})
    .sort({ meetingDate: -1 })
    .select("meetingDate")
    .lean()) as unknown as { _id: Types.ObjectId; meetingDate: Date } | null;
  const since = lastMeeting ? lastMeeting.meetingDate : null;
  const types = await dailyTypesInWindow(studentId, since, null);

  return {
    studentId,
    meetingComments,
    rollupSinceLastMeeting: rollupByType(types),
    sinceMeetingId: lastMeeting ? lastMeeting._id.toString() : null,
    sinceMeetingDate: since ? new Date(since).toISOString() : null,
  };
}

export async function meetingComparison(meetingId: string, studentId: string): Promise<MeetingComparison> {
  if (!Types.ObjectId.isValid(meetingId)) throw new MeetingCommentError("Invalid meeting id");
  if (!Types.ObjectId.isValid(studentId)) throw new MeetingCommentError("Invalid student id");

  const meeting = (await ParentMeeting.findById(meetingId)
    .select("instanceLabel meetingDate")
    .lean()) as unknown as { _id: Types.ObjectId; instanceLabel: string; meetingDate: Date } | null;
  if (!meeting) throw new MeetingCommentError("Meeting not found");

  const notes = (await MeetingComment.find({ studentId: new Types.ObjectId(studentId) })
    .lean()) as unknown as IMeetingComment[];
  const meta = await loadMeetingMeta(notes.map((n) => n.meetingId));

  let current: MeetingCommentEntry | null = null;
  const prior: MeetingCommentEntry[] = [];
  for (const n of notes) {
    const m = meta.get(n.meetingId.toString());
    if (!m) continue;
    const entry = entryShape(n, m);
    if (n.meetingId.toString() === meetingId) current = entry;
    else if (new Date(m.meetingDate).getTime() < new Date(meeting.meetingDate).getTime()) prior.push(entry);
  }
  prior.sort((a, b) => new Date(a.meetingDate).getTime() - new Date(b.meetingDate).getTime());

  // The previous meeting = the latest ParentMeeting strictly before this one (school-wide).
  const previous = (await ParentMeeting.findOne({ meetingDate: { $lt: meeting.meetingDate } })
    .sort({ meetingDate: -1 })
    .select("meetingDate")
    .lean()) as unknown as { _id: Types.ObjectId; meetingDate: Date } | null;
  const prevDate = previous ? previous.meetingDate : null;
  const types = await dailyTypesInWindow(studentId, prevDate, meeting.meetingDate);

  return {
    meetingId,
    instanceLabel: meeting.instanceLabel,
    meetingDate: new Date(meeting.meetingDate).toISOString(),
    studentId,
    current,
    prior,
    rollupSincePrevious: rollupByType(types),
    previousMeetingId: previous ? previous._id.toString() : null,
    previousMeetingDate: prevDate ? new Date(prevDate).toISOString() : null,
  };
}

// ===========================================================================
// Guardian reads (J-CM8 — delivered daily comments + the family slot ONLY)
// ===========================================================================

/** The child's DELIVERED daily comments, newest first — guardian-facing shape (no
 *  staff fields; undelivered comments and the MeetingComment are structurally absent). */
export async function childComments(studentId: string): Promise<GuardianStudentComment[]> {
  if (!Types.ObjectId.isValid(studentId)) throw new MeetingCommentError("Invalid student id");
  const docs = (await StudentComment.find({
    studentId: new Types.ObjectId(studentId),
    deliveredAt: { $ne: null },
  })
    .sort({ createdAt: -1 })
    .lean()) as unknown as IStudentComment[];
  return docs
    .filter((d) => d.deliveredAt) // belt-and-braces (a lean read can't rely on $ne alone for missing)
    .map((d) => ({
      id: d._id.toString(),
      type: d.type,
      sentiment: d.sentiment,
      text: d.text,
      attachmentIds: (d.attachmentIds ?? []).map((a) => a.toString()),
      deliveredAt: new Date(d.deliveredAt as Date).toISOString(),
      createdAt: new Date(d.createdAt).toISOString(),
    }));
}

/** The guardian's own family slot for a meeting (J-CM8) — null when the child has no
 *  slot. Guardian-facing shape: no familyKey / studentIds / attendanceRemark. */
export async function childMeetingSlot(meetingId: string, studentId: string): Promise<GuardianMeetingSlot | null> {
  if (!Types.ObjectId.isValid(meetingId)) throw new MeetingCommentError("Invalid meeting id");
  if (!Types.ObjectId.isValid(studentId)) throw new MeetingCommentError("Invalid student id");

  const meeting = (await ParentMeeting.findById(meetingId)
    .select("instanceLabel meetingDate")
    .lean()) as unknown as { instanceLabel: string; meetingDate: Date } | null;
  if (!meeting) throw new MeetingCommentError("Meeting not found");

  const slot = (await ParentMeetingSlot.findOne({
    meetingId: new Types.ObjectId(meetingId),
    studentIds: new Types.ObjectId(studentId),
  }).lean()) as unknown as IParentMeetingSlot | null;
  if (!slot) return null;

  return {
    meetingId,
    instanceLabel: meeting.instanceLabel,
    meetingDate: new Date(meeting.meetingDate).toISOString(),
    slotTime: slot.slotTime ?? null,
    onCall: !!slot.onCall,
    classLabels: slot.classLabels ?? [],
    order: slot.order,
    dispatchedAt: slot.dispatchedAt ? new Date(slot.dispatchedAt).toISOString() : null,
    attended: slot.attended ?? null,
  };
}
