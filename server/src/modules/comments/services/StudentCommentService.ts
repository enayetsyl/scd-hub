/**
 * StudentCommentService (CM-1, prd-comments-meetings §3/§6, D-#114/#115) — the
 * daily student-comment store: record / edit (author-only, pre-delivery) + the
 * staff reads. NO delivery here (no emit()/wa.me) — that is CM-2.
 *
 *   resolveCommentSection — load the student + return the REAL section id (the
 *                           write-scope target; never trust a client section).
 *   recordComment         — create one comment: type/sentiment/text [+ attachments];
 *                           author = the authenticated teacher; audited.
 *   editComment           — AUTHOR-ONLY edit, REFUSED once `deliveredAt` is set
 *                           (immutable after delivery, §3 — a correction is a new
 *                           comment); audited.
 *   listSectionComments   — a section's comments, newest first (staff worklist).
 *   studentComments       — a child's full comment history, newest first (the
 *                           staff timeline; the guardian-facing delivered-only read
 *                           is CM-5).
 *
 * Role RBAC (`tracker:write` / `tracker:read`) + the section row-scope
 * (`assertCanWrite` / `assertCanRead`) are enforced by the RESOLVER — this service
 * trusts the actor + the server-resolved section.
 *
 * Identity-plane (names studentIds); NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { COMMENT_TYPES, COMMENT_SENTIMENTS } from "@scd/shared";
import type { CommentType, CommentSentiment } from "@scd/shared";
import { StudentComment, type IStudentComment } from "../models/StudentComment";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import { StoredFile } from "../../platform/models/StoredFile";
import { writeAudit } from "../../platform/services/AuditService";

/** A surfaced service error (Bangla-friendly message), mirroring the tracker pattern. */
export class StudentCommentError extends Error {}

export interface StudentCommentShape {
  id: string;
  studentId: string;
  sectionId: string;
  authorUserId: string;
  type: CommentType;
  sentiment: CommentSentiment;
  text: string;
  attachmentIds: string[];
  deliveredAt: string | null;
  deliveryChannels: string[];
  createdAt: string;
  updatedAt: string;
}

function shape(d: IStudentComment): StudentCommentShape {
  return {
    id: d._id.toString(),
    studentId: d.studentId.toString(),
    sectionId: d.sectionId.toString(),
    authorUserId: d.authorUserId.toString(),
    type: d.type,
    sentiment: d.sentiment,
    text: d.text,
    attachmentIds: (d.attachmentIds ?? []).map((a) => a.toString()),
    deliveredAt: d.deliveredAt ? new Date(d.deliveredAt).toISOString() : null,
    deliveryChannels: d.deliveryChannels ?? [],
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function assertType(type: string): CommentType {
  if (!(COMMENT_TYPES as readonly string[]).includes(type)) {
    throw new StudentCommentError(`type must be one of: ${COMMENT_TYPES.join(", ")}`);
  }
  return type as CommentType;
}

function assertSentiment(sentiment: string): CommentSentiment {
  if (!(COMMENT_SENTIMENTS as readonly string[]).includes(sentiment)) {
    throw new StudentCommentError(`sentiment must be one of: ${COMMENT_SENTIMENTS.join(", ")}`);
  }
  return sentiment as CommentSentiment;
}

function assertText(text: string): string {
  const t = (text ?? "").trim();
  if (!t) throw new StudentCommentError("Comment text is required");
  return t;
}

function toObjectIds(ids: string[] | undefined): Types.ObjectId[] {
  if (!ids || ids.length === 0) return [];
  return ids.map((id) => {
    if (!Types.ObjectId.isValid(id)) throw new StudentCommentError("Invalid attachment id");
    return new Types.ObjectId(id);
  });
}

/**
 * Resolve the child's REAL section (the write-scope target). The section is ALWAYS
 * derived from the student server-side — the client never supplies it (D-#115),
 * which blocks recording a comment under a section the teacher doesn't actually
 * write. Inactive / missing students are rejected.
 */
export async function resolveCommentSection(studentId: string): Promise<string> {
  if (!Types.ObjectId.isValid(studentId)) throw new StudentCommentError("Invalid student id");
  const student = (await Student.findById(studentId).select("sectionId active").lean()) as
    | { sectionId?: Types.ObjectId; active?: boolean }
    | null;
  if (!student) throw new StudentCommentError("Student not found");
  if (student.active === false) throw new StudentCommentError("Student is not active");
  if (!student.sectionId) throw new StudentCommentError("Student has no section");
  return student.sectionId.toString();
}

// ---------------------------------------------------------------------------
// recordComment (a teacher records one daily comment — J-CM1; NO delivery)
// ---------------------------------------------------------------------------

export interface RecordCommentInput {
  studentId: string;
  /** The child's REAL section, server-resolved by the resolver (D-#115). */
  sectionId: string;
  type: string;
  sentiment: string;
  text: string;
  attachmentIds?: string[];
  /** The authenticated teacher (ctx.auth.userId). */
  actorId: string;
}

export async function recordComment(input: RecordCommentInput): Promise<StudentCommentShape> {
  const type = assertType(input.type);
  const sentiment = assertSentiment(input.sentiment);
  const text = assertText(input.text);
  const attachmentIds = toObjectIds(input.attachmentIds);

  const doc = await StudentComment.create({
    studentId: new Types.ObjectId(input.studentId),
    sectionId: new Types.ObjectId(input.sectionId),
    authorUserId: new Types.ObjectId(input.actorId),
    type,
    sentiment,
    text,
    attachmentIds,
    deliveryChannels: [],
  });

  await writeAudit({
    eventKind: "STUDENT_COMMENT_RECORDED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "StudentComment",
    meta: { studentId: input.studentId, sectionId: input.sectionId, type, sentiment },
  });

  return shape(doc);
}

// ---------------------------------------------------------------------------
// editComment (AUTHOR-ONLY, REFUSED once delivered — §3)
// ---------------------------------------------------------------------------

export interface EditCommentInput {
  commentId: string;
  type?: string;
  sentiment?: string;
  text?: string;
  attachmentIds?: string[];
  /** The authenticated user (ctx.auth.userId). */
  actorId: string;
  /** True when the actor is a reviewer (Principal/Office) who may edit ANY undelivered
   *  comment before releasing it (D-#264); otherwise edit is author-only (D-#115). */
  actorIsReviewer?: boolean;
}

export async function editComment(input: EditCommentInput): Promise<StudentCommentShape> {
  if (!Types.ObjectId.isValid(input.commentId)) throw new StudentCommentError("Invalid comment id");
  const doc = (await StudentComment.findById(input.commentId)) as IStudentComment | null;
  if (!doc) throw new StudentCommentError("Comment not found");

  // Author-only (§6, D-#115) — UNLESS the actor is a Principal/Office reviewer, who
  // may revise any comment before releasing it to the guardian (D-#264).
  if (!input.actorIsReviewer && doc.authorUserId.toString() !== input.actorId) {
    throw new StudentCommentError("Only the comment's author may edit it");
  }
  // Immutable once delivered — a correction is a NEW comment (§3).
  if (doc.deliveredAt) {
    throw new StudentCommentError("A delivered comment is immutable — record a new comment to correct it");
  }

  if (input.type !== undefined) doc.type = assertType(input.type);
  if (input.sentiment !== undefined) doc.sentiment = assertSentiment(input.sentiment);
  if (input.text !== undefined) doc.text = assertText(input.text);
  if (input.attachmentIds !== undefined) doc.attachmentIds = toObjectIds(input.attachmentIds);

  await doc.save();

  await writeAudit({
    eventKind: "STUDENT_COMMENT_RECORDED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "StudentComment",
    meta: { studentId: doc.studentId.toString(), sectionId: doc.sectionId.toString(), edited: true },
  });

  return shape(doc);
}

// ---------------------------------------------------------------------------
// removeCommentAttachment (author OR Principal/Office reviewer; pre-delivery — D-#264)
// ---------------------------------------------------------------------------

export interface RemoveAttachmentInput {
  commentId: string;
  fileId: string;
  actorId: string;
  /** True for a Principal/Office reviewer (may manage any undelivered comment's files). */
  actorIsReviewer?: boolean;
}

export async function removeCommentAttachment(input: RemoveAttachmentInput): Promise<StudentCommentShape> {
  if (!Types.ObjectId.isValid(input.commentId) || !Types.ObjectId.isValid(input.fileId)) {
    throw new StudentCommentError("Invalid id");
  }
  const doc = (await StudentComment.findById(input.commentId)) as IStudentComment | null;
  if (!doc) throw new StudentCommentError("Comment not found");
  if (!input.actorIsReviewer && doc.authorUserId.toString() !== input.actorId) {
    throw new StudentCommentError("Only the comment's author may edit it");
  }
  if (doc.deliveredAt) {
    throw new StudentCommentError("A delivered comment is immutable — record a new comment to correct it");
  }

  doc.attachmentIds = (doc.attachmentIds ?? []).filter((a) => a.toString() !== input.fileId);
  await doc.save();
  // Unbind + drop the StoredFile metadata so the file is no longer reachable (the GET
  // gate needs the StoredFile + its studentCommentId binding); the Drive blob orphans.
  await StoredFile.deleteOne({ _id: new Types.ObjectId(input.fileId), studentCommentId: doc._id });

  await writeAudit({
    eventKind: "STUDENT_COMMENT_RECORDED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "StudentComment",
    meta: { studentId: doc.studentId.toString(), attachmentRemoved: input.fileId },
  });

  return shape(doc);
}

// ---------------------------------------------------------------------------
// Staff reads (newest first)
// ---------------------------------------------------------------------------

/** Every comment on a section, newest first (the staff worklist). */
export async function listSectionComments(sectionId: string): Promise<StudentCommentShape[]> {
  const docs = (await StudentComment.find({ sectionId: new Types.ObjectId(sectionId) })
    .sort({ createdAt: -1 })
    .lean()) as unknown as IStudentComment[];
  return docs.map(shape);
}

/** A child's full comment history, newest first (the staff timeline). The
 *  guardian-facing delivered-only read (`childComments`) is CM-5. */
export async function studentComments(studentId: string): Promise<StudentCommentShape[]> {
  const docs = (await StudentComment.find({ studentId: new Types.ObjectId(studentId) })
    .sort({ createdAt: -1 })
    .lean()) as unknown as IStudentComment[];
  return docs.map(shape);
}

/** A comment row enriched with the child's name — for the author's "my comments"
 *  list (where comments span students, so the name is shown inline). */
export interface AuthoredCommentShape extends StudentCommentShape {
  studentName: string;
}

/**
 * The caller's OWN authored comments, newest first (optionally one student) — "see the
 * comments they made" (D-#263). Needs NO section read-scope: you authored them, so you
 * may always read your own (privacy: it never returns another teacher's comments). The
 * child's name is joined in (the list spans students). Identity plane; no corpus path.
 */
export async function myComments(actorId: string, studentId?: string): Promise<AuthoredCommentShape[]> {
  const filter: Record<string, unknown> = { authorUserId: new Types.ObjectId(actorId) };
  if (studentId) {
    if (!Types.ObjectId.isValid(studentId)) throw new StudentCommentError("Invalid student id");
    filter.studentId = new Types.ObjectId(studentId);
  }
  const docs = (await StudentComment.find(filter).sort({ createdAt: -1 }).lean()) as unknown as IStudentComment[];
  if (docs.length === 0) return [];

  const studentIds = [...new Set(docs.map((d) => d.studentId.toString()))];
  const students = await Student.find({ _id: { $in: studentIds } }).select({ name: 1 }).lean();
  const nameOf = new Map(students.map((s) => [s._id.toString(), s.name]));

  return docs.map((d) => ({ ...shape(d), studentName: nameOf.get(d.studentId.toString()) ?? d.studentId.toString() }));
}

/** A review-inbox row — the child's + author's names joined for the Principal/Office
 *  dashboard (which spans students + teachers). */
export interface CommentReviewRow extends AuthoredCommentShape {
  authorName: string;
}

/**
 * Every UNDELIVERED comment, newest first, enriched with the child's + author's names —
 * the Principal/Office review dashboard (D-#264): they decide what reaches the guardian.
 * School-wide (no section scope); gated `roster:manage` (Principal/Office) by the resolver.
 */
export async function reviewInbox(): Promise<CommentReviewRow[]> {
  const docs = (await StudentComment.find({ deliveredAt: null }).sort({ createdAt: -1 }).lean()) as unknown as IStudentComment[];
  if (docs.length === 0) return [];

  const studentIds = [...new Set(docs.map((d) => d.studentId.toString()))];
  const authorIds = [...new Set(docs.map((d) => d.authorUserId.toString()))];
  const students = await Student.find({ _id: { $in: studentIds } }).select({ name: 1 }).lean();
  const authors = await User.find({ _id: { $in: authorIds } }).select({ name: 1 }).lean();
  const sName = new Map(students.map((s) => [s._id.toString(), s.name]));
  const aName = new Map(authors.map((u) => [u._id.toString(), u.name]));

  return docs.map((d) => ({
    ...shape(d),
    studentName: sName.get(d.studentId.toString()) ?? d.studentId.toString(),
    authorName: aName.get(d.authorUserId.toString()) ?? d.authorUserId.toString(),
  }));
}
