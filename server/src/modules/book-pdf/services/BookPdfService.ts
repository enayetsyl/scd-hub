/**
 * BookPdfService — the real printed pages of a school book beside a plan and in the teachers'
 * viewer (PB-1/PB-2, D-#1657; nov-ops F4). Built on the class-books pipeline (D-#870): the PDF is
 * rendered to 150 dpi JPEG pages (pdfPages.ts), each page a StoredFile of kind `bookpdf_page`,
 * served one at a time. The PDF itself is never stored.
 *
 *  - Identity = SchoolBook.code (the book the plan Book tab resolves from classLevel + subject);
 *    chapter keys = that book's chapter keys. A chapter is a page range (fromPage..toPage).
 *  - Manage (class_books:manage, route/resolvers): upload / replace / chapter ranges / hide / delete.
 *  - Read: any non-guardian holding lesson_plans:read_book, class_books:view or class_books:manage.
 *    Guardians never read these pages (they follow the class-books release switch, D-#1011).
 *    The same gate guards GET /files/:id for a `bookpdf_page`.
 */
import { Types } from "mongoose";
import { callerHasPermission } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { isBookDbReady } from "../../../bookDb";
import { SchoolBook } from "../../book-lifecycle/models/SchoolBook";
import { BookVersion } from "../../book-lifecycle/models/BookVersion";
import { pickPlanBookVersion } from "../../book-lifecycle/services/planBook";
import { versionChapters, vlabel } from "../../book-lifecycle/services/store";
import { FRONT_KEY } from "../../book-lifecycle/services/markdown";
import { StoredFile } from "../../platform/models/StoredFile";
import { deleteFromDrive, downloadFromDrive, uploadToDrive } from "../../platform/services/DriveStore";
import { writeAudit } from "../../platform/services/AuditService";
import { jpegSize, renderPdfPages } from "../../class-books/services/pdfPages";
import { BookPdf, chapterPageRange, type IBookPdf, type IBookPdfChapter } from "../models/BookPdf";

export { chapterPageRange };

export const BOOK_PDF_MAX_BYTES = 80 * 1024 * 1024;
const STALE_PROCESSING_MS = 30 * 60 * 1000;
const PAGE_CACHE_MAX_BYTES = 80 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 4;

export const BOOK_PDF_ERRORS_BN = {
  forbidden: "এই বইয়ের পৃষ্ঠা দেখার অনুমতি নেই",
  notFound: "বইয়ের পিডিএফ পাওয়া যায়নি",
  notReady: "বইটি এখনও তৈরি হচ্ছে — একটু পরে আবার চেষ্টা করুন",
  badPage: "এই পৃষ্ঠাটি বইয়ে নেই",
  badMime: "শুধু PDF ফাইল আপলোড করা যাবে",
  tooLarge: "ফাইলের আকার সর্বোচ্চ ৮০ মেগাবাইট",
  badBook: "বইটি খুঁজে পাওয়া যায়নি — সঠিক বই বাছাই করুন",
  planeDown: "বইয়ের তথ্য এখন পাওয়া যাচ্ছে না",
  badChapter: "অধ্যায়ের পৃষ্ঠার সীমা ঠিক নেই",
  renderFailed: "PDF থেকে পৃষ্ঠা তৈরি করা যায়নি — ফাইলটি ঠিক আছে কি না দেখে আবার আপলোড করুন",
  stale: "পৃষ্ঠা তৈরি মাঝপথে থেমে গেছে — আবার আপলোড করুন",
  busy: "এই বইয়ের পৃষ্ঠা এখনও তৈরি হচ্ছে — শেষ হলে আবার পিডিএফ দিন",
  saveFailed: "পৃষ্ঠাগুলো সংরক্ষণ করা যায়নি — একটু পরে আবার আপলোড করুন",
} as const;

/** A render for this book is already running (the route answers 409). */
export class BookPdfBusyError extends Error {
  constructor() {
    super(BOOK_PDF_ERRORS_BN.busy);
    this.name = "BookPdfBusyError";
  }
}

export interface BookPdfChapterShape {
  key: string;
  title: string;
  fromPage: number;
  toPage: number;
}

export interface BookPdfShape {
  id: string;
  bookCode: string;
  classLevel: number;
  subject: string;
  titleBn: string;
  versionLabel: string;
  sourceName: string;
  status: string;
  error: string | null;
  replacing: boolean;
  pageCount: number;
  pageAspect: number;
  active: boolean;
  chapters: BookPdfChapterShape[];
  updatedAt: string;
}

export interface BookPdfPageShape {
  pdfId: string;
  page: number;
  pageCount: number;
  dataUri: string;
}

export interface BookPdfAdminRow {
  bookCode: string;
  classLevel: number;
  subject: string;
  titleBn: string;
  pdf: BookPdfShape | null;
}

export interface BookChapterKeyShape {
  key: string;
  title: string;
}

function shape(b: IBookPdf, now = Date.now()): BookPdfShape {
  // A render that lost its process (a restart mid-way) leaves PROCESSING, or READY + replacing, behind.
  const stale = (b.status === "PROCESSING" || b.replacing === true) && now - new Date(b.updatedAt).getTime() > STALE_PROCESSING_MS;
  const staleFailed = stale && b.status === "PROCESSING";
  return {
    id: b._id.toString(),
    bookCode: b.bookCode,
    classLevel: b.classLevel,
    subject: b.subject,
    titleBn: b.titleBn,
    versionLabel: b.versionLabel ?? "",
    sourceName: b.sourceName ?? "",
    status: staleFailed ? "FAILED" : b.status,
    error: staleFailed ? BOOK_PDF_ERRORS_BN.stale : (b.error ?? null),
    replacing: !!b.replacing && !stale,
    pageCount: b.pageCount ?? 0,
    pageAspect: b.pageAspect ?? 1.357,
    active: b.active !== false,
    chapters: (b.chapters ?? []).map((c) => ({ key: c.key, title: c.title ?? "", fromPage: c.fromPage, toPage: c.toPage })),
    updatedAt: new Date(b.updatedAt).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// The read gate
// ---------------------------------------------------------------------------

/** A teacher-side reader: any non-guardian with the plan-book read, class-book view or class-book manage action. */
export function mayReadBookPdf(auth: AppContext["auth"]): boolean {
  if (!auth || auth.role === "GUARDIAN") return false;
  return (
    callerHasPermission(auth, "lesson_plans:read_book") ||
    callerHasPermission(auth, "class_books:view") ||
    callerHasPermission(auth, "class_books:manage")
  );
}

export function assertBookPdfReader(ctx: AppContext): void {
  if (!mayReadBookPdf(ctx.auth)) throw new ForbiddenError(BOOK_PDF_ERRORS_BN.forbidden);
}

async function assertReadAccess(ctx: AppContext, pdf: IBookPdf): Promise<void> {
  assertBookPdfReader(ctx);
  const manager = !!ctx.auth && callerHasPermission(ctx.auth, "class_books:manage");
  if (!manager && (pdf.active === false || pdf.status !== "READY")) throw new ForbiddenError(BOOK_PDF_ERRORS_BN.forbidden);
}

/** GET /files/:id gate for a `bookpdf_page` file: resolve its book, then the book gate. */
export async function assertBookPdfFileReadAccess(ctx: AppContext, fileId: string): Promise<void> {
  const pdf = (await BookPdf.findOne({ pageFileIds: new Types.ObjectId(fileId) }).lean()) as unknown as IBookPdf | null;
  if (!pdf) throw new ForbiddenError(BOOK_PDF_ERRORS_BN.forbidden);
  await assertReadAccess(ctx, pdf);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Teachers' shelf: READY, visible book PDFs (chapters included), by class then title. */
export async function bookPdfShelf(ctx: AppContext): Promise<BookPdfShape[]> {
  assertBookPdfReader(ctx);
  const rows = (await BookPdf.find({ status: "READY", active: true }).lean()) as unknown as IBookPdf[];
  const now = Date.now();
  return rows.sort((a, b) => a.classLevel - b.classLevel || a.titleBn.localeCompare(b.titleBn)).map((b) => shape(b, now));
}

/** The READY, visible PDF of a book (by SchoolBook.code), for the plan Book tab; null when none. */
export async function activeBookPdfByCode(bookCode: string): Promise<IBookPdf | null> {
  return (await BookPdf.findOne({ bookCode, status: "READY", active: true }).lean()) as unknown as IBookPdf | null;
}

/** Office shelf: every book of the book plane with its PDF row (if any). */
export async function bookPdfAdminRows(): Promise<BookPdfAdminRow[]> {
  if (!isBookDbReady()) throw new Error(BOOK_PDF_ERRORS_BN.planeDown);
  const books = await SchoolBook.find({ archived: false }).select("code classLevel subject titleBn").lean();
  const pdfs = (await BookPdf.find({}).lean()) as unknown as IBookPdf[];
  const byCode = new Map(pdfs.map((p) => [p.bookCode, p]));
  const now = Date.now();
  const rows: BookPdfAdminRow[] = books.map((b) => ({
    bookCode: b.code,
    classLevel: b.classLevel,
    subject: b.subject,
    titleBn: b.titleBn,
    pdf: byCode.has(b.code) ? shape(byCode.get(b.code)!, now) : null,
  }));
  return rows.sort((a, b) => a.classLevel - b.classLevel || a.bookCode.localeCompare(b.bookCode));
}

/** The chapter keys of a book (served version, else final, else latest) — what a page range is keyed to. */
export async function bookChapterKeys(bookCode: string): Promise<BookChapterKeyShape[]> {
  if (!isBookDbReady()) return [];
  const book = await SchoolBook.findOne({ code: bookCode });
  if (!book) throw new Error(BOOK_PDF_ERRORS_BN.badBook);
  const picked = await pickPlanBookVersion(book);
  const id = book.finalVersionId ?? book.latestVersionId;
  const v = picked?.version ?? (id ? await BookVersion.findById(id) : null);
  if (!v) return [];
  return (await versionChapters(v)).filter((c) => c.key !== FRONT_KEY).map((c) => ({ key: c.key, title: c.title }));
}

// Bounded LRU of page bytes by StoredFile id.
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

function cacheDrop(id: string): void {
  const hit = pageCache.get(id);
  if (hit) {
    pageCache.delete(id);
    pageCacheBytes -= hit.byteLength;
  }
}

/** Test seam. */
export function clearBookPdfPageCache(): void {
  pageCache.clear();
  pageCacheBytes = 0;
}

/** One page (1-based) as a JPEG data URI, after the read gate. */
export async function bookPdfPage(ctx: AppContext, pdfId: string, page: number): Promise<BookPdfPageShape> {
  assertBookPdfReader(ctx);
  if (!Types.ObjectId.isValid(pdfId)) throw new Error(BOOK_PDF_ERRORS_BN.notFound);
  const pdf = (await BookPdf.findById(pdfId).lean()) as unknown as IBookPdf | null;
  if (!pdf) throw new Error(BOOK_PDF_ERRORS_BN.notFound);
  await assertReadAccess(ctx, pdf);
  if (pdf.status !== "READY") throw new Error(BOOK_PDF_ERRORS_BN.notReady);
  if (!Number.isInteger(page) || page < 1 || page > pdf.pageFileIds.length) throw new Error(BOOK_PDF_ERRORS_BN.badPage);
  const fileId = pdf.pageFileIds[page - 1].toString();
  let data = cacheGet(fileId);
  if (!data) {
    const file = await StoredFile.findById(fileId).lean();
    if (!file) throw new Error(BOOK_PDF_ERRORS_BN.badPage);
    data = await downloadFromDrive(file.driveFileId);
    cachePut(fileId, data);
  }
  return { pdfId, page, pageCount: pdf.pageFileIds.length, dataUri: `data:image/jpeg;base64,${data.toString("base64")}` };
}

// ---------------------------------------------------------------------------
// Writes (class_books:manage — checked by the route / resolvers)
// ---------------------------------------------------------------------------

export function validateBookPdfUpload(mime: string, sizeBytes: number): string | null {
  if (mime !== "application/pdf") return BOOK_PDF_ERRORS_BN.badMime;
  if (sizeBytes <= 0) return BOOK_PDF_ERRORS_BN.badMime;
  if (sizeBytes > BOOK_PDF_MAX_BYTES) return BOOK_PDF_ERRORS_BN.tooLarge;
  return null;
}

export interface StartBookPdfUploadInput {
  actorId: string;
  bookCode: string;
  /** Kept from the old row when empty on a re-upload; else the served version's label. */
  versionLabel?: string | null;
  sourceName: string;
  pdf: Buffer;
}

/**
 * Create (or, for a re-upload, mark replacing) the row and render in the background. A
 * re-upload keeps the chapter ranges and the old pages serving until the swap.
 */
export async function startBookPdfUpload(input: StartBookPdfUploadInput): Promise<{ pdf: BookPdfShape; done: Promise<void> }> {
  if (!isBookDbReady()) throw new Error(BOOK_PDF_ERRORS_BN.planeDown);
  const book = await SchoolBook.findOne({ code: String(input.bookCode ?? "").trim() });
  if (!book) throw new Error(BOOK_PDF_ERRORS_BN.badBook);
  let label = (input.versionLabel ?? "").trim();
  const existing = await BookPdf.findOne({ bookCode: book.code });
  if (!label) {
    const picked = await pickPlanBookVersion(book);
    label = existing?.versionLabel || (picked ? vlabel(picked.version) : "");
  }
  const renderToken = new Types.ObjectId().toString();
  let row: IBookPdf;
  if (existing) {
    // One render per book: refuse while one is running (a lost one, older than the stale limit, may be redone).
    const s = shape(existing.toObject() as IBookPdf);
    if (s.status === "PROCESSING" || s.replacing) throw new BookPdfBusyError();
    const ready = existing.status === "READY";
    const set: Record<string, unknown> = {
      classLevel: book.classLevel,
      subject: book.subject,
      titleBn: book.titleBn,
      sourceName: input.sourceName,
      versionLabel: label,
      uploadedBy: new Types.ObjectId(input.actorId),
      renderToken,
      ...(ready ? { replacing: true } : { status: "PROCESSING", replacing: false }),
    };
    // Optimistic guard: the row must be unchanged since it was read, or another upload got in first.
    const updated = (await BookPdf.findOneAndUpdate(
      { _id: existing._id, updatedAt: existing.updatedAt },
      ready ? { $set: set } : { $set: set, $unset: { error: 1 } },
      { new: true },
    ).lean()) as unknown as IBookPdf | null;
    if (!updated) throw new BookPdfBusyError();
    row = updated;
  } else {
    row = await BookPdf.create({
      bookCode: book.code,
      classLevel: book.classLevel,
      subject: book.subject,
      titleBn: book.titleBn,
      versionLabel: label,
      sourceName: input.sourceName,
      renderToken,
      status: "PROCESSING",
      uploadedBy: new Types.ObjectId(input.actorId),
      pageFileIds: [],
    });
  }
  await writeAudit({
    eventKind: "BOOK_PDF_UPLOADED",
    actorId: input.actorId,
    targetId: row._id,
    targetKind: "BookPdf",
    meta: { bookCode: book.code, sourceName: input.sourceName, versionLabel: label, sizeBytes: input.pdf.byteLength, replace: !!existing },
  });
  const done = renderBookPdf(row._id.toString(), renderToken, input.pdf, input.actorId, book.titleBn);
  return { pdf: shape(typeof row.toObject === "function" ? (row.toObject() as IBookPdf) : row), done };
}

async function renderBookPdf(pdfId: string, token: string, pdf: Buffer, actorId: string, title: string): Promise<void> {
  const uploaded: string[] = [];
  const before = (await BookPdf.findById(pdfId).select("status pageFileIds").lean()) as unknown as Pick<IBookPdf, "status" | "pageFileIds"> | null;
  const hadPages = before?.status === "READY";
  const fail = async (message: string): Promise<void> => {
    await BookPdf.updateOne(
      { _id: pdfId, renderToken: token },
      hadPages ? { $set: { replacing: false, error: message } } : { $set: { status: "FAILED", replacing: false, error: message } },
    ).catch(() => undefined);
  };
  try {
    let pages: Buffer[];
    try {
      pages = await renderPdfPages(pdf);
    } catch (e) {
      console.warn("book pdf render failed:", (e as Error)?.message);
      await fail(BOOK_PDF_ERRORS_BN.renderFailed);
      return;
    }
    const size = jpegSize(pages[0]);
    const ids: Types.ObjectId[] = new Array(pages.length);
    const year = String(new Date().getFullYear());
    const stamp = Date.now().toString(36);
    let next = 0;
    const worker = async () => {
      while (next < pages.length) {
        const i = next++;
        const driveFileId = await uploadToDrive({
          name: `${pdfId}-${stamp}-p${String(i + 1).padStart(3, "0")}.jpg`,
          mime: "image/jpeg",
          data: pages[i],
          year,
          subfolder: "book-pdf",
          appProperties: { bookPdfId: pdfId, page: String(i + 1) },
        });
        uploaded.push(driveFileId);
        const stored = await StoredFile.create({
          kind: "bookpdf_page",
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
    const res = await BookPdf.updateOne(
      { _id: pdfId, renderToken: token },
      {
        $set: { status: "READY", replacing: false, pageFileIds: ids, pageCount: ids.length, pageAspect: size ? size.height / size.width : 1.357 },
        $unset: { error: 1 },
      },
    );
    if (res.matchedCount === 0) {
      // The book was deleted or superseded mid-render: nothing points at these pages, so drop them.
      await StoredFile.deleteMany({ driveFileId: { $in: uploaded } }).catch(() => undefined);
      for (const id of uploaded) await deleteFromDrive(id).catch(() => undefined);
      return;
    }
    // The swap is done: drop the replaced pages.
    if (hadPages && before) await dropPages(before.pageFileIds);
  } catch (e) {
    console.warn("book pdf upload failed:", (e as Error)?.message);
    await fail(BOOK_PDF_ERRORS_BN.saveFailed);
    await StoredFile.deleteMany({ driveFileId: { $in: uploaded } }).catch(() => undefined);
    for (const id of uploaded) await deleteFromDrive(id).catch(() => undefined);
  }
}

async function dropPages(ids: Types.ObjectId[]): Promise<void> {
  if (!ids.length) return;
  const files = await StoredFile.find({ _id: { $in: ids } }).select("driveFileId").lean();
  await StoredFile.deleteMany({ _id: { $in: ids } });
  for (const id of ids) cacheDrop(id.toString());
  for (const f of files) await deleteFromDrive(f.driveFileId).catch(() => undefined);
}

export interface BookPdfChapterInput {
  key: string;
  title?: string | null;
  fromPage: number;
  toPage: number;
}

/** Replace the chapter → page-range mapping. Keys must be unique; ranges inside the book's pages. */
export async function setBookPdfChapters(actorId: string, bookCode: string, chapters: BookPdfChapterInput[]): Promise<BookPdfShape> {
  const row = await BookPdf.findOne({ bookCode });
  if (!row) throw new Error(BOOK_PDF_ERRORS_BN.notFound);
  const seen = new Set<string>();
  const clean: IBookPdfChapter[] = [];
  for (const c of chapters) {
    const key = (c.key ?? "").trim();
    if (!key || seen.has(key)) throw new Error(BOOK_PDF_ERRORS_BN.badChapter);
    seen.add(key);
    const ok =
      Number.isInteger(c.fromPage) &&
      Number.isInteger(c.toPage) &&
      c.fromPage >= 1 &&
      c.toPage >= c.fromPage &&
      (!row.pageCount || c.toPage <= row.pageCount);
    if (!ok) throw new Error(BOOK_PDF_ERRORS_BN.badChapter);
    clean.push({ key, title: (c.title ?? "").trim(), fromPage: c.fromPage, toPage: c.toPage });
  }
  row.chapters = clean;
  await row.save();
  await writeAudit({ eventKind: "BOOK_PDF_CHAPTERS_SET", actorId, targetId: row._id, targetKind: "BookPdf", meta: { bookCode, count: clean.length } });
  return shape(row.toObject() as IBookPdf);
}

export async function updateBookPdf(actorId: string, bookCode: string, input: { versionLabel?: string | null; active?: boolean | null }): Promise<BookPdfShape> {
  const row = await BookPdf.findOne({ bookCode });
  if (!row) throw new Error(BOOK_PDF_ERRORS_BN.notFound);
  const before = { versionLabel: row.versionLabel, active: row.active };
  if (input.versionLabel !== undefined && input.versionLabel !== null) row.versionLabel = input.versionLabel.trim();
  if (input.active !== undefined && input.active !== null) row.active = input.active;
  await row.save();
  await writeAudit({
    eventKind: "BOOK_PDF_EDITED",
    actorId,
    targetId: row._id,
    targetKind: "BookPdf",
    meta: { bookCode, before, after: { versionLabel: row.versionLabel, active: row.active } },
  });
  return shape(row.toObject() as IBookPdf);
}

export async function deleteBookPdf(actorId: string, bookCode: string): Promise<boolean> {
  const row = (await BookPdf.findOne({ bookCode }).lean()) as unknown as IBookPdf | null;
  if (!row) throw new Error(BOOK_PDF_ERRORS_BN.notFound);
  await BookPdf.deleteOne({ _id: row._id });
  await dropPages(row.pageFileIds);
  await writeAudit({ eventKind: "BOOK_PDF_DELETED", actorId, targetId: row._id, targetKind: "BookPdf", meta: { bookCode, pageCount: row.pageCount } });
  return true;
}
