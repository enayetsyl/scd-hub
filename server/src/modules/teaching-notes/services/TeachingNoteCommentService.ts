/**
 * TeachingNoteCommentService (TN-2, prd-teaching-notes) — the improvement-comment
 * thread on a teaching note, and the Principal's cross-subject outstanding list.
 *
 * WHO MAY DO WHAT (no new permission, D-#519):
 *   comment              — anyone who may READ the note (the same pair scope).
 *                          Many comments per teacher, many teachers per note:
 *                          that falls out of the model, it is not a feature.
 *   mark ADDRESSED       — the note's uploader, or roster:manage (P/O). A
 *                          teacher cannot close their own feedback loop; the
 *                          person who has to act on it is the one who confirms
 *                          it was acted on.
 *   delete               — the AUTHOR (soft), or roster:manage.
 *   read the whole list  — roster:manage. A teacher sees the threads on the
 *                          notes they can read, which is already scope-limited.
 *
 * Errors are Bangla; every write is audited (ADR-008).
 */
import { Types } from "mongoose";
import {
  callerHasPermission,
  ROUTINE_SUBJECT_LABELS_BN,
  ROSTER_CLASS_LABELS_BN,
  type RoutineSubject,
  type RosterClassLevel,
} from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import {
  emitTeachingNoteComment,
  emitTeachingNoteCommentAddressed,
} from "../../notifications/services/emitters";
import { TeachingNote, type ITeachingNote } from "../models/TeachingNote";
import {
  TeachingNoteComment,
  TEACHING_NOTE_COMMENT_MAX_CHARS,
  TEACHING_NOTE_ANCHOR_MAX_CHARS,
  TEACHING_NOTE_COMMENT_STATUSES,
  type ITeachingNoteComment,
  type TeachingNoteCommentStatus,
} from "../models/TeachingNoteComment";
import {
  teachingNoteVisibility,
  pairKey,
  assertNotMojibake,
} from "./TeachingNoteService";

export interface TeachingNoteCommentShape {
  id: string;
  noteId: string;
  classLevel: number;
  subject: string;
  kind: string;
  seq: number;
  /** The version the author was looking at — the D-#522 anchor stamp. */
  versionSeen: number;
  bodyBn: string;
  anchor: string | null;
  authorId: string;
  authorName: string | null;
  status: string;
  addressedByName: string | null;
  addressedAt: string | null;
  addressedNote: string | null;
  createdAt: string;
  /** True when this comment predates the note's CURRENT version — "written on v2,
   *  current is v3". Computed per read so the app never does the arithmetic. */
  staleForCurrentVersion: boolean;
  /** The note's current version, so the app can render "v2 → now v3" plainly. */
  currentVersion: number;
  /** The note's title at its current version — the outstanding list needs it. */
  noteTitle: string;
}

function identityFilter(doc: {
  classLevel: number;
  subject: string;
  kind: string;
  seq?: number;
}): Record<string, unknown> {
  return {
    classLevel: doc.classLevel,
    subject: doc.subject,
    kind: doc.kind,
    seq: doc.seq ?? 1,
  };
}

async function namesFor(ids: Array<Types.ObjectId | null | undefined>): Promise<
  Map<string, string | null>
> {
  const clean = [...new Set(ids.filter(Boolean).map((i) => (i as Types.ObjectId).toString()))];
  if (clean.length === 0) return new Map();
  const users = (await User.find({ _id: { $in: clean } })
    .select("name")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name?: string }>;
  return new Map(users.map((u) => [u._id.toString(), u.name ?? null]));
}

function shape(
  c: ITeachingNoteComment,
  names: Map<string, string | null>,
  current: { version: number; title: string },
): TeachingNoteCommentShape {
  return {
    id: c._id.toString(),
    noteId: c.noteId.toString(),
    classLevel: c.classLevel,
    subject: c.subject,
    kind: c.kind,
    seq: c.seq ?? 1,
    versionSeen: c.versionSeen,
    bodyBn: c.bodyBn,
    anchor: c.anchor ?? null,
    authorId: c.authorId.toString(),
    authorName: names.get(c.authorId.toString()) ?? null,
    status: c.status,
    addressedByName: c.addressedBy ? names.get(c.addressedBy.toString()) ?? null : null,
    addressedAt: c.addressedAt ? new Date(c.addressedAt).toISOString() : null,
    addressedNote: c.addressedNote ?? null,
    createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : "",
    staleForCurrentVersion: c.versionSeen < current.version,
    currentVersion: current.version,
    noteTitle: current.title,
  };
}

/** Load a note by id and assert the caller may read its (class × subject) pair. */
async function loadReadableNote(ctx: AppContext, noteId: string): Promise<ITeachingNote> {
  if (!Types.ObjectId.isValid(noteId)) throw new Error("নোটটি পাওয়া যায়নি");
  const note = (await TeachingNote.findById(noteId).lean()) as unknown as ITeachingNote | null;
  if (!note) throw new Error("নোটটি পাওয়া যায়নি");
  const allowed = await teachingNoteVisibility(ctx);
  if (allowed !== null && !allowed.has(pairKey(note.classLevel, note.subject))) {
    throw new ForbiddenError("এই শ্রেণি ও বিষয়ের শিক্ষক নোট দেখার অনুমতি নেই");
  }
  return note;
}

/** The CURRENT (unreplaced) row for an identity — the version a thread is read against. */
async function currentFor(doc: {
  classLevel: number;
  subject: string;
  kind: string;
  seq?: number;
}): Promise<{ version: number; title: string }> {
  const cur = (await TeachingNote.findOne({ ...identityFilter(doc), replacedAt: null })
    .select("version title")
    .lean()) as unknown as { version: number; title: string } | null;
  return cur ?? { version: 1, title: "" };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The thread for a note's IDENTITY — every comment ever written against any
 * version, oldest first. Passing any version's id returns the same thread; that
 * is the point of the anchor.
 */
export async function teachingNoteComments(
  ctx: AppContext,
  noteId: string,
): Promise<TeachingNoteCommentShape[]> {
  const note = await loadReadableNote(ctx, noteId);
  const rows = (await TeachingNoteComment.find({
    ...identityFilter(note),
    deletedAt: null,
  }).lean()) as unknown as ITeachingNoteComment[];
  const current = await currentFor(note);
  const names = await namesFor(rows.flatMap((r) => [r.authorId, r.addressedBy]));
  return rows
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
    .map((r) => shape(r, names, current));
}

/**
 * Every OPEN comment across the whole library, newest first — the Principal's
 * "still outstanding" view. roster:manage only; the point is the cross-subject
 * sweep, which a scope-limited teacher cannot meaningfully have.
 */
export async function openTeachingNoteComments(
  ctx: AppContext,
): Promise<TeachingNoteCommentShape[]> {
  if (!ctx.auth || !callerHasPermission(ctx.auth, "roster:manage")) {
    throw new ForbiddenError("অনুমতি নেই");
  }
  const rows = (await TeachingNoteComment.find({
    status: "OPEN",
    deletedAt: null,
  }).lean()) as unknown as ITeachingNoteComment[];
  if (rows.length === 0) return [];

  // One query for every current row touched, rather than per comment.
  const currents = (await TeachingNote.find({ replacedAt: null })
    .select("classLevel subject kind seq version title")
    .lean()) as unknown as Array<{
    classLevel: number;
    subject: string;
    kind: string;
    seq?: number;
    version: number;
    title: string;
  }>;
  const currentByKey = new Map(
    currents.map((c) => [
      `${c.classLevel}:${c.subject}:${c.kind}:${c.seq ?? 1}`,
      { version: c.version, title: c.title },
    ]),
  );

  const names = await namesFor(rows.flatMap((r) => [r.authorId, r.addressedBy]));
  return rows
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .map((r) =>
      shape(
        r,
        names,
        currentByKey.get(`${r.classLevel}:${r.subject}:${r.kind}:${r.seq ?? 1}`) ?? {
          version: r.versionSeen,
          title: "",
        },
      ),
    );
}

/**
 * Comment counts per document identity — the library badge. Replaces the TN-1
 * stub; one grouped query for the whole page rather than one per row.
 */
export async function commentCountsForIdentities(
  docs: Array<{ classLevel: number; subject: string; kind: string; seq?: number }>,
): Promise<Map<string, { total: number; open: number }>> {
  const out = new Map<string, { total: number; open: number }>();
  if (docs.length === 0) return out;

  const rows = (await TeachingNoteComment.find({
    deletedAt: null,
    $or: docs.map((d) => identityFilter(d)),
  })
    .select("classLevel subject kind seq status")
    .lean()) as unknown as Array<{
    classLevel: number;
    subject: string;
    kind: string;
    seq?: number;
    status: string;
  }>;

  for (const r of rows) {
    const key = `${r.classLevel}:${r.subject}:${r.kind}:${r.seq ?? 1}`;
    const cur = out.get(key) ?? { total: 0, open: 0 };
    cur.total += 1;
    if (r.status === "OPEN") cur.open += 1;
    out.set(key, cur);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface AddTeachingNoteCommentInput {
  noteId: string;
  bodyBn: string;
  anchor?: string | null;
}

export async function addTeachingNoteComment(
  ctx: AppContext,
  input: AddTeachingNoteCommentInput,
): Promise<TeachingNoteCommentShape> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const note = await loadReadableNote(ctx, input.noteId);

  const body = (input.bodyBn ?? "").trim();
  if (body === "") throw new Error("মন্তব্য লিখুন");
  if (body.length > TEACHING_NOTE_COMMENT_MAX_CHARS) {
    throw new Error("মন্তব্যটি খুব বড়");
  }
  // The same encoding guard the note body gets — a comment pasted out of a
  // broken document would be just as unreadable, and just as invisibly.
  assertNotMojibake(body);

  const anchor = (input.anchor ?? "").trim();
  if (anchor.length > TEACHING_NOTE_ANCHOR_MAX_CHARS) throw new Error("অংশের নামটি খুব বড়");
  if (anchor !== "") assertNotMojibake(anchor);

  const doc = await TeachingNoteComment.create({
    classLevel: note.classLevel,
    subject: note.subject,
    kind: note.kind,
    seq: note.seq ?? 1,
    noteId: note._id,
    versionSeen: note.version,
    bodyBn: body,
    anchor: anchor === "" ? null : anchor,
    authorId: ctx.auth.userId,
    status: "OPEN",
  });

  await writeAudit({
    eventKind: "TEACHING_NOTE_COMMENTED",
    actorId: ctx.auth.userId as string,
    actorRole: ctx.auth.role,
    targetId: doc._id,
    targetKind: "TeachingNoteComment",
    meta: {
      noteId: note._id.toString(),
      classLevel: note.classLevel,
      subject: note.subject,
      kind: note.kind,
      seq: note.seq ?? 1,
      versionSeen: note.version,
    },
  });

  const names = await namesFor([doc.authorId]);

  // Tell the note's uploader + the Principal. Best-effort by contract (D-#72/#75):
  // a notification failure must never roll back the comment.
  const current = (await TeachingNote.findOne({ ...identityFilter(note), replacedAt: null })
    .select("uploadedBy")
    .lean()) as unknown as { uploadedBy: Types.ObjectId } | null;
  await emitTeachingNoteComment({
    commentId: doc._id,
    noteId: note._id,
    title: note.title,
    className: ROSTER_CLASS_LABELS_BN[note.classLevel as RosterClassLevel] ?? String(note.classLevel),
    subjectLabel: ROUTINE_SUBJECT_LABELS_BN[note.subject as RoutineSubject] ?? note.subject,
    authorId: doc.authorId,
    authorName: names.get(doc.authorId.toString()) ?? "",
    uploaderId: current?.uploadedBy ?? null,
  });

  return shape(doc as unknown as ITeachingNoteComment, names, {
    version: note.version,
    title: note.title,
  });
}

/** May the caller close this comment? The note's uploader, or P/O. */
async function assertMayAddress(ctx: AppContext, c: ITeachingNoteComment): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (callerHasPermission(ctx.auth, "roster:manage")) return;
  const current = (await TeachingNote.findOne({ ...identityFilter(c), replacedAt: null })
    .select("uploadedBy")
    .lean()) as unknown as { uploadedBy: Types.ObjectId } | null;
  if (current && current.uploadedBy.toString() === ctx.auth.userId) return;
  throw new ForbiddenError("মন্তব্যটির অবস্থা বদলানোর অনুমতি নেই");
}

export async function setTeachingNoteCommentStatus(
  ctx: AppContext,
  input: { commentId: string; status: string; addressedNote?: string | null },
): Promise<TeachingNoteCommentShape> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!(TEACHING_NOTE_COMMENT_STATUSES as readonly string[]).includes(input.status)) {
    throw new Error("অবস্থা সঠিক নয়");
  }
  if (!Types.ObjectId.isValid(input.commentId)) throw new Error("মন্তব্যটি পাওয়া যায়নি");
  const c = await TeachingNoteComment.findById(input.commentId);
  if (!c || c.deletedAt) throw new Error("মন্তব্যটি পাওয়া যায়নি");

  await assertMayAddress(ctx, c as unknown as ITeachingNoteComment);

  const status = input.status as TeachingNoteCommentStatus;
  const note = ((input.addressedNote ?? "").trim() || null) as string | null;
  if (note) assertNotMojibake(note);

  c.status = status;
  if (status === "ADDRESSED") {
    c.addressedBy = new Types.ObjectId(ctx.auth.userId as string);
    c.addressedAt = new Date();
    c.addressedNote = note;
  } else {
    // Reopening clears the closure — a stale "fixed in v3" on an open comment
    // is worse than no note at all.
    c.addressedBy = null;
    c.addressedAt = null;
    c.addressedNote = null;
  }
  await c.save();

  await writeAudit({
    eventKind: "TEACHING_NOTE_COMMENT_ADDRESSED",
    actorId: ctx.auth.userId as string,
    actorRole: ctx.auth.role,
    targetId: c._id,
    targetKind: "TeachingNoteComment",
    meta: { status, noteId: c.noteId.toString(), ...(note ? { addressedNote: note } : {}) },
  });

  const current = await currentFor(c as unknown as ITeachingNoteComment);
  const names = await namesFor([c.authorId, c.addressedBy]);

  // Closing tells the teacher who raised it that their suggestion landed — the
  // half of the loop that makes commenting feel worth doing. Reopening says
  // nothing: the author already knows the thread is live.
  if (status === "ADDRESSED") {
    await emitTeachingNoteCommentAddressed({
      commentId: c._id,
      noteId: c.noteId,
      title: current.title,
      className: ROSTER_CLASS_LABELS_BN[c.classLevel as RosterClassLevel] ?? String(c.classLevel),
      subjectLabel: ROUTINE_SUBJECT_LABELS_BN[c.subject as RoutineSubject] ?? c.subject,
      authorId: c.authorId,
      addressedBy: ctx.auth.userId as string,
    });
  }

  return shape(c as unknown as ITeachingNoteComment, names, current);
}

/** Soft-delete: the author, or P/O. The thread never loses entries without trace. */
export async function deleteTeachingNoteComment(
  ctx: AppContext,
  commentId: string,
): Promise<boolean> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!Types.ObjectId.isValid(commentId)) throw new Error("মন্তব্যটি পাওয়া যায়নি");
  const c = await TeachingNoteComment.findById(commentId);
  if (!c || c.deletedAt) throw new Error("মন্তব্যটি পাওয়া যায়নি");

  const isAuthor = c.authorId.toString() === ctx.auth.userId;
  if (!isAuthor && !callerHasPermission(ctx.auth, "roster:manage")) {
    throw new ForbiddenError("মন্তব্যটি মুছে ফেলার অনুমতি নেই");
  }
  c.deletedAt = new Date();
  await c.save();

  await writeAudit({
    eventKind: "TEACHING_NOTE_COMMENT_DELETED",
    actorId: ctx.auth.userId as string,
    actorRole: ctx.auth.role,
    targetId: c._id,
    targetKind: "TeachingNoteComment",
    meta: { noteId: c.noteId.toString(), byAuthor: isAuthor },
  });
  return true;
}

/**
 * Close several open comments at once — offered right after a new version is
 * uploaded, which is the one moment the uploader actually remembers what they
 * changed. Same authorisation as closing them one by one.
 */
export async function addressTeachingNoteComments(
  ctx: AppContext,
  input: { commentIds: string[]; addressedNote?: string | null },
): Promise<number> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const ids = [...new Set(input.commentIds)].filter((i) => Types.ObjectId.isValid(i));
  if (ids.length === 0) return 0;
  let n = 0;
  for (const id of ids) {
    await setTeachingNoteCommentStatus(ctx, {
      commentId: id,
      status: "ADDRESSED",
      addressedNote: input.addressedNote ?? null,
    });
    n += 1;
  }
  return n;
}
