/**
 * EnglishDriveService — the English Drive materials module (D-#344): upload
 * (create/replace) + the class-scoped library reads.
 *
 * Visibility (PRD §5, no new permission):
 *  - Upload/replace ride `roster:manage` (checked in the resolver).
 *  - A TEACHER sees class N's set when they have an ENG involvement in any
 *    section of class N — resolved from the same scope machinery the trackers
 *    use (the `allowedSubjectCodesForSection` pattern, walked once per request
 *    and mapped to class levels instead of per-section subject codes).
 *  - Principal/Office read all classes. GUARDIAN has no path.
 *
 * All uploads/replaces audited (ADR-008). Errors are Bangla (they surface in
 * the app as-is).
 */
import { Types } from "mongoose";
import type { PrintPurpose } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError, resolveTeacherScopes } from "../../../middleware/authz";
import { markdownToPdf } from "../../../routes/pdfRenderer";
import { Subject } from "../../foundation/models/Subject";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { StoredFile } from "../../platform/models/StoredFile";
import { uploadToDrive, DriveUnavailableError } from "../../platform/services/DriveStore";
import { createPrintRequest } from "../../printing/services/PrintRequestService";
import {
  EnglishDriveDoc,
  ENGLISH_DRIVE_KINDS,
  ENGLISH_DRIVE_FORMATS,
  ENGLISH_DRIVE_MD_MAX_BYTES,
  type EnglishDriveKind,
  type EnglishDriveFormat,
  type IEnglishDriveDoc,
} from "../models/EnglishDriveDoc";

/** The content axis this module covers — C1..C5 (no Nursery/KG). */
export const ENGLISH_DRIVE_CLASS_LEVELS = [1, 2, 3, 4, 5] as const;

export interface EnglishDriveDocShape {
  id: string;
  classLevel: number;
  /** Null = block-less (assignments are week-scoped, D-#346; PT uses blockNumbers). */
  blockNumber: number | null;
  /** The blocks a PT covers (D-#347); [] for every other kind. */
  blockNumbers: number[];
  kind: string;
  seq: number;
  title: string;
  version: number;
  /** MD (markdown in contentMd) | PDF | DOCX (binary in fileId). Legacy rows = MD. */
  format: string;
  /** The ORIGINAL binary StoredFile id (PDF/DOCX) — the download; null for MD. */
  fileId: string | null;
  /** For a DOCX doc: the converted PDF StoredFile — previews + prints (owner 2026-07-25).
   *  Null for PDF/MD and for a DOCX whose conversion failed (fall back to fileId). */
  pdfFileId: string | null;
  fileName: string | null;
  fileMime: string | null;
  uploadedAt: string;
  uploadedByName: string | null;
  /** Null on library-list rows — only the single-doc read carries the markdown. */
  contentMd: string | null;
}

function shape(
  doc: IEnglishDriveDoc,
  uploadedByName: string | null,
  withContent: boolean,
): EnglishDriveDocShape {
  return {
    id: doc._id.toString(),
    classLevel: doc.classLevel,
    blockNumber: doc.blockNumber ?? null,
    blockNumbers: doc.blockNumbers ?? [],
    kind: doc.kind,
    seq: doc.seq ?? 1, // pre-seq rows have no field
    title: doc.title,
    version: doc.version,
    format: doc.format ?? "MD", // legacy rows have no field
    fileId: doc.fileId ? doc.fileId.toString() : null,
    pdfFileId: doc.pdfFileId ? doc.pdfFileId.toString() : null,
    fileName: doc.fileName ?? null,
    fileMime: doc.fileMime ?? null,
    uploadedAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : "",
    uploadedByName,
    contentMd: withContent ? doc.contentMd : null,
  };
}

/**
 * The class levels (1..5) whose English Drive set the caller may read, or
 * `null` for unrestricted (Principal/Office; whole-school or English-department
 * supervisors). GUARDIAN always throws — there is no guardian path (PRD §5).
 *
 * A teacher's set is derived from their scope union: teaching/proxy grants
 * whose subject is English (a subject-less legacy proxy counts — it covers the
 * whole section), grade_class supervisory scopes (that class), and
 * explicit_set entries naming English. Class ids map to levels; levels outside
 * 1..5 (Nursery/KG) are dropped — the Drive has no documents there.
 */
export async function allowedEnglishDriveClassLevels(
  ctx: AppContext,
): Promise<Set<number> | null> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role === "PRINCIPAL" || ctx.auth.role === "OFFICE") return null;
  if (ctx.auth.role !== "TEACHER") {
    throw new ForbiddenError("ইংরেজি ড্রাইভ দেখার অনুমতি নেই");
  }

  const engSubjects = (await Subject.find({ code: "ENG" })
    .select("_id")
    .lean()) as unknown as Array<{ _id: Types.ObjectId }>;
  const engIds = new Set(engSubjects.map((s) => s._id.toString()));

  const scopes = await resolveTeacherScopes(ctx);
  const classIds = new Set<string>();
  for (const s of scopes) {
    if (s.kind === "teaching") {
      if (engIds.has(s.subjectId)) classIds.add(s.classId);
    } else if (s.kind === "proxy") {
      // A pre-D-#257 subject-less proxy covers the whole section, English included.
      if (!s.subjectId || engIds.has(s.subjectId)) classIds.add(s.classId);
    } else if (s.kind === "supervisory") {
      switch (s.extent) {
        case "whole_school":
          return null;
        case "grade_class":
          if (s.classId) classIds.add(s.classId);
          break;
        case "subject_dept":
          if (s.subjectId && engIds.has(s.subjectId)) return null;
          break;
        case "explicit_set":
          for (const e of s.explicitSet ?? []) {
            if (engIds.has(e.subjectId)) classIds.add(e.classId);
          }
          break;
      }
    }
  }

  if (classIds.size === 0) return new Set();
  const classes = (await Class.find({ _id: { $in: [...classIds] } })
    .select("level")
    .lean()) as unknown as Array<{ level: number }>;
  return new Set(classes.map((c) => c.level).filter((l) => l >= 1 && l <= 5));
}

/** The caller's class levels for the app (drawer gate + class picker). Guardian → []. */
export async function myEnglishDriveClassLevels(ctx: AppContext): Promise<number[]> {
  if (!ctx.auth || ctx.auth.role === "GUARDIAN") return [];
  const allowed = await allowedEnglishDriveClassLevels(ctx);
  if (allowed === null) return [...ENGLISH_DRIVE_CLASS_LEVELS];
  return [...allowed].sort((a, b) => a - b);
}

async function uploaderNames(rows: IEnglishDriveDoc[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(rows.map((r) => r.uploadedBy.toString()))];
  if (ids.length === 0) return new Map();
  const users = (await User.find({ _id: { $in: ids } })
    .select("name")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name?: string }>;
  return new Map(users.map((u) => [u._id.toString(), u.name ?? null]));
}

const kindOrder = (k: string): number => {
  const i = (ENGLISH_DRIVE_KINDS as readonly string[]).indexOf(k);
  return i === -1 ? ENGLISH_DRIVE_KINDS.length : i;
};

/**
 * The library list — the LATEST (unreplaced) doc of every (class, block, kind)
 * the caller may see, metadata only. Optional classLevel narrows to one class
 * (denied when outside the caller's scope).
 */
export async function englishDriveDocs(
  ctx: AppContext,
  classLevel?: number | null,
): Promise<EnglishDriveDocShape[]> {
  const allowed = await allowedEnglishDriveClassLevels(ctx);

  const filter: Record<string, unknown> = { replacedAt: null };
  if (classLevel !== undefined && classLevel !== null) {
    if (allowed !== null && !allowed.has(classLevel)) {
      throw new ForbiddenError("এই শ্রেণির ইংরেজি ড্রাইভ দেখার অনুমতি নেই");
    }
    filter.classLevel = classLevel;
  } else if (allowed !== null) {
    filter.classLevel = { $in: [...allowed] };
  }

  const rows = (await EnglishDriveDoc.find(filter)
    .select("-contentMd")
    .lean()) as unknown as IEnglishDriveDoc[];
  const names = await uploaderNames(rows);

  return rows
    .sort(
      (a, b) =>
        a.classLevel - b.classLevel ||
        // Block-less docs (assignments) group after the numbered blocks.
        (a.blockNumber ?? Infinity) - (b.blockNumber ?? Infinity) ||
        kindOrder(a.kind) - kindOrder(b.kind) ||
        (a.seq ?? 1) - (b.seq ?? 1),
    )
    .map((r) => shape(r, names.get(r.uploadedBy.toString()) ?? null, false));
}

/**
 * Read gate for an `english_drive` StoredFile (owner 2026-07-25) — GET /files/:id
 * dispatches here. The file carries no class back-reference, so reverse-resolve
 * the owning EnglishDriveDoc and apply the same class-scope as the doc screen.
 */
export async function assertEnglishDriveFileReadAccess(
  ctx: AppContext,
  file: { _id: { toString(): string } },
): Promise<void> {
  // The file may be the original (fileId) OR the converted PDF (pdfFileId).
  const doc = (await EnglishDriveDoc.findOne({ $or: [{ fileId: file._id }, { pdfFileId: file._id }] })
    .select("classLevel")
    .lean()) as unknown as { classLevel: number } | null;
  if (!doc) throw new ForbiddenError("অনুমতি নেই");
  const allowed = await allowedEnglishDriveClassLevels(ctx);
  if (allowed !== null && !allowed.has(doc.classLevel)) {
    throw new ForbiddenError("এই শ্রেণির ইংরেজি ড্রাইভ দেখার অনুমতি নেই");
  }
}

/** One document WITH its markdown — the doc screen + PDF read. Scope-checked. */
export async function englishDriveDocById(
  ctx: AppContext,
  id: string,
): Promise<EnglishDriveDocShape> {
  const doc = (await EnglishDriveDoc.findById(id).lean()) as unknown as IEnglishDriveDoc | null;
  if (!doc) throw new Error("ডকুমেন্টটি পাওয়া যায়নি");
  const allowed = await allowedEnglishDriveClassLevels(ctx);
  if (allowed !== null && !allowed.has(doc.classLevel)) {
    throw new ForbiddenError("এই শ্রেণির ইংরেজি ড্রাইভ দেখার অনুমতি নেই");
  }
  const names = await uploaderNames([doc]);
  return shape(doc, names.get(doc.uploadedBy.toString()) ?? null, true);
}

/** Compact block tag for filenames/stamps: "B3-5" (contiguous) / "B3,5" (list) /
 *  "B3" (single) / "" (block-less). Shared by the print stamp + the PDF route (D-#347). */
export function formatBlockTag(doc: {
  blockNumber: number | null;
  blockNumbers?: number[] | null;
}): string {
  const many = doc.blockNumbers ?? [];
  if (many.length > 0) {
    const b = [...new Set(many)].sort((x, y) => x - y);
    const contiguous = b.length > 1 && b.length === b[b.length - 1] - b[0] + 1;
    return contiguous ? `B${b[0]}-${b[b.length - 1]}` : `B${b.join(",")}`;
  }
  return doc.blockNumber === null ? "" : `B${doc.blockNumber}`;
}

export interface UploadEnglishDriveDocInput {
  classLevel: number;
  /** Optional for AS (week-scoped, D-#346); required for every other kind. Always
   *  null for PT — a practice test uses `blockNumbers` (D-#347). */
  blockNumber?: number | null;
  /** The blocks a PT covers (D-#347) — required (1+) for PT, ignored otherwise. */
  blockNumbers?: number[] | null;
  kind: string;
  /** Sequence within (block × kind), e.g. HW4 → 4. Defaults to 1. */
  seq?: number | null;
  title: string;
  version: number;
  /** MD (default) | PDF | DOCX (owner 2026-07-25). */
  format?: string | null;
  /** Required for MD; empty for PDF/DOCX. */
  contentMd?: string | null;
  /** Required for PDF/DOCX (a StoredFile of kind `english_drive`); ignored for MD. */
  fileId?: string | null;
  /** DOCX only: the converted PDF StoredFile id (from /files/english-drive). */
  pdfFileId?: string | null;
  fileName?: string | null;
  fileMime?: string | null;
  actorId: string;
  actorRole?: string;
}

export interface EnglishDriveUploadResult {
  doc: EnglishDriveDocShape;
  /** The version this upload replaced, when an older (class, block, kind) row existed. */
  replacedVersion: number | null;
}

export async function uploadEnglishDriveDoc(
  input: UploadEnglishDriveDocInput,
): Promise<EnglishDriveUploadResult> {
  if (!Number.isInteger(input.classLevel) || input.classLevel < 1 || input.classLevel > 5) {
    throw new Error("শ্রেণি ১ থেকে ৫ এর মধ্যে দিন");
  }
  if (!(ENGLISH_DRIVE_KINDS as readonly string[]).includes(input.kind)) {
    throw new Error(`ডকুমেন্টের ধরন সঠিক নয় (${ENGLISH_DRIVE_KINDS.join("/")})`);
  }
  // Block rules by kind:
  //  - PT covers 1+ blocks (D-#347): scalar block is null, blockNumbers drives surfacing.
  //  - AS is week-scoped (D-#346): block-less.
  //  - every other kind lives inside exactly one block.
  let blockNumber = input.blockNumber ?? null;
  let blockNumbers: number[] = [];
  if (input.kind === "PT") {
    const clean = [...new Set(input.blockNumbers ?? [])]
      .filter((b) => Number.isInteger(b) && b >= 1)
      .sort((a, b) => a - b);
    if (clean.length === 0) {
      throw new Error("প্র্যাকটিস টেস্ট কোন কোন ব্লকের সাথে যুক্ত তা দিন (এক বা একাধিক)");
    }
    blockNumbers = clean;
    blockNumber = null; // never keyed on the block set — PT identity is (class, PT, seq)
  } else if (blockNumber === null) {
    if (input.kind !== "AS") throw new Error("ব্লক নম্বর দিন (১ বা তার বেশি)");
  } else if (!Number.isInteger(blockNumber) || blockNumber < 1) {
    throw new Error("ব্লক নম্বর দিন (১ বা তার বেশি)");
  }
  const seq = input.seq ?? 1;
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error("ক্রমিক নম্বর দিন (১ বা তার বেশি)");
  }
  const title = input.title.trim();
  if (title === "") throw new Error("শিরোনাম লিখুন");
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new Error("ভার্সন নম্বর দিন (১ বা তার বেশি)");
  }
  // Format gate (owner 2026-07-25): MD carries markdown; PDF/DOCX carry a binary
  // StoredFile id (uploaded via /files/english-drive) and no markdown.
  const format = (input.format ?? "MD") as EnglishDriveFormat;
  if (!(ENGLISH_DRIVE_FORMATS as readonly string[]).includes(format)) {
    throw new Error("ফাইলের ধরন সঠিক নয় (MD/PDF/DOCX)");
  }
  const contentMd = input.contentMd ?? "";
  let fileId: Types.ObjectId | null = null;
  let pdfFileId: Types.ObjectId | null = null;
  if (format === "MD") {
    if (contentMd.trim() === "") throw new Error("ফাইলটি খালি — কনটেন্ট পাওয়া যায়নি");
    if (Buffer.byteLength(contentMd, "utf8") > ENGLISH_DRIVE_MD_MAX_BYTES) {
      throw new Error("ফাইলটি খুব বড় (সর্বোচ্চ ১ MB)");
    }
  } else {
    if (!input.fileId) throw new Error("ফাইলটি আপলোড হয়নি — আবার চেষ্টা করুন");
    const stored = await StoredFile.findById(input.fileId).select("kind").lean();
    if (!stored || stored.kind !== "english_drive") {
      throw new Error("ফাইলটি খুঁজে পাওয়া যায়নি");
    }
    fileId = new Types.ObjectId(input.fileId);
    // DOCX carries the converted PDF (owner 2026-07-25) — validate it's ours too.
    if (input.pdfFileId) {
      const pdfStored = await StoredFile.findById(input.pdfFileId).select("kind").lean();
      if (pdfStored && pdfStored.kind === "english_drive") pdfFileId = new Types.ObjectId(input.pdfFileId);
    }
  }

  const prev = await EnglishDriveDoc.findOne({
    classLevel: input.classLevel,
    blockNumber, // null matches missing = the block-less identity
    kind: input.kind,
    // Pre-seq rows carry no seq field — they are identity seq 1 ({seq: null}
    // matches missing in Mongo).
    seq: seq === 1 ? { $in: [1, null] } : seq,
    replacedAt: null,
  });
  if (prev) {
    prev.replacedAt = new Date();
    await prev.save();
  }

  const doc = await EnglishDriveDoc.create({
    classLevel: input.classLevel,
    blockNumber,
    blockNumbers,
    kind: input.kind as EnglishDriveKind,
    seq,
    title,
    version: input.version,
    format,
    contentMd: format === "MD" ? contentMd : "",
    fileId,
    pdfFileId,
    fileName: format === "MD" ? null : input.fileName ?? null,
    fileMime: format === "MD" ? null : input.fileMime ?? null,
    uploadedBy: input.actorId,
  });

  await writeAudit({
    eventKind: prev ? "ENGLISH_DRIVE_REPLACED" : "ENGLISH_DRIVE_UPLOADED",
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetId: doc._id,
    targetKind: "EnglishDriveDoc",
    meta: {
      classLevel: input.classLevel,
      blockNumber,
      ...(blockNumbers.length > 0 ? { blockNumbers } : {}),
      kind: input.kind,
      seq,
      version: input.version,
      ...(prev ? { prevVersion: prev.version } : {}),
    },
  });

  return { doc: shape(doc, null, false), replacedVersion: prev ? prev.version : null };
}

// ---------------------------------------------------------------------------
// ED-2 — send to print (PRD §6): render the PDF server-side, store it as a
// print_upload StoredFile owned by the caller, and file it through the EXISTING
// createPrintRequest path. The office queue, PRINTED/DELIVERED logging,
// notifications and the /files read-gate (uploader OR roster:manage) all apply
// untouched — no new source type, no vocab change, no waiver: the file IS a
// print_upload uploaded by the requester, so assertSourceResolves passes as-is.
// ---------------------------------------------------------------------------

/** Queue-purpose per document kind — the label the Office sees on the row. */
const KIND_PRINT_PURPOSE: Record<EnglishDriveKind, PrintPurpose> = {
  BLOCK: "LESSON_PLAN",
  TN: "LESSON_PLAN",
  CW: "CLASSWORK",
  HW: "HOMEWORK",
  PT: "CLASS_TEST",
  AS: "ASSIGNMENT",
  CLUE: "LESSON_PLAN",
};

export interface SendEnglishDriveToPrintInput {
  id: string;
  colour: string;
  sides: string;
  copies: number;
  /** D-#294 print flow (owner 2026-07-25): FIXED = typed count; CLASS_PRESENT =
   *  one per student present in `copiesClassId` on the `neededByKey` use day. */
  copiesMode?: string | null;
  copiesClassId?: string | null;
  /** The day the print will be USED (YYYY-MM-DD) — required at the resolver. */
  neededByKey?: string | null;
  /** Edit-before-print (D-#348): the teacher's edited markdown + layout knobs.
   *  When contentMd is given, the printed PDF renders THAT (falling back to the
   *  stored doc otherwise); the read gate on `id` still applies. */
  contentMd?: string | null;
  fontScale?: number | null;
  lineSpacing?: number | null;
  margin?: number | null;
}

export interface EnglishDrivePrintResult {
  printRequestId: string;
  title: string;
}

export async function sendEnglishDriveDocToPrint(
  ctx: AppContext,
  input: SendEnglishDriveToPrintInput,
): Promise<EnglishDrivePrintResult> {
  // Same read gate as the doc screen: teacher of the class or P/O; guardian never.
  const doc = await englishDriveDocById(ctx, input.id);

  const kindTag = doc.seq > 1 ? `${doc.kind}${doc.seq}` : doc.kind;
  const blockTag = formatBlockTag(doc);
  const stamp = `C${doc.classLevel}${blockTag ? `_${blockTag}` : ""}_${kindTag}_v${doc.version}`;
  const title = `English Drive ${stamp} — ${doc.title}`.slice(0, 200);

  // A PDF/DOCX doc (owner 2026-07-25) is already a print-ready binary — file the
  // STORED english_drive file to the queue directly (no pdfkit render). `trusted`
  // skips the print_upload-kind check (the class-test precedent, D-#342): the file
  // was office-uploaded through /files/english-drive and the caller passed the
  // doc read gate above; the office reads it via the english_drive /files gate.
  if ((doc.format ?? "MD") !== "MD") {
    // Prefer the converted PDF (DOCX); a PDF doc's fileId already IS the pdf.
    const printFileId = doc.pdfFileId ?? doc.fileId;
    if (!printFileId) throw new Error("ফাইলটি খুঁজে পাওয়া যায়নি");
    const req = await createPrintRequest({
      title,
      purpose: KIND_PRINT_PURPOSE[doc.kind as EnglishDriveKind] ?? "OTHER",
      sourceType: "UPLOAD",
      fileIds: [printFileId],
      colour: input.colour,
      sides: input.sides,
      copies: input.copies,
      copiesMode: input.copiesMode ?? undefined,
      copiesClassId: input.copiesClassId ?? undefined,
      neededByKey: input.neededByKey ?? undefined,
      subject: "ENG",
      requestedBy: ctx.auth!.userId as string,
      trusted: true,
    });
    return { printRequestId: req._id.toString(), title: req.title };
  }

  // Print the edited version when supplied (D-#348), else the stored markdown.
  const source = input.contentMd != null && input.contentMd.trim() !== "" ? input.contentMd : doc.contentMd ?? "";
  if (Buffer.byteLength(source, "utf8") > ENGLISH_DRIVE_MD_MAX_BYTES) {
    throw new Error("ফাইলটি খুব বড় (সর্বোচ্চ ১ MB)");
  }
  const pdf = await markdownToPdf(source, {
    title,
    fontScale: input.fontScale ?? undefined,
    lineSpacing: input.lineSpacing ?? undefined,
    margin: input.margin ?? undefined,
  });

  let driveFileId: string;
  try {
    driveFileId = await uploadToDrive({
      name: `english_drive_${stamp}.pdf`,
      mime: "application/pdf",
      data: pdf,
      year: String(new Date().getFullYear()),
      subfolder: "print",
    });
  } catch (e) {
    if (e instanceof DriveUnavailableError) {
      throw new Error("ফাইল স্টোরেজ এখন উপলব্ধ নয় — একটু পরে আবার চেষ্টা করুন");
    }
    throw e;
  }
  const stored = await StoredFile.create({
    kind: "print_upload",
    mime: "application/pdf",
    sizeBytes: pdf.byteLength,
    originalName: `english_drive_${stamp}.pdf`,
    driveFileId,
    uploadedBy: ctx.auth!.userId,
  });

  const req = await createPrintRequest({
    title,
    purpose: KIND_PRINT_PURPOSE[doc.kind as EnglishDriveKind] ?? "OTHER",
    sourceType: "UPLOAD",
    fileIds: [stored._id.toString()],
    colour: input.colour,
    sides: input.sides,
    copies: input.copies,
    copiesMode: input.copiesMode ?? undefined,
    copiesClassId: input.copiesClassId ?? undefined,
    neededByKey: input.neededByKey ?? undefined,
    subject: "ENG",
    requestedBy: ctx.auth!.userId as string,
  });
  return { printRequestId: req._id.toString(), title: req.title };
}
