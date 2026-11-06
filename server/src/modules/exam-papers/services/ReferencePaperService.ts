/**
 * ReferencePaperService — other branches' past papers (D-#1030, docs/prd-exam-paper-bank.md §4).
 *
 *  - Upload (exam_papers:manage_reference): a PDF (rendered to page JPEGs in the background,
 *    StoredFile kind `reference_paper_page`) plus, optionally, the original file the teacher
 *    typed (`reference_paper_source`, usually a .docx). Without an original, the PDF itself is
 *    kept as the source so there is always something to download.
 *  - Read (exam_papers:view_reference | manage_reference): the shelf, one page at a time as a
 *    data URI, and GET /files/:id for the original — the same gate guards both file kinds.
 *
 * Staff-only. Pages are cached in memory (bounded), as class book pages are.
 */
import crypto from "node:crypto";
import { Types } from "mongoose";
import { EXAM_TERMS, ROSTER_CLASS_LABELS_BN, ROSTER_CLASS_LEVEL_MAX, ROSTER_CLASS_LEVEL_MIN, callerHasPermission } from "@scd/shared";
import type { ExamTerm, RosterClassLevel } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { StoredFile } from "../../platform/models/StoredFile";
import { deleteFromDrive, downloadFromDrive, uploadToDrive } from "../../platform/services/DriveStore";
import { writeAudit } from "../../platform/services/AuditService";
import { jpegSize, renderPdfPages } from "../../class-books/services/pdfPages";
import { ReferencePaper, REFERENCE_BRANCHES, type IReferencePaper, type ReferenceBranch } from "../models/ReferencePaper";

export const REFERENCE_PAPER_MAX_BYTES = 40 * 1024 * 1024;
const STALE_PROCESSING_MS = 30 * 60 * 1000;
const PAGE_CACHE_MAX_BYTES = 60 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 4;

export const REFERENCE_SOURCE_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
] as const;

export const REFERENCE_PAPER_ERRORS_BN = {
  forbidden: "এই প্রশ্নপত্র দেখার অনুমতি নেই",
  notFound: "প্রশ্নপত্রটি পাওয়া যায়নি",
  notReady: "প্রশ্নপত্রটি এখনও তৈরি হচ্ছে — একটু পরে আবার চেষ্টা করুন",
  badPage: "এই পৃষ্ঠাটি প্রশ্নপত্রে নেই",
  badMime: "পৃষ্ঠা দেখানোর জন্য একটি PDF ফাইল দিন",
  badSourceMime: "মূল ফাইল PDF বা Word (.docx) হতে হবে",
  tooLarge: "ফাইলের আকার সর্বোচ্চ ৪০ মেগাবাইট",
  badClass: "সঠিক শ্রেণি বাছাই করুন",
  badTerm: "পরীক্ষা (অর্ধ-বার্ষিক / বার্ষিক) বাছাই করুন",
  badYear: "সঠিক সাল লিখুন",
  badSubject: "বিষয় লিখুন",
  badTitle: "প্রশ্নপত্রের নাম লিখুন",
  renderFailed: "PDF থেকে পৃষ্ঠা তৈরি করা যায়নি — ফাইলটি ঠিক আছে কি না দেখে আবার আপলোড করুন",
  stale: "পৃষ্ঠা তৈরি মাঝপথে থেমে গেছে — প্রশ্নপত্রটি মুছে আবার আপলোড করুন",
} as const;

export interface ReferencePaperShape {
  id: string;
  branch: string;
  term: string;
  year: number;
  classLevel: number | null;
  classLabelBn: string | null;
  subject: string;
  title: string;
  status: string;
  error: string | null;
  pageCount: number;
  pageAspect: number;
  sourceFileId: string | null;
  sourceName: string;
  createdAt: string;
}

export interface ReferencePaperPageShape {
  paperId: string;
  page: number;
  pageCount: number;
  dataUri: string;
}

function shape(p: IReferencePaper, now = Date.now()): ReferencePaperShape {
  const stale = p.status === "PROCESSING" && now - new Date(p.updatedAt).getTime() > STALE_PROCESSING_MS;
  const level = p.classLevel ?? null;
  return {
    id: p._id.toString(),
    branch: p.branch,
    term: p.term,
    year: p.year,
    classLevel: level,
    classLabelBn: level === null ? null : (ROSTER_CLASS_LABELS_BN[level as RosterClassLevel] ?? String(level)),
    subject: p.subject,
    title: p.title,
    status: stale ? "FAILED" : p.status,
    error: stale ? REFERENCE_PAPER_ERRORS_BN.stale : (p.error ?? null),
    pageCount: p.pageCount ?? 0,
    pageAspect: p.pageAspect ?? 1.414,
    sourceFileId: p.sourceFileId ? p.sourceFileId.toString() : null,
    sourceName: p.sourceName ?? "",
    createdAt: new Date(p.createdAt).toISOString(),
  };
}

/** Newest year first, half-yearly before annual inside a year, then class, subject, title. */
const byShelfOrder = (a: IReferencePaper, b: IReferencePaper) =>
  b.year - a.year ||
  EXAM_TERMS.indexOf(a.term) - EXAM_TERMS.indexOf(b.term) ||
  (a.classLevel ?? 99) - (b.classLevel ?? 99) ||
  a.subject.localeCompare(b.subject) ||
  a.title.localeCompare(b.title);

function canRead(ctx: AppContext): boolean {
  return (
    !!ctx.auth &&
    (callerHasPermission(ctx.auth, "exam_papers:view_reference") || callerHasPermission(ctx.auth, "exam_papers:manage_reference"))
  );
}

function validClassLevel(level: unknown): level is number {
  return Number.isInteger(level) && (level as number) >= ROSTER_CLASS_LEVEL_MIN && (level as number) <= ROSTER_CLASS_LEVEL_MAX;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ReferencePaperFilter {
  year?: number | null;
  term?: string | null;
  classLevel?: number | null;
}

export async function referencePapers(filter: ReferencePaperFilter = {}): Promise<ReferencePaperShape[]> {
  const q: Record<string, unknown> = {};
  if (filter.year) q.year = filter.year;
  if (filter.term) q.term = filter.term;
  if (filter.classLevel !== undefined && filter.classLevel !== null) q.classLevel = filter.classLevel;
  const rows = (await ReferencePaper.find(q).lean()) as unknown as IReferencePaper[];
  const now = Date.now();
  return rows.sort(byShelfOrder).map((p) => shape(p, now));
}

/** GET /files/:id gate for `reference_paper_page` / `reference_paper_source`. */
export async function assertReferencePaperFileReadAccess(ctx: AppContext, fileId: string): Promise<void> {
  if (!canRead(ctx)) throw new ForbiddenError(REFERENCE_PAPER_ERRORS_BN.forbidden);
  const id = new Types.ObjectId(fileId);
  const owner = await ReferencePaper.exists({ $or: [{ pageFileIds: id }, { sourceFileId: id }] });
  if (!owner) throw new ForbiddenError(REFERENCE_PAPER_ERRORS_BN.forbidden);
}

const pageCache = new Map<string, Buffer>();
let pageCacheBytes = 0;

function cacheGet(id: string): Buffer | undefined {
  const hit = pageCache.get(id);
  if (hit) {
    pageCache.delete(id);
    pageCache.set(id, hit);
  }
  return hit;
}

function cachePut(id: string, data: Buffer): void {
  if (data.byteLength > PAGE_CACHE_MAX_BYTES) return;
  pageCache.set(id, data);
  pageCacheBytes += data.byteLength;
  for (const [k, v] of pageCache) {
    if (pageCacheBytes <= PAGE_CACHE_MAX_BYTES) break;
    pageCache.delete(k);
    pageCacheBytes -= v.byteLength;
  }
}

export function clearReferencePageCache(): void {
  pageCache.clear();
  pageCacheBytes = 0;
}

export async function referencePaperPage(ctx: AppContext, paperId: string, page: number): Promise<ReferencePaperPageShape> {
  if (!canRead(ctx)) throw new ForbiddenError(REFERENCE_PAPER_ERRORS_BN.forbidden);
  if (!Types.ObjectId.isValid(paperId)) throw new Error(REFERENCE_PAPER_ERRORS_BN.notFound);
  const paper = (await ReferencePaper.findById(paperId).lean()) as unknown as IReferencePaper | null;
  if (!paper) throw new Error(REFERENCE_PAPER_ERRORS_BN.notFound);
  if (paper.status !== "READY") throw new Error(REFERENCE_PAPER_ERRORS_BN.notReady);
  if (!Number.isInteger(page) || page < 1 || page > paper.pageFileIds.length) throw new Error(REFERENCE_PAPER_ERRORS_BN.badPage);
  const fileId = paper.pageFileIds[page - 1].toString();
  let data = cacheGet(fileId);
  if (!data) {
    const file = await StoredFile.findById(fileId).lean();
    if (!file) throw new Error(REFERENCE_PAPER_ERRORS_BN.badPage);
    data = await downloadFromDrive(file.driveFileId);
    cachePut(fileId, data);
  }
  return { paperId, page, pageCount: paper.pageFileIds.length, dataUri: `data:image/jpeg;base64,${data.toString("base64")}` };
}

// ---------------------------------------------------------------------------
// Writes (exam_papers:manage_reference — checked by the route / resolvers)
// ---------------------------------------------------------------------------

export function validateReferenceUpload(pdfMime: string, pdfBytes: number, sourceMime?: string | null, sourceBytes?: number | null): string | null {
  if (pdfMime !== "application/pdf" || pdfBytes <= 0) return REFERENCE_PAPER_ERRORS_BN.badMime;
  if (pdfBytes > REFERENCE_PAPER_MAX_BYTES) return REFERENCE_PAPER_ERRORS_BN.tooLarge;
  if (sourceMime) {
    if (!(REFERENCE_SOURCE_MIMES as readonly string[]).includes(sourceMime)) return REFERENCE_PAPER_ERRORS_BN.badSourceMime;
    if ((sourceBytes ?? 0) > REFERENCE_PAPER_MAX_BYTES) return REFERENCE_PAPER_ERRORS_BN.tooLarge;
  }
  return null;
}

export interface ReferencePaperMeta {
  branch?: string | null;
  term: string;
  year: number;
  classLevel?: number | null;
  subject: string;
  title: string;
}

function checkMeta(m: ReferencePaperMeta): { branch: ReferenceBranch; term: ExamTerm; year: number; classLevel: number | null; subject: string; title: string } {
  const branch = (m.branch || "MOHAMMADPUR") as ReferenceBranch;
  if (!(REFERENCE_BRANCHES as readonly string[]).includes(branch)) throw new Error(REFERENCE_PAPER_ERRORS_BN.badTitle);
  if (!(EXAM_TERMS as readonly string[]).includes(m.term)) throw new Error(REFERENCE_PAPER_ERRORS_BN.badTerm);
  if (!Number.isInteger(m.year) || m.year < 2000 || m.year > 2100) throw new Error(REFERENCE_PAPER_ERRORS_BN.badYear);
  const classLevel = m.classLevel === undefined || m.classLevel === null ? null : m.classLevel;
  if (classLevel !== null && !validClassLevel(classLevel)) throw new Error(REFERENCE_PAPER_ERRORS_BN.badClass);
  const subject = (m.subject ?? "").trim().toUpperCase();
  if (!subject) throw new Error(REFERENCE_PAPER_ERRORS_BN.badSubject);
  const title = (m.title ?? "").trim();
  if (!title) throw new Error(REFERENCE_PAPER_ERRORS_BN.badTitle);
  return { branch, term: m.term as ExamTerm, year: m.year, classLevel, subject, title };
}

export interface StartReferenceUploadInput extends ReferencePaperMeta {
  actorId: string;
  pdf: Buffer;
  pdfName: string;
  source?: { data: Buffer; name: string; mime: string } | null;
}

export function sourceHashOf(data: Buffer): string {
  return crypto.createHash("sha1").update(data).digest("hex");
}

/** Has a paper with this original (by hash) already been loaded? Lets the import script skip it. */
export async function referencePaperByHash(hash: string): Promise<ReferencePaperShape | null> {
  const p = (await ReferencePaper.findOne({ sourceHash: hash }).lean()) as unknown as IReferencePaper | null;
  return p ? shape(p) : null;
}

/**
 * Create the paper row (PROCESSING), store the original, and render the PDF's pages in the
 * background. `done` settles when the pages are stored (tests await it; the route does not).
 */
export async function startReferencePaperUpload(
  input: StartReferenceUploadInput,
): Promise<{ paper: ReferencePaperShape; done: Promise<void> }> {
  const meta = checkMeta(input);
  const src = input.source ?? { data: input.pdf, name: input.pdfName, mime: "application/pdf" };
  const hash = sourceHashOf(src.data);
  const row = await ReferencePaper.create({
    ...meta,
    status: "PROCESSING",
    sourceName: src.name,
    sourceHash: hash,
    uploadedBy: new Types.ObjectId(input.actorId),
    pageFileIds: [],
  });
  await writeAudit({
    eventKind: "REFERENCE_PAPER_UPLOADED",
    actorId: input.actorId,
    targetId: row._id,
    targetKind: "ReferencePaper",
    meta: { ...meta, sourceName: src.name, sizeBytes: src.data.byteLength },
  });
  const done = renderReferencePaper(row._id.toString(), input.pdf, src, input.actorId, meta.title);
  return { paper: shape(row.toObject() as IReferencePaper), done };
}

async function renderReferencePaper(
  paperId: string,
  pdf: Buffer,
  src: { data: Buffer; name: string; mime: string },
  actorId: string,
  title: string,
): Promise<void> {
  const uploaded: string[] = [];
  try {
    let pages: Buffer[];
    try {
      pages = await renderPdfPages(pdf);
    } catch (e) {
      console.warn("reference paper render failed:", (e as Error)?.message);
      await ReferencePaper.updateOne({ _id: paperId }, { $set: { status: "FAILED", error: REFERENCE_PAPER_ERRORS_BN.renderFailed } });
      return;
    }
    const year = String(new Date().getFullYear());
    const srcDrive = await uploadToDrive({
      name: `${paperId}-source-${src.name}`,
      mime: src.mime,
      data: src.data,
      year,
      subfolder: "reference-papers",
      appProperties: { referencePaperId: paperId, role: "source" },
    });
    uploaded.push(srcDrive);
    const srcFile = await StoredFile.create({
      kind: "reference_paper_source",
      mime: src.mime,
      sizeBytes: src.data.byteLength,
      originalName: src.name,
      driveFileId: srcDrive,
      uploadedBy: actorId,
    });
    const size = jpegSize(pages[0]);
    const ids: Types.ObjectId[] = new Array(pages.length);
    let next = 0;
    const worker = async () => {
      while (next < pages.length) {
        const i = next++;
        const driveFileId = await uploadToDrive({
          name: `${paperId}-p${String(i + 1).padStart(3, "0")}.jpg`,
          mime: "image/jpeg",
          data: pages[i],
          year,
          subfolder: "reference-papers",
          appProperties: { referencePaperId: paperId, page: String(i + 1) },
        });
        uploaded.push(driveFileId);
        const stored = await StoredFile.create({
          kind: "reference_paper_page",
          mime: "image/jpeg",
          sizeBytes: pages[i].byteLength,
          originalName: `${title} — ${i + 1}.jpg`,
          driveFileId,
          uploadedBy: actorId,
        });
        ids[i] = stored._id;
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, pages.length) }, worker));
    await ReferencePaper.updateOne(
      { _id: paperId },
      {
        $set: {
          status: "READY",
          pageFileIds: ids,
          pageCount: ids.length,
          pageAspect: size ? size.height / size.width : 1.414,
          sourceFileId: srcFile._id,
        },
        $unset: { error: 1 },
      },
    );
  } catch (e) {
    console.warn("reference paper upload failed:", (e as Error)?.message);
    await ReferencePaper.updateOne(
      { _id: paperId },
      { $set: { status: "FAILED", error: "পৃষ্ঠাগুলো সংরক্ষণ করা যায়নি — একটু পরে আবার আপলোড করুন" } },
    ).catch(() => undefined);
    await StoredFile.deleteMany({ driveFileId: { $in: uploaded } }).catch(() => undefined);
    for (const id of uploaded) await deleteFromDrive(id).catch(() => undefined);
  }
}

export interface UpdateReferencePaperInput {
  term?: string | null;
  year?: number | null;
  classLevel?: number | null;
  /** True clears the class (a cross-class paper). */
  clearClass?: boolean | null;
  subject?: string | null;
  title?: string | null;
}

export async function updateReferencePaper(actorId: string, id: string, input: UpdateReferencePaperInput): Promise<ReferencePaperShape> {
  if (!Types.ObjectId.isValid(id)) throw new Error(REFERENCE_PAPER_ERRORS_BN.notFound);
  const paper = await ReferencePaper.findById(id);
  if (!paper) throw new Error(REFERENCE_PAPER_ERRORS_BN.notFound);
  const before = { term: paper.term, year: paper.year, classLevel: paper.classLevel, subject: paper.subject, title: paper.title };
  const merged = checkMeta({
    branch: paper.branch,
    term: input.term ?? paper.term,
    year: input.year ?? paper.year,
    classLevel: input.clearClass ? null : (input.classLevel ?? paper.classLevel ?? null),
    subject: input.subject ?? paper.subject,
    title: input.title ?? paper.title,
  });
  paper.term = merged.term;
  paper.year = merged.year;
  paper.classLevel = merged.classLevel;
  paper.subject = merged.subject;
  paper.title = merged.title;
  await paper.save();
  await writeAudit({
    eventKind: "REFERENCE_PAPER_EDITED",
    actorId,
    targetId: paper._id,
    targetKind: "ReferencePaper",
    meta: { before, after: merged },
  });
  return shape(paper.toObject() as IReferencePaper);
}

export async function deleteReferencePaper(actorId: string, id: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(id)) throw new Error(REFERENCE_PAPER_ERRORS_BN.notFound);
  const paper = (await ReferencePaper.findById(id).lean()) as unknown as IReferencePaper | null;
  if (!paper) throw new Error(REFERENCE_PAPER_ERRORS_BN.notFound);
  const fileIds = [...paper.pageFileIds, ...(paper.sourceFileId ? [paper.sourceFileId] : [])];
  const files = await StoredFile.find({ _id: { $in: fileIds } }).select("driveFileId").lean();
  await ReferencePaper.deleteOne({ _id: paper._id });
  await StoredFile.deleteMany({ _id: { $in: fileIds } });
  for (const fid of paper.pageFileIds) {
    const key = fid.toString();
    const hit = pageCache.get(key);
    if (hit) {
      pageCache.delete(key);
      pageCacheBytes -= hit.byteLength;
    }
  }
  await writeAudit({
    eventKind: "REFERENCE_PAPER_DELETED",
    actorId,
    targetId: paper._id,
    targetKind: "ReferencePaper",
    meta: { term: paper.term, year: paper.year, classLevel: paper.classLevel, subject: paper.subject, title: paper.title },
  });
  for (const f of files) await deleteFromDrive(f.driveFileId).catch(() => undefined);
  return true;
}
