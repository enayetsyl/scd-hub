/**
 * ClassBookService — class books families read in the app, view only (D-#870,
 * docs/prd-class-books.md).
 *
 *  - Upload (class_books:manage): the PDF is rendered to page JPEGs in the background
 *    (status PROCESSING → READY | FAILED); each page goes to Drive as a StoredFile of
 *    kind `class_book_page`. The PDF itself is never stored, so there is no file to hand out.
 *  - Read: one page at a time as a data URI. Staff with class_books:view/manage read every
 *    book; a guardian reads READY, visible books of the class levels their linked, active
 *    children sit in. The same gate guards GET /files/:id for a page id.
 *
 * Pages are cached in memory (bounded) — a family paging through a book would otherwise
 * cost one Drive round-trip per page turn.
 */
import { Types } from "mongoose";
import { ROSTER_CLASS_LABELS_BN, ROSTER_CLASS_LEVEL_MAX, ROSTER_CLASS_LEVEL_MIN, callerHasPermission } from "@scd/shared";
import type { RosterClassLevel } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { Class } from "../../foundation/models/Class";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { Student } from "../../foundation/models/Student";
import { StoredFile } from "../../platform/models/StoredFile";
import { deleteFromDrive, downloadFromDrive, uploadToDrive } from "../../platform/services/DriveStore";
import { writeAudit } from "../../platform/services/AuditService";
import { ClassBook, type IClassBook } from "../models/ClassBook";
import { jpegSize, renderPdfPages } from "./pdfPages";

export const CLASS_BOOK_MAX_PDF_BYTES = 60 * 1024 * 1024;
/** A PROCESSING row older than this lost its render (a restart mid-way); shown as failed. */
const STALE_PROCESSING_MS = 30 * 60 * 1000;
const PAGE_CACHE_MAX_BYTES = 80 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 4;

export const CLASS_BOOK_ERRORS_BN = {
  forbidden: "এই বইটি দেখার অনুমতি নেই",
  notFound: "বইটি পাওয়া যায়নি",
  notReady: "বইটি এখনও তৈরি হচ্ছে — একটু পরে আবার চেষ্টা করুন",
  badPage: "এই পৃষ্ঠাটি বইয়ে নেই",
  badMime: "শুধু PDF ফাইল আপলোড করা যাবে",
  tooLarge: "ফাইলের আকার সর্বোচ্চ ৬০ মেগাবাইট",
  badClass: "সঠিক শ্রেণি বাছাই করুন",
  badTitle: "বইয়ের নাম লিখুন",
  renderFailed: "PDF থেকে পৃষ্ঠা তৈরি করা যায়নি — ফাইলটি ঠিক আছে কি না দেখে আবার আপলোড করুন",
  stale: "পৃষ্ঠা তৈরি মাঝপথে থেমে গেছে — বইটি মুছে আবার আপলোড করুন",
} as const;

export interface ClassBookShape {
  id: string;
  classLevel: number;
  classLabelBn: string;
  title: string;
  sortOrder: number;
  status: string;
  error: string | null;
  pageCount: number;
  pageAspect: number;
  active: boolean;
  sourceName: string;
  createdAt: string;
}

export interface ClassBookPageShape {
  bookId: string;
  page: number;
  pageCount: number;
  dataUri: string;
}

function shape(b: IClassBook, now = Date.now()): ClassBookShape {
  const stale = b.status === "PROCESSING" && now - new Date(b.updatedAt).getTime() > STALE_PROCESSING_MS;
  return {
    id: b._id.toString(),
    classLevel: b.classLevel,
    classLabelBn: ROSTER_CLASS_LABELS_BN[b.classLevel as RosterClassLevel] ?? String(b.classLevel),
    title: b.title,
    sortOrder: b.sortOrder ?? 0,
    status: stale ? "FAILED" : b.status,
    error: stale ? CLASS_BOOK_ERRORS_BN.stale : (b.error ?? null),
    pageCount: b.pageCount ?? 0,
    pageAspect: b.pageAspect ?? 1.357,
    active: b.active !== false,
    sourceName: b.sourceName ?? "",
    createdAt: new Date(b.createdAt).toISOString(),
  };
}

const byShelfOrder = (a: IClassBook, b: IClassBook) =>
  a.classLevel - b.classLevel || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.title.localeCompare(b.title);

function isStaffReader(ctx: AppContext): boolean {
  return !!ctx.auth && (callerHasPermission(ctx.auth, "class_books:view") || callerHasPermission(ctx.auth, "class_books:manage"));
}

function validClassLevel(level: unknown): level is RosterClassLevel {
  return Number.isInteger(level) && (level as number) >= ROSTER_CLASS_LEVEL_MIN && (level as number) <= ROSTER_CLASS_LEVEL_MAX;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Staff shelf: every book (hidden and failed included), optionally one class level. */
export async function classBooksForStaff(classLevel?: number | null): Promise<ClassBookShape[]> {
  const q = classLevel === undefined || classLevel === null ? {} : { classLevel };
  const rows = (await ClassBook.find(q).lean()) as unknown as IClassBook[];
  const now = Date.now();
  return rows.sort(byShelfOrder).map((b) => shape(b, now));
}

/** The class levels of a guardian's linked, active children. */
export async function guardianClassLevels(guardianId: string): Promise<number[]> {
  const links = await GuardianLink.find({ guardianId }).lean();
  const studentIds = links.filter((l) => l.active !== false).map((l) => l.studentId);
  if (studentIds.length === 0) return [];
  const students = await Student.find({ _id: { $in: studentIds }, active: true }).select("classId").lean();
  const classIds = [...new Set(students.map((s) => String(s.classId)))];
  if (classIds.length === 0) return [];
  const classes = await Class.find({ _id: { $in: classIds } }).select("level").lean();
  return [...new Set(classes.map((c) => c.level as number))];
}

/** Guardian shelf: READY, visible books of their children's class levels. */
export async function myClassBooks(guardianId: string): Promise<ClassBookShape[]> {
  const levels = await guardianClassLevels(guardianId);
  if (levels.length === 0) return [];
  const rows = (await ClassBook.find({ classLevel: { $in: levels }, status: "READY", active: true }).lean()) as unknown as IClassBook[];
  return rows.sort(byShelfOrder).map((b) => shape(b));
}

/** Throws ForbiddenError unless the caller may read this book's pages. */
export async function assertClassBookReadAccess(ctx: AppContext, book: IClassBook): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError(CLASS_BOOK_ERRORS_BN.forbidden);
  if (isStaffReader(ctx)) return;
  if (!callerHasPermission(ctx.auth, "guardian:read_child")) throw new ForbiddenError(CLASS_BOOK_ERRORS_BN.forbidden);
  if (book.active === false || book.status !== "READY") throw new ForbiddenError(CLASS_BOOK_ERRORS_BN.forbidden);
  const levels = await guardianClassLevels(ctx.auth.userId);
  if (!levels.includes(book.classLevel)) throw new ForbiddenError(CLASS_BOOK_ERRORS_BN.forbidden);
}

/** GET /files/:id gate for a `class_book_page` file: resolve its book, then the book gate. */
export async function assertClassBookFileReadAccess(ctx: AppContext, fileId: string): Promise<void> {
  const book = (await ClassBook.findOne({ pageFileIds: new Types.ObjectId(fileId) }).lean()) as unknown as IClassBook | null;
  if (!book) throw new ForbiddenError(CLASS_BOOK_ERRORS_BN.forbidden);
  await assertClassBookReadAccess(ctx, book);
}

// Bounded LRU of page bytes by StoredFile id (Map keeps insertion order).
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

/** Test seam: forget cached pages. */
export function clearClassBookPageCache(): void {
  pageCache.clear();
  pageCacheBytes = 0;
}

/** One page (1-based) as a JPEG data URI, after the read gate. */
export async function classBookPage(ctx: AppContext, bookId: string, page: number): Promise<ClassBookPageShape> {
  if (!Types.ObjectId.isValid(bookId)) throw new Error(CLASS_BOOK_ERRORS_BN.notFound);
  const book = (await ClassBook.findById(bookId).lean()) as unknown as IClassBook | null;
  if (!book) throw new Error(CLASS_BOOK_ERRORS_BN.notFound);
  await assertClassBookReadAccess(ctx, book);
  if (book.status !== "READY") throw new Error(CLASS_BOOK_ERRORS_BN.notReady);
  if (!Number.isInteger(page) || page < 1 || page > book.pageFileIds.length) throw new Error(CLASS_BOOK_ERRORS_BN.badPage);

  const fileId = book.pageFileIds[page - 1].toString();
  let data = cacheGet(fileId);
  if (!data) {
    const file = await StoredFile.findById(fileId).lean();
    if (!file) throw new Error(CLASS_BOOK_ERRORS_BN.badPage);
    data = await downloadFromDrive(file.driveFileId);
    cachePut(fileId, data);
  }
  return { bookId, page, pageCount: book.pageFileIds.length, dataUri: `data:image/jpeg;base64,${data.toString("base64")}` };
}

// ---------------------------------------------------------------------------
// Writes (class_books:manage — checked by the route / resolvers)
// ---------------------------------------------------------------------------

export function validateClassBookUpload(mime: string, sizeBytes: number): string | null {
  if (mime !== "application/pdf") return CLASS_BOOK_ERRORS_BN.badMime;
  if (sizeBytes <= 0) return CLASS_BOOK_ERRORS_BN.badMime;
  if (sizeBytes > CLASS_BOOK_MAX_PDF_BYTES) return CLASS_BOOK_ERRORS_BN.tooLarge;
  return null;
}

export interface StartClassBookUploadInput {
  actorId: string;
  classLevel: number;
  title: string;
  sortOrder?: number;
  sourceName: string;
  pdf: Buffer;
}

/**
 * Create the book row (PROCESSING) and render it in the background. Resolves with the
 * row once created; `done` settles when the render finishes (tests and the upload
 * script await it, the HTTP route does not — a 78-page book outlasts the proxy timeout).
 */
export async function startClassBookUpload(
  input: StartClassBookUploadInput,
): Promise<{ book: ClassBookShape; done: Promise<void> }> {
  if (!validClassLevel(input.classLevel)) throw new Error(CLASS_BOOK_ERRORS_BN.badClass);
  const title = (input.title ?? "").trim();
  if (!title) throw new Error(CLASS_BOOK_ERRORS_BN.badTitle);
  const row = await ClassBook.create({
    classLevel: input.classLevel,
    title,
    sortOrder: Number.isFinite(input.sortOrder) ? input.sortOrder : 0,
    status: "PROCESSING",
    sourceName: input.sourceName,
    uploadedBy: new Types.ObjectId(input.actorId),
    pageFileIds: [],
  });
  await writeAudit({
    eventKind: "CLASS_BOOK_UPLOADED",
    actorId: input.actorId,
    targetId: row._id,
    targetKind: "ClassBook",
    meta: { classLevel: input.classLevel, title, sourceName: input.sourceName, sizeBytes: input.pdf.byteLength },
  });
  const done = renderClassBook(row._id.toString(), input.pdf, input.actorId, title);
  return { book: shape(row.toObject() as IClassBook), done };
}

async function renderClassBook(bookId: string, pdf: Buffer, actorId: string, title: string): Promise<void> {
  const uploaded: string[] = [];
  try {
    let pages: Buffer[];
    try {
      pages = await renderPdfPages(pdf);
    } catch (e) {
      console.warn("class book render failed:", (e as Error)?.message);
      await ClassBook.updateOne({ _id: bookId }, { $set: { status: "FAILED", error: CLASS_BOOK_ERRORS_BN.renderFailed } });
      return;
    }
    const size = jpegSize(pages[0]);
    const ids: Types.ObjectId[] = new Array(pages.length);
    const year = String(new Date().getFullYear());
    let next = 0;
    const worker = async () => {
      while (next < pages.length) {
        const i = next++;
        const name = `${bookId}-p${String(i + 1).padStart(3, "0")}.jpg`;
        const driveFileId = await uploadToDrive({
          name,
          mime: "image/jpeg",
          data: pages[i],
          year,
          subfolder: "class-books",
          appProperties: { classBookId: bookId, page: String(i + 1) },
        });
        uploaded.push(driveFileId);
        const stored = await StoredFile.create({
          kind: "class_book_page",
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
    await ClassBook.updateOne(
      { _id: bookId },
      {
        $set: {
          status: "READY",
          pageFileIds: ids,
          pageCount: ids.length,
          pageAspect: size ? size.height / size.width : 1.357,
        },
        $unset: { error: 1 },
      },
    );
  } catch (e) {
    console.warn("class book upload failed:", (e as Error)?.message);
    await ClassBook.updateOne(
      { _id: bookId },
      { $set: { status: "FAILED", error: "পৃষ্ঠাগুলো সংরক্ষণ করা যায়নি — একটু পরে আবার আপলোড করুন" } },
    ).catch(() => undefined);
    // Pages already in Drive belong to no READY book; drop them best-effort.
    await StoredFile.deleteMany({ driveFileId: { $in: uploaded } }).catch(() => undefined);
    for (const id of uploaded) await deleteFromDrive(id).catch(() => undefined);
  }
}

export interface UpdateClassBookInput {
  title?: string | null;
  classLevel?: number | null;
  sortOrder?: number | null;
  active?: boolean | null;
}

export async function updateClassBook(actorId: string, id: string, input: UpdateClassBookInput): Promise<ClassBookShape> {
  if (!Types.ObjectId.isValid(id)) throw new Error(CLASS_BOOK_ERRORS_BN.notFound);
  const book = await ClassBook.findById(id);
  if (!book) throw new Error(CLASS_BOOK_ERRORS_BN.notFound);
  const before = { title: book.title, classLevel: book.classLevel, sortOrder: book.sortOrder, active: book.active };
  if (input.title !== undefined && input.title !== null) {
    const t = input.title.trim();
    if (!t) throw new Error(CLASS_BOOK_ERRORS_BN.badTitle);
    book.title = t;
  }
  if (input.classLevel !== undefined && input.classLevel !== null) {
    if (!validClassLevel(input.classLevel)) throw new Error(CLASS_BOOK_ERRORS_BN.badClass);
    book.classLevel = input.classLevel;
  }
  if (input.sortOrder !== undefined && input.sortOrder !== null) book.sortOrder = input.sortOrder;
  if (input.active !== undefined && input.active !== null) book.active = input.active;
  await book.save();
  await writeAudit({
    eventKind: "CLASS_BOOK_EDITED",
    actorId,
    targetId: book._id,
    targetKind: "ClassBook",
    meta: { before, after: { title: book.title, classLevel: book.classLevel, sortOrder: book.sortOrder, active: book.active } },
  });
  return shape(book.toObject() as IClassBook);
}

export async function deleteClassBook(actorId: string, id: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(id)) throw new Error(CLASS_BOOK_ERRORS_BN.notFound);
  const book = (await ClassBook.findById(id).lean()) as unknown as IClassBook | null;
  if (!book) throw new Error(CLASS_BOOK_ERRORS_BN.notFound);
  const files = await StoredFile.find({ _id: { $in: book.pageFileIds } }).select("driveFileId").lean();
  await ClassBook.deleteOne({ _id: book._id });
  await StoredFile.deleteMany({ _id: { $in: book.pageFileIds } });
  for (const id of book.pageFileIds) {
    const key = id.toString();
    const hit = pageCache.get(key);
    if (hit) {
      pageCache.delete(key);
      pageCacheBytes -= hit.byteLength;
    }
  }
  await writeAudit({
    eventKind: "CLASS_BOOK_DELETED",
    actorId,
    targetId: book._id,
    targetKind: "ClassBook",
    meta: { classLevel: book.classLevel, title: book.title, pageCount: book.pageCount },
  });
  // Drive clean-up last and best-effort: the book is already gone for every reader.
  for (const f of files) await deleteFromDrive(f.driveFileId).catch(() => undefined);
  return true;
}
