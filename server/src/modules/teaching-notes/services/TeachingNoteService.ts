/**
 * TeachingNoteService (TN-1, prd-teaching-notes) — the (class × subject) note
 * library: upload/replace, the scope-filtered reads, and the file read gate.
 *
 * VISIBILITY (D-#515) — a teacher sees a note when they teach that subject to
 * that class; Principal/Office see everything; GUARDIAN has no path at all.
 *
 * The allowed set is a set of (classLevel, subject) PAIRS, not two independent
 * sets. A teacher taking Class 5 Bangla and Class 3 Maths must see C5-বাংলা and
 * C3-গণিত and NOT C5-গণিত, which a cross-product of {3,5}×{BAN,MATH} would leak.
 *
 * WHY THIS WALKS THE ROUTINE AND NOT ONLY THE SCOPE GRANTS — the English Drive
 * precedent (D-#344) derives its class list from `resolveTeacherScopes` alone.
 * That is sufficient there because English Drive is English-only, and ENG is a
 * `Subject` row. It is NOT sufficient here: `Subject.code` is
 * FOUNDATION_SUBJECTS (BAN/ENG/MATH/SCI/BGS/ISLAM), so **ARABIC and QURAN have
 * no Subject row to grant** — they are taught through cross-grade SubjectGroups
 * and exist only as `RoutineSlot.subject`. A grant-only walk would have shipped
 * an Arabic library that no Arabic teacher could open, and the failure would
 * have been silent (an empty list reads as "nothing uploaded yet").
 *
 * So the set is the UNION of two sources:
 *   1. `RoutineSlot` — who actually teaches what. Authoritative for all 8
 *      subjects and the only source that reaches Arabic/Quran.
 *   2. `ScopeGrant` via `resolveTeacherScopes` — keeps parity with the rest of
 *      the app for the six foundation subjects, and is the ONLY source that
 *      carries supervisory/proxy reach (a subject-department head who teaches
 *      no timetabled period still supervises that subject).
 *
 * A cross-grade subjectgroup slot (Quran/Arabic) grants that subject at EVERY
 * class level. That is not a shortcut: the group spans grades by construction,
 * so its teacher has no single level, and hiding levels from them would hide
 * notes they are the audience for.
 *
 * All uploads/replaces are audited (ADR-008). Errors are Bangla — they surface
 * in the app verbatim.
 */
import { Types } from "mongoose";
import { ROUTINE_SUBJECTS, ROSTER_CLASS_LEVELS, type RoutineSubject } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError, resolveTeacherScopes } from "../../../middleware/authz";
import { Subject } from "../../foundation/models/Subject";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { isAdminStaff } from "../../foundation/services/RoleScope";
import { writeAudit } from "../../platform/services/AuditService";
import { StoredFile } from "../../platform/models/StoredFile";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import {
  TeachingNote,
  TEACHING_NOTE_KINDS,
  TEACHING_NOTE_FORMATS,
  TEACHING_NOTE_MD_MAX_BYTES,
  type ITeachingNote,
  type TeachingNoteKind,
  type TeachingNoteFormat,
} from "../models/TeachingNote";

/** `${classLevel}:${subject}` — the pair key the visibility set is built from. */
export function pairKey(classLevel: number, subject: string): string {
  return `${classLevel}:${subject}`;
}

// ---------------------------------------------------------------------------
// The encoding guard (PRD §5) — the single most likely way this library breaks.
// ---------------------------------------------------------------------------

/**
 * Bangla UTF-8 read as Latin-1: `বাংলা` (E0 A6 AC …) surfaces as `à¦¬à¦¾…`.
 * U+00E0 followed by U+00A6/U+00A7 is the Bengali block's lead-byte pair and
 * essentially cannot occur in genuine text — it would need "à" immediately
 * before a broken-bar or section sign.
 *
 * Every one of the owner's four seed documents arrived in exactly this state,
 * so this is an OBSERVED failure mode, not a hypothetical one. Rejecting at the
 * door is the whole point: a mojibake note that is accepted looks fine in the
 * library list (the title is mangled but present) and is only discovered when a
 * teacher opens it, by which time the correct original may be gone.
 */
const MOJIBAKE_RE = /à[¦§]/;

export const TEACHING_NOTE_MOJIBAKE_ERROR =
  "ফাইলটির বাংলা লেখা ভেঙে গেছে (এনকোডিং ভুল)। ফাইলটি UTF-8 হিসেবে সেভ করে আবার আপলোড করুন।";

/** True when `text` carries the UTF-8-read-as-Latin-1 signature. */
export function looksLikeMojibake(text: string): boolean {
  return MOJIBAKE_RE.test(text);
}

/** Throw the Bangla encoding error when `text` is mojibake. Used for title + body. */
export function assertNotMojibake(text: string): void {
  if (looksLikeMojibake(text)) throw new Error(TEACHING_NOTE_MOJIBAKE_ERROR);
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/**
 * The (classLevel, subject) pairs the caller may read, or `null` for
 * unrestricted (Principal/Office, whole-school supervisors). GUARDIAN throws.
 */
export async function teachingNoteVisibility(ctx: AppContext): Promise<Set<string> | null> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (isAdminStaff(ctx.auth)) return null;
  if (ctx.auth.role !== "TEACHER") {
    throw new ForbiddenError("শিক্ষক নোট দেখার অনুমতি নেই");
  }

  const userId = ctx.auth.userId as string;
  const pairs = new Set<string>();
  const allLevels = [...ROSTER_CLASS_LEVELS];

  // --- source 1: the routine (the only path that reaches ARABIC/QURAN) -------
  const slots = (await RoutineSlot.find({ teacherId: userId, active: { $ne: false } })
    .select("subject groupType classId")
    .lean()) as unknown as Array<{
    subject: string;
    groupType: string;
    classId?: Types.ObjectId | null;
  }>;

  const sectionClassIds = new Set<string>();
  for (const s of slots) {
    if (!s.subject) continue;
    if (s.groupType === "subjectgroup") {
      // Cross-grade by construction — that subject at every level.
      for (const lvl of allLevels) pairs.add(pairKey(lvl, s.subject));
    } else if (s.classId) {
      sectionClassIds.add(s.classId.toString());
    }
  }

  // --- source 2: the scope grants (supervisory/proxy reach + parity) ---------
  const scopes = await resolveTeacherScopes(ctx);
  const grantClassIds = new Set<string>();
  const grantSubjectIds = new Set<string>();
  for (const s of scopes) {
    if (s.kind === "teaching" || s.kind === "proxy") {
      if (s.classId) grantClassIds.add(s.classId);
      if (s.subjectId) grantSubjectIds.add(s.subjectId);
    } else if (s.kind === "supervisory") {
      if (s.extent === "whole_school") return null;
      if (s.extent === "grade_class" && s.classId) grantClassIds.add(s.classId);
      if (s.extent === "subject_dept" && s.subjectId) grantSubjectIds.add(s.subjectId);
      if (s.extent === "explicit_set") {
        for (const e of s.explicitSet ?? []) {
          grantClassIds.add(e.classId);
          grantSubjectIds.add(e.subjectId);
        }
      }
    }
  }

  // Resolve every class id we collected (both sources) to its roster level once.
  const allClassIds = [...new Set([...sectionClassIds, ...grantClassIds])];
  const levelById = new Map<string, number>();
  if (allClassIds.length > 0) {
    const classes = (await Class.find({ _id: { $in: allClassIds } })
      .select("level")
      .lean()) as unknown as Array<{ _id: Types.ObjectId; level: number }>;
    for (const c of classes) levelById.set(c._id.toString(), c.level);
  }

  // Routine section slots: the exact (level, subject) the teacher stands in front of.
  for (const s of slots) {
    if (s.groupType === "subjectgroup" || !s.classId || !s.subject) continue;
    const lvl = levelById.get(s.classId.toString());
    if (lvl !== undefined) pairs.add(pairKey(lvl, s.subject));
  }

  // Grants: map subject ids to codes, then pair each granted class with each
  // granted subject. This is the same widening `allowedSubjectCodesForSection`
  // performs per-section, applied across the caller's whole grant set.
  if (grantSubjectIds.size > 0 && grantClassIds.size > 0) {
    const subjects = (await Subject.find({ _id: { $in: [...grantSubjectIds] } })
      .select("code")
      .lean()) as unknown as Array<{ code: string }>;
    const codes = subjects
      .map((s) => s.code)
      .filter((c): c is RoutineSubject => (ROUTINE_SUBJECTS as readonly string[]).includes(c));
    for (const cid of grantClassIds) {
      const lvl = levelById.get(cid);
      if (lvl === undefined) continue;
      for (const code of codes) pairs.add(pairKey(lvl, code));
    }
  }

  // A grade_class supervisor holds the whole class — every subject at that level.
  for (const s of scopes) {
    if (s.kind === "supervisory" && s.extent === "grade_class" && s.classId) {
      const lvl = levelById.get(s.classId);
      if (lvl === undefined) continue;
      for (const code of ROUTINE_SUBJECTS) pairs.add(pairKey(lvl, code));
    }
    if (s.kind === "supervisory" && s.extent === "subject_dept" && s.subjectId) {
      // Department head: that subject at every level.
      const subj = await Subject.findById(s.subjectId).select("code").lean();
      const code = (subj as unknown as { code?: string } | null)?.code;
      if (code && (ROUTINE_SUBJECTS as readonly string[]).includes(code)) {
        for (const lvl of allLevels) pairs.add(pairKey(lvl, code));
      }
    }
  }

  return pairs;
}

export interface TeachingNoteScopePair {
  classLevel: number;
  subject: string;
}

/**
 * The caller's readable (class, subject) pairs for the app's picker + drawer
 * gate. Unrestricted callers get the full grid. GUARDIAN gets [] (no throw —
 * the drawer asks this on every render and an error would break the shell).
 */
export async function myTeachingNoteScope(ctx: AppContext): Promise<TeachingNoteScopePair[]> {
  if (!ctx.auth || ctx.auth.role === "GUARDIAN") return [];
  let allowed: Set<string> | null;
  try {
    allowed = await teachingNoteVisibility(ctx);
  } catch {
    return [];
  }
  if (allowed === null) {
    const all: TeachingNoteScopePair[] = [];
    for (const lvl of ROSTER_CLASS_LEVELS) {
      for (const subject of ROUTINE_SUBJECTS) all.push({ classLevel: lvl, subject });
    }
    return all;
  }
  return [...allowed]
    .map((k) => {
      const idx = k.indexOf(":");
      return { classLevel: Number(k.slice(0, idx)), subject: k.slice(idx + 1) };
    })
    .sort((a, b) => a.classLevel - b.classLevel || a.subject.localeCompare(b.subject));
}

function assertMayRead(allowed: Set<string> | null, classLevel: number, subject: string): void {
  if (allowed !== null && !allowed.has(pairKey(classLevel, subject))) {
    throw new ForbiddenError("এই শ্রেণি ও বিষয়ের শিক্ষক নোট দেখার অনুমতি নেই");
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface TeachingNoteShape {
  id: string;
  classLevel: number;
  subject: string;
  kind: string;
  seq: number;
  title: string;
  version: number;
  format: string;
  fileId: string | null;
  pdfFileId: string | null;
  fileName: string | null;
  fileMime: string | null;
  uploadedAt: string;
  uploadedByName: string | null;
  /** Null on library-list rows — only the single-note read carries the markdown. */
  contentMd: string | null;
  /** TN-2 fills these; 0 until the comment slice lands. */
  commentCount: number;
  openCommentCount: number;
}

function shape(
  doc: ITeachingNote,
  uploadedByName: string | null,
  withContent: boolean,
  counts?: { total: number; open: number },
): TeachingNoteShape {
  return {
    id: doc._id.toString(),
    classLevel: doc.classLevel,
    subject: doc.subject,
    kind: doc.kind,
    seq: doc.seq ?? 1,
    title: doc.title,
    version: doc.version,
    format: doc.format ?? "MD",
    fileId: doc.fileId ? doc.fileId.toString() : null,
    pdfFileId: doc.pdfFileId ? doc.pdfFileId.toString() : null,
    fileName: doc.fileName ?? null,
    fileMime: doc.fileMime ?? null,
    uploadedAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : "",
    uploadedByName,
    contentMd: withContent ? doc.contentMd : null,
    commentCount: counts?.total ?? 0,
    openCommentCount: counts?.open ?? 0,
  };
}

async function uploaderNames(rows: ITeachingNote[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(rows.map((r) => r.uploadedBy.toString()))];
  if (ids.length === 0) return new Map();
  const users = (await User.find({ _id: { $in: ids } })
    .select("name")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name?: string }>;
  return new Map(users.map((u) => [u._id.toString(), u.name ?? null]));
}

const kindOrder = (k: string): number => {
  const i = (TEACHING_NOTE_KINDS as readonly string[]).indexOf(k);
  return i === -1 ? TEACHING_NOTE_KINDS.length : i;
};

const subjectOrder = (s: string): number => {
  const i = (ROUTINE_SUBJECTS as readonly string[]).indexOf(s);
  return i === -1 ? ROUTINE_SUBJECTS.length : i;
};

export interface TeachingNotesFilter {
  classLevel?: number | null;
  subject?: string | null;
  kind?: string | null;
}

/**
 * The library — the LATEST (unreplaced) note of every (class, subject, kind, seq)
 * the caller may see, metadata only. Filters narrow within that permitted set;
 * asking for a pair outside it is a plain empty result for a broad filter and a
 * refusal for a fully-specified (class, subject) one.
 */
export async function teachingNotes(
  ctx: AppContext,
  filter: TeachingNotesFilter = {},
): Promise<TeachingNoteShape[]> {
  const allowed = await teachingNoteVisibility(ctx);

  const q: Record<string, unknown> = { replacedAt: null };
  if (filter.classLevel !== undefined && filter.classLevel !== null) q.classLevel = filter.classLevel;
  if (filter.subject) q.subject = filter.subject;
  if (filter.kind) q.kind = filter.kind;

  // A fully-specified (class, subject) outside the caller's set is a refusal, not
  // an empty list — silence would read as "nothing uploaded yet" and send a
  // teacher hunting for a document they are simply not the audience for.
  if (
    allowed !== null &&
    filter.classLevel !== undefined &&
    filter.classLevel !== null &&
    filter.subject
  ) {
    assertMayRead(allowed, filter.classLevel, filter.subject);
  }

  const rows = (await TeachingNote.find(q)
    .select("-contentMd")
    .lean()) as unknown as ITeachingNote[];

  const visible =
    allowed === null ? rows : rows.filter((r) => allowed.has(pairKey(r.classLevel, r.subject)));

  const names = await uploaderNames(visible);
  const counts = await commentCountsFor(visible.map((r) => r));

  return visible
    .sort(
      (a, b) =>
        a.classLevel - b.classLevel ||
        subjectOrder(a.subject) - subjectOrder(b.subject) ||
        kindOrder(a.kind) - kindOrder(b.kind) ||
        (a.seq ?? 1) - (b.seq ?? 1),
    )
    .map((r) =>
      shape(r, names.get(r.uploadedBy.toString()) ?? null, false, counts.get(identityKey(r))),
    );
}

/** One note WITH its markdown — the doc screen. Scope-checked. */
export async function teachingNoteById(ctx: AppContext, id: string): Promise<TeachingNoteShape> {
  if (!Types.ObjectId.isValid(id)) throw new Error("নোটটি পাওয়া যায়নি");
  const doc = (await TeachingNote.findById(id).lean()) as unknown as ITeachingNote | null;
  if (!doc) throw new Error("নোটটি পাওয়া যায়নি");
  const allowed = await teachingNoteVisibility(ctx);
  assertMayRead(allowed, doc.classLevel, doc.subject);
  const names = await uploaderNames([doc]);
  const counts = await commentCountsFor([doc]);
  return shape(doc, names.get(doc.uploadedBy.toString()) ?? null, true, counts.get(identityKey(doc)));
}

/**
 * Every version of one note's identity, newest first — the history strip. The
 * superseded rows are retained (never deleted), so "what did v1 say before the
 * feedback landed?" stays answerable.
 */
export async function teachingNoteVersions(
  ctx: AppContext,
  id: string,
): Promise<TeachingNoteShape[]> {
  if (!Types.ObjectId.isValid(id)) throw new Error("নোটটি পাওয়া যায়নি");
  const doc = (await TeachingNote.findById(id)
    .select("classLevel subject kind seq")
    .lean()) as unknown as ITeachingNote | null;
  if (!doc) throw new Error("নোটটি পাওয়া যায়নি");
  const allowed = await teachingNoteVisibility(ctx);
  assertMayRead(allowed, doc.classLevel, doc.subject);

  const rows = (await TeachingNote.find({
    classLevel: doc.classLevel,
    subject: doc.subject,
    kind: doc.kind,
    seq: doc.seq ?? 1,
  })
    .select("-contentMd")
    .lean()) as unknown as ITeachingNote[];
  const names = await uploaderNames(rows);
  return rows
    .sort((a, b) => b.version - a.version)
    .map((r) => shape(r, names.get(r.uploadedBy.toString()) ?? null, false));
}

/**
 * Read gate for a `teaching_note` StoredFile — GET /files/:id dispatches here.
 * The file carries no class/subject back-reference, so reverse-resolve the
 * owning note (original OR converted pdf) and apply the same pair scope.
 */
export async function assertTeachingNoteFileReadAccess(
  ctx: AppContext,
  file: { _id: { toString(): string } },
): Promise<void> {
  const doc = (await TeachingNote.findOne({
    $or: [{ fileId: file._id }, { pdfFileId: file._id }],
  })
    .select("classLevel subject")
    .lean()) as unknown as { classLevel: number; subject: string } | null;
  if (!doc) throw new ForbiddenError("অনুমতি নেই");
  const allowed = await teachingNoteVisibility(ctx);
  assertMayRead(allowed, doc.classLevel, doc.subject);
}

// ---------------------------------------------------------------------------
// Upload / replace
// ---------------------------------------------------------------------------

export interface UploadTeachingNoteInput {
  classLevel: number;
  subject: string;
  kind: string;
  seq?: number | null;
  title: string;
  format?: string | null;
  contentMd?: string | null;
  fileId?: string | null;
  pdfFileId?: string | null;
  fileName?: string | null;
  fileMime?: string | null;
  actorId: string;
  actorRole?: string;
}

export interface TeachingNoteUploadResult {
  note: TeachingNoteShape;
  /** The version this upload replaced, when an older row existed. */
  replacedVersion: number | null;
  /** Open comments carried over from the replaced version (TN-2). */
  openCommentCount: number;
}

/**
 * Create or REPLACE the note at (classLevel, subject, kind, seq). The previous
 * unreplaced row is stamped `replacedAt` and retained; the new row's `version`
 * is SERVER-ASSIGNED as prev.version + 1 — the uploader cannot mis-number the
 * history, and there is no way to overwrite an existing version in place.
 */
export async function uploadTeachingNote(
  input: UploadTeachingNoteInput,
): Promise<TeachingNoteUploadResult> {
  if (
    !Number.isInteger(input.classLevel) ||
    !(ROSTER_CLASS_LEVELS as readonly number[]).includes(input.classLevel)
  ) {
    throw new Error("শ্রেণি সঠিক নয়");
  }
  if (!(ROUTINE_SUBJECTS as readonly string[]).includes(input.subject)) {
    throw new Error("বিষয় সঠিক নয়");
  }
  if (!(TEACHING_NOTE_KINDS as readonly string[]).includes(input.kind)) {
    throw new Error(`নোটের ধরন সঠিক নয় (${TEACHING_NOTE_KINDS.join("/")})`);
  }
  const seq = input.seq ?? 1;
  if (!Number.isInteger(seq) || seq < 1) throw new Error("ক্রমিক নম্বর দিন (১ বা তার বেশি)");

  const title = input.title.trim();
  if (title === "") throw new Error("শিরোনাম লিখুন");
  assertNotMojibake(title);

  const format = (input.format ?? "MD") as TeachingNoteFormat;
  if (!(TEACHING_NOTE_FORMATS as readonly string[]).includes(format)) {
    throw new Error("ফাইলের ধরন সঠিক নয় (MD/PDF/DOCX)");
  }

  const contentMd = input.contentMd ?? "";
  let fileId: Types.ObjectId | null = null;
  let pdfFileId: Types.ObjectId | null = null;

  if (format === "MD") {
    if (contentMd.trim() === "") throw new Error("ফাইলটি খালি — কনটেন্ট পাওয়া যায়নি");
    if (Buffer.byteLength(contentMd, "utf8") > TEACHING_NOTE_MD_MAX_BYTES) {
      throw new Error("ফাইলটি খুব বড় (সর্বোচ্চ ১ MB)");
    }
    // The guard that matters (PRD §5) — every seed document arrived mojibake.
    assertNotMojibake(contentMd);
  } else {
    if (!input.fileId) throw new Error("ফাইলটি আপলোড হয়নি — আবার চেষ্টা করুন");
    const stored = await StoredFile.findById(input.fileId).select("kind").lean();
    if (!stored || stored.kind !== "teaching_note") {
      throw new Error("ফাইলটি খুঁজে পাওয়া যায়নি");
    }
    fileId = new Types.ObjectId(input.fileId);
    if (input.pdfFileId) {
      const pdfStored = await StoredFile.findById(input.pdfFileId).select("kind").lean();
      if (pdfStored && pdfStored.kind === "teaching_note") {
        pdfFileId = new Types.ObjectId(input.pdfFileId);
      }
    }
  }

  const prev = await TeachingNote.findOne({
    classLevel: input.classLevel,
    subject: input.subject,
    kind: input.kind,
    seq,
    replacedAt: null,
  });
  if (prev) {
    prev.replacedAt = new Date();
    await prev.save();
  }

  const doc = await TeachingNote.create({
    classLevel: input.classLevel,
    subject: input.subject as RoutineSubject,
    kind: input.kind as TeachingNoteKind,
    seq,
    title,
    version: prev ? prev.version + 1 : 1,
    format,
    contentMd: format === "MD" ? contentMd : "",
    fileId,
    pdfFileId,
    fileName: format === "MD" ? null : input.fileName ?? null,
    fileMime: format === "MD" ? null : input.fileMime ?? null,
    uploadedBy: input.actorId,
  });

  await writeAudit({
    eventKind: prev ? "TEACHING_NOTE_REPLACED" : "TEACHING_NOTE_UPLOADED",
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetId: doc._id,
    targetKind: "TeachingNote",
    meta: {
      classLevel: input.classLevel,
      subject: input.subject,
      kind: input.kind,
      seq,
      version: doc.version,
      format,
      ...(prev ? { prevVersion: prev.version } : {}),
    },
  });

  const counts = await commentCountsFor([doc as unknown as ITeachingNote]);
  return {
    note: shape(doc as unknown as ITeachingNote, null, false, counts.get(identityKey(doc as unknown as ITeachingNote))),
    replacedVersion: prev ? prev.version : null,
    openCommentCount: counts.get(identityKey(doc as unknown as ITeachingNote))?.open ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Comment counts — the badge on every library row. TN-2 supplies the real
// implementation; TN-1 ships the seam so the shape never changes under the app.
// ---------------------------------------------------------------------------

/** The identity a comment thread anchors to (D-#516) — NOT the version row. */
export function identityKey(doc: {
  classLevel: number;
  subject: string;
  kind: string;
  seq?: number;
}): string {
  return `${doc.classLevel}:${doc.subject}:${doc.kind}:${doc.seq ?? 1}`;
}

export async function commentCountsFor(
  _docs: Array<{ classLevel: number; subject: string; kind: string; seq?: number }>,
): Promise<Map<string, { total: number; open: number }>> {
  // TN-2 replaces this with a grouped count over TeachingNoteComment.
  return new Map();
}
