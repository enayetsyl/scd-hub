/**
 * Teacher surfaces (docs/prd-book-lifecycle.md §7.3, §8 S8/S9; owner Q5, D-#1597).
 *
 * Readers (bookTeachersNow) get only RELEASED content: the Teacher edition of the current release's
 * version, the announced errata of that release, and their own reports — never drafts, memos, rounds,
 * reviewer marks, other teachers' reports or the master. The report form needs `report` + reader.
 */
import { Types } from "mongoose";
import type { BookEdition, BookFeedbackCategory } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { SchoolBook, type ISchoolBook } from "../models/SchoolBook";
import { BookPrintRelease, BookErratum, type IBookErratum, type IBookPrintRelease } from "../models/BookRelease";
import { BookVersion } from "../models/BookVersion";
import { BookFeedback, type IBookFeedback } from "../models/BookFeedback";
import { StoredFile } from "../../platform/models/StoredFile";
import { requireBookLc, uid, oid } from "./access";
import { BookLcError } from "./errors";
import { createFeedbackRow } from "./feedbackService";
import { bookTeachersNow, isBookReader } from "./teacherScope";
import { suggestChapterForPage } from "./releaseService";
import { storeLcFile, mimeFromName } from "./files";
import { vlabel } from "./store";

export interface MyBookRow {
  book: ISchoolBook;
  release: IBookPrintRelease;
  versionLabel: string;
  teacherFileIds: string[];
  errata: IBookErratum[];
}

/** আমার বই: books with a current release whose readers include me. */
export async function myBooks(auth: AuthPayload): Promise<MyBookRow[]> {
  requireBookLc(auth, "teacher_view");
  const books = await SchoolBook.find({ archived: false, currentReleaseId: { $exists: true } }).sort({ classLevel: 1, code: 1 });
  const out: MyBookRow[] = [];
  for (const book of books) {
    if (!(await bookTeachersNow(book)).has(auth.userId)) continue;
    const release = await BookPrintRelease.findById(book.currentReleaseId);
    if (!release) continue;
    const v = await BookVersion.findById(release.versionId).select("major minor files").lean();
    const errata = await BookErratum.find({ releaseId: release._id, status: "announced" }).sort({ createdAt: 1 });
    out.push({
      book,
      release,
      versionLabel: v ? vlabel(v) : "?",
      teacherFileIds: (v?.files ?? []).filter((f) => f.role === "edition" && f.edition === "TEACHER").map((f) => f.storedFileId.toString()),
      errata,
    });
  }
  return out;
}

/** আমার পাঠানো: my own reports, newest first. */
export async function myReports(auth: AuthPayload): Promise<IBookFeedback[]> {
  requireBookLc(auth, "report");
  return BookFeedback.find({ reporterId: uid(auth) }).sort({ createdAt: -1 }).limit(200);
}

export interface TeacherReportInput {
  edition?: BookEdition | null;
  page?: string | null;
  quote?: string | null;
  textBn: string;
  category: BookFeedbackCategory;
  photoFileIds?: string[] | null;
}

/** S9 ভুল জানান: a `teacher` item on the current release (report + reader). */
export async function fileTeacherReport(auth: AuthPayload, bookId: string, input: TeacherReportInput): Promise<IBookFeedback> {
  requireBookLc(auth, "report");
  const book = await SchoolBook.findById(oid(bookId));
  if (!book) throw new BookLcError("NO_BOOK", "বই পাওয়া যায়নি");
  if (!(await isBookReader(auth.userId, book))) throw new BookLcError("NOT_READER", "এই বই আপনার শ্রেণি/বিষয়ের নয়");
  if (!book.currentReleaseId) throw new BookLcError("NO_RELEASE", "এই বই এখনো ছাপা হয়নি");
  const release = await BookPrintRelease.findById(book.currentReleaseId).lean();
  if (!release) throw new BookLcError("NO_RELEASE", "এই বই এখনো ছাপা হয়নি");
  const photos = (input.photoFileIds ?? []).slice(0, 3);
  if (photos.length) {
    const own = await StoredFile.countDocuments({ _id: { $in: photos.map((p) => oid(p)) }, kind: "book_lc_feedback", uploadedBy: uid(auth) });
    if (own !== photos.length) throw new BookLcError("BAD_PHOTO", "ছবিটি আপনার তোলা নয়");
  }
  const pageNo = Number(String(input.page ?? "").replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))));
  const chapterKey = Number.isInteger(pageNo) && pageNo > 0 ? await suggestChapterForPage(book._id, pageNo) : null;
  return createFeedbackRow(
    book,
    { versionId: release.versionId.toString(), releaseId: release._id.toString(), chapterKey, page: input.page, quote: input.quote, edition: input.edition ?? null, category: input.category, textBn: input.textBn, attachments: photos },
    { source: "teacher", actor: uid(auth), reporterId: uid(auth) },
  );
}

/** A photo of the page for a report (≤ 5 MB, kind book_lc_feedback, readable by its reporter). */
export async function uploadReportPhoto(auth: AuthPayload, bookId: string, input: { name: string; data: Buffer; mime?: string }): Promise<string> {
  requireBookLc(auth, "report");
  const book = await SchoolBook.findById(oid(bookId));
  if (!book || !(await isBookReader(auth.userId, book))) throw new BookLcError("NOT_READER", "এই বই আপনার শ্রেণি/বিষয়ের নয়");
  const mime = input.mime ?? mimeFromName(input.name);
  if (!["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(mime)) throw new BookLcError("BAD_TYPE", "ছবি (PNG/JPEG) বা PDF দিন");
  const f = await storeLcFile({ kind: "book_lc_feedback", name: input.name, mime, data: input.data, bookCode: book.code, version: "reports", role: "teacher-photo", uploadedBy: auth.userId, capOpts: { photo: true } });
  return f._id.toString();
}

/** Read rule (GET /files/:id): a reader may open the Teacher edition of the current release's version,
 *  and a reporter their own report photo. */
export async function teacherMayRead(auth: AuthPayload, file: { _id: Types.ObjectId; kind: string; uploadedBy?: Types.ObjectId }): Promise<boolean> {
  // A teacher's own report photo: readable by its uploader (who is its reporter) only.
  if (file.kind === "book_lc_feedback") return !!file.uploadedBy && file.uploadedBy.toString() === auth.userId && requireReportAction(auth);
  if (file.kind !== "book_lc_edition") return false;
  if (!requireReaderAction(auth)) return false;
  const v = await BookVersion.findOne({ files: { $elemMatch: { storedFileId: file._id, role: "edition", edition: "TEACHER" } } }).select("bookId").lean();
  if (!v) return false;
  const book = await SchoolBook.findById(v.bookId).lean();
  if (!book?.currentReleaseId) return false;
  const rel = await BookPrintRelease.findById(book.currentReleaseId).select("versionId").lean();
  if (!rel || !rel.versionId.equals(v._id)) return false;
  return isBookReader(auth.userId, book);
}

function requireReportAction(auth: AuthPayload): boolean {
  try {
    requireBookLc(auth, "report");
    return true;
  } catch {
    return false;
  }
}

function requireReaderAction(auth: AuthPayload): boolean {
  try {
    requireBookLc(auth, "teacher_view");
    return true;
  } catch {
    return false;
  }
}
