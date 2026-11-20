/**
 * PB-1 (D-#1657, nov-ops F4) — the printed pages of a school book.
 *
 *   upload     a PDF → PROCESSING → READY with one page image per page; render failure → FAILED;
 *              unknown book / bad mime / size refused; a re-upload keeps the chapter ranges, keeps
 *              serving the old pages until the swap, then drops them; a failed re-upload keeps them
 *   chapters   ranges validated (unique keys, inside the pages) and sliced/clamped per chapter
 *   gate       teachers (plan-book read / class_books:view) read; guardian never; hidden/processing
 *              pages stay closed to a teacher but open to the manager; /files gate same rules
 *   delete     drops rows + Drive files
 *
 * In-memory MongoDB, real service; Drive and pdftoppm stubbed; the book plane's SchoolBook stubbed.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { AppContext } from "../context";

const driveStore = new Map<string, Buffer>();
let driveSeq = 0;
const mockDelete = jest.fn();
jest.mock("../modules/platform/services/DriveStore", () => {
  const actual = jest.requireActual("../modules/platform/services/DriveStore");
  return {
    ...actual,
    uploadToDrive: async (i: { data: Buffer }) => {
      driveSeq += 1;
      const id = `drive-${driveSeq}`;
      driveStore.set(id, i.data);
      return id;
    },
    downloadFromDrive: jest.fn(async (id: string) => {
      const b = driveStore.get(id);
      if (!b) throw new Error("missing");
      return b;
    }),
    deleteFromDrive: async (id: string) => {
      mockDelete(id);
      driveStore.delete(id);
    },
  };
});

const mockRender = jest.fn();
jest.mock("../modules/class-books/services/pdfPages", () => {
  const actual = jest.requireActual("../modules/class-books/services/pdfPages");
  return { ...actual, renderPdfPages: (pdf: Buffer) => mockRender(pdf) };
});

// The book plane: one fixture book, no database behind it.
const FIXTURE_BOOK = { _id: new Types.ObjectId(), code: "C3-BAN", classLevel: 3, subject: "BAN", titleBn: "বাংলা ৩য় শ্রেণি" };
jest.mock("../bookDb", () => ({ ...jest.requireActual("../bookDb"), isBookDbReady: () => true }));
jest.mock("../modules/book-lifecycle/models/SchoolBook", () => ({
  SchoolBook: {
    findOne: jest.fn(async (q: { code?: string }) => (q.code === FIXTURE_BOOK.code ? FIXTURE_BOOK : null)),
    find: () => ({ select: () => ({ lean: async () => [FIXTURE_BOOK] }) }),
  },
}));
jest.mock("../modules/book-lifecycle/services/planBook", () => ({ pickPlanBookVersion: async () => null }));

jest.mock("../modules/platform/services/AuditService", () => ({ writeAudit: jest.fn(async () => undefined) }));
import { StoredFile } from "../modules/platform/models/StoredFile";
import { BookPdf, chapterPageRange } from "../modules/book-pdf/models/BookPdf";
import {
  BOOK_PDF_ERRORS_BN,
  BOOK_PDF_MAX_BYTES,
  BookPdfBusyError,
  assertBookPdfFileReadAccess,
  bookPdfAdminRows,
  bookPdfPage,
  bookPdfShelf,
  clearBookPdfPageCache,
  deleteBookPdf,
  setBookPdfChapters,
  startBookPdfUpload,
  updateBookPdf,
  validateBookPdfUpload,
} from "../modules/book-pdf/services/BookPdfService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([StoredFile, BookPdf].map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})));
  driveStore.clear();
  mockDelete.mockReset();
  mockRender.mockReset();
  clearBookPdfPageCache();
});

/** A minimal JPEG header: SOI + SOF0 carrying the size, then a tag byte to tell pages apart. */
function fakeJpeg(w: number, h: number, tag: number): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, tag]);
}
const pagesOf = (n: number, tag = 0): Buffer[] => Array.from({ length: n }, (_v, i) => fakeJpeg(1000, 1400, tag + i + 1));

const ctxOf = (role: string, extra: Record<string, unknown> = {}): AppContext =>
  ({ auth: { userId: new Types.ObjectId().toString(), role, ...extra } } as unknown as AppContext);
const office = ctxOf("OFFICE");
const teacher = ctxOf("TEACHER");
const guardian = ctxOf("GUARDIAN");
const actor = new Types.ObjectId().toString();

async function upload(pages = 6, versionLabel: string | null = "v2.1") {
  mockRender.mockResolvedValueOnce(pagesOf(pages));
  const { pdf, done } = await startBookPdfUpload({ actorId: actor, bookCode: "C3-BAN", versionLabel, sourceName: "book.pdf", pdf: Buffer.from("%PDF") });
  await done;
  return pdf;
}

describe("upload", () => {
  it("PROCESSING then READY with one stored page per PDF page, in order, aspect from the JPEG", async () => {
    mockRender.mockResolvedValueOnce(pagesOf(4));
    const { pdf, done } = await startBookPdfUpload({ actorId: actor, bookCode: "C3-BAN", versionLabel: "v2.1", sourceName: "x.pdf", pdf: Buffer.from("%PDF") });
    expect(pdf).toMatchObject({ status: "PROCESSING", bookCode: "C3-BAN", classLevel: 3, subject: "BAN", versionLabel: "v2.1" });
    await done;
    const row = await BookPdf.findById(pdf.id).lean();
    expect(row).toMatchObject({ status: "READY", pageCount: 4 });
    expect(row!.pageAspect).toBeCloseTo(1.4, 2);
    const files = await StoredFile.find({ kind: "bookpdf_page" }).lean();
    expect(files).toHaveLength(4);
    const p2 = await bookPdfPage(teacher, pdf.id, 2);
    expect(p2).toMatchObject({ page: 2, pageCount: 4 });
    expect(Buffer.from(p2.dataUri.split(",")[1], "base64")[20]).toBe(2);
  });

  it("a render failure leaves FAILED with a Bangla reason", async () => {
    mockRender.mockRejectedValueOnce(new Error("pdftoppm failed"));
    const { pdf, done } = await startBookPdfUpload({ actorId: actor, bookCode: "C3-BAN", sourceName: "x.pdf", pdf: Buffer.from("x") });
    await done;
    expect(await BookPdf.findById(pdf.id).lean()).toMatchObject({ status: "FAILED", error: BOOK_PDF_ERRORS_BN.renderFailed });
  });

  it("an unknown book, a non-PDF and an oversize file are refused", async () => {
    await expect(startBookPdfUpload({ actorId: actor, bookCode: "NOPE", sourceName: "", pdf: Buffer.from("x") })).rejects.toThrow(BOOK_PDF_ERRORS_BN.badBook);
    expect(validateBookPdfUpload("image/png", 10)).toBe(BOOK_PDF_ERRORS_BN.badMime);
    expect(validateBookPdfUpload("application/pdf", BOOK_PDF_MAX_BYTES + 1)).toBe(BOOK_PDF_ERRORS_BN.tooLarge);
    expect(validateBookPdfUpload("application/pdf", 10)).toBeNull();
  });

  it("a re-upload keeps chapter ranges and the version label, serves the old pages until the swap, then drops them", async () => {
    const first = await upload(6, "v2.1");
    await setBookPdfChapters(actor, "C3-BAN", [{ key: "ch-001", title: "পাঠ ১", fromPage: 2, toPage: 4 }]);
    const oldIds = (await BookPdf.findById(first.id).lean())!.pageFileIds.map(String);

    let release!: (v: Buffer[]) => void;
    mockRender.mockReturnValueOnce(new Promise<Buffer[]>((r) => (release = r)));
    const { pdf, done } = await startBookPdfUpload({ actorId: actor, bookCode: "C3-BAN", versionLabel: "", sourceName: "v2.pdf", pdf: Buffer.from("%PDF") });
    expect(pdf).toMatchObject({ id: first.id, status: "READY", replacing: true, versionLabel: "v2.1" });
    // the old page still serves while the new one renders
    expect((await bookPdfPage(teacher, first.id, 1)).page).toBe(1);
    release(pagesOf(8, 100));
    await done;

    const row = await BookPdf.findById(first.id).lean();
    expect(row).toMatchObject({ status: "READY", replacing: false, pageCount: 8, sourceName: "v2.pdf" });
    expect(row!.chapters).toHaveLength(1);
    expect(row!.chapters[0]).toMatchObject({ key: "ch-001", fromPage: 2, toPage: 4 });
    expect(await StoredFile.countDocuments({ _id: { $in: oldIds } })).toBe(0);
    expect(await StoredFile.countDocuments({ kind: "bookpdf_page" })).toBe(8);
    expect(mockDelete).toHaveBeenCalledTimes(6);
  });

  it("a failed re-upload keeps the old pages readable and records the reason", async () => {
    const first = await upload(3);
    mockRender.mockRejectedValueOnce(new Error("boom"));
    const { done } = await startBookPdfUpload({ actorId: actor, bookCode: "C3-BAN", sourceName: "bad.pdf", pdf: Buffer.from("x") });
    await done;
    expect(await BookPdf.findById(first.id).lean()).toMatchObject({ status: "READY", replacing: false, pageCount: 3, error: BOOK_PDF_ERRORS_BN.renderFailed });
    expect((await bookPdfPage(teacher, first.id, 3)).page).toBe(3);
  });
});

describe("chapters", () => {
  it("validates keys and ranges, saves them, and slices (clamped) per chapter", async () => {
    const pdf = await upload(10);
    await expect(setBookPdfChapters(actor, "C3-BAN", [{ key: "a", fromPage: 5, toPage: 4 }])).rejects.toThrow(BOOK_PDF_ERRORS_BN.badChapter);
    await expect(setBookPdfChapters(actor, "C3-BAN", [{ key: "a", fromPage: 1, toPage: 11 }])).rejects.toThrow(BOOK_PDF_ERRORS_BN.badChapter);
    await expect(setBookPdfChapters(actor, "C3-BAN", [{ key: "a", fromPage: 1, toPage: 2 }, { key: "a", fromPage: 3, toPage: 4 }])).rejects.toThrow(BOOK_PDF_ERRORS_BN.badChapter);
    await expect(setBookPdfChapters(actor, "C3-BAN", [{ key: " ", fromPage: 1, toPage: 2 }])).rejects.toThrow(BOOK_PDF_ERRORS_BN.badChapter);
    const saved = await setBookPdfChapters(actor, "C3-BAN", [
      { key: "ch-001", title: "পাঠ ১", fromPage: 3, toPage: 5 },
      { key: "ch-002", title: "পাঠ ২", fromPage: 6, toPage: 10 },
    ]);
    expect(saved.chapters).toHaveLength(2);
    const row = (await BookPdf.findById(pdf.id).lean())!;
    expect(chapterPageRange(row, "ch-001")).toEqual({ fromPage: 3, toPage: 5 });
    expect(chapterPageRange(row, "nope")).toBeNull();
    // a shorter replacement book clamps a range that now runs past the end
    expect(chapterPageRange({ pageCount: 8, chapters: row.chapters }, "ch-002")).toEqual({ fromPage: 6, toPage: 8 });
    expect(chapterPageRange({ pageCount: 5, chapters: row.chapters }, "ch-002")).toBeNull();
    await expect(setBookPdfChapters(actor, "NOPE", [])).rejects.toThrow(BOOK_PDF_ERRORS_BN.notFound);
  });
});

describe("who reads the pages", () => {
  it("a teacher reads; a guardian and an anonymous caller never do (page query, shelf, /files)", async () => {
    const pdf = await upload(3);
    expect((await bookPdfPage(teacher, pdf.id, 1)).page).toBe(1);
    expect((await bookPdfShelf(teacher)).map((b) => b.bookCode)).toEqual(["C3-BAN"]);
    await expect(bookPdfPage(guardian, pdf.id, 1)).rejects.toThrow(BOOK_PDF_ERRORS_BN.forbidden);
    await expect(bookPdfShelf(guardian)).rejects.toThrow(BOOK_PDF_ERRORS_BN.forbidden);
    await expect(bookPdfPage({ auth: null } as unknown as AppContext, pdf.id, 1)).rejects.toThrow(BOOK_PDF_ERRORS_BN.forbidden);
    const fileId = (await BookPdf.findById(pdf.id).lean())!.pageFileIds[0].toString();
    await expect(assertBookPdfFileReadAccess(teacher, fileId)).resolves.toBeUndefined();
    await expect(assertBookPdfFileReadAccess(guardian, fileId)).rejects.toThrow(BOOK_PDF_ERRORS_BN.forbidden);
    await expect(assertBookPdfFileReadAccess(teacher, new Types.ObjectId().toString())).rejects.toThrow(BOOK_PDF_ERRORS_BN.forbidden);
  });

  it("a login holding none of the read actions is refused", async () => {
    const pdf = await upload(2);
    const nobody = ctxOf("TEACHER", { revokedPermissions: ["lesson_plans:read_book", "class_books:view"] });
    await expect(bookPdfPage(nobody, pdf.id, 1)).rejects.toThrow(BOOK_PDF_ERRORS_BN.forbidden);
  });

  it("hidden: closed to a teacher, open to the manager; out-of-range pages refused; page bytes cached", async () => {
    const pdf = await upload(3);
    await updateBookPdf(actor, "C3-BAN", { active: false });
    await expect(bookPdfPage(teacher, pdf.id, 1)).rejects.toThrow(BOOK_PDF_ERRORS_BN.forbidden);
    expect(await bookPdfShelf(teacher)).toEqual([]);
    expect((await bookPdfPage(office, pdf.id, 1)).page).toBe(1);
    await updateBookPdf(actor, "C3-BAN", { active: true });
    await expect(bookPdfPage(teacher, pdf.id, 0)).rejects.toThrow(BOOK_PDF_ERRORS_BN.badPage);
    await expect(bookPdfPage(teacher, pdf.id, 4)).rejects.toThrow(BOOK_PDF_ERRORS_BN.badPage);
    const { downloadFromDrive } = jest.requireMock("../modules/platform/services/DriveStore") as { downloadFromDrive: jest.Mock };
    downloadFromDrive.mockClear();
    await bookPdfPage(teacher, pdf.id, 2);
    await bookPdfPage(teacher, pdf.id, 2);
    expect(downloadFromDrive).toHaveBeenCalledTimes(1); // the second read of page 2 comes from the cache
  });
});

describe("admin shelf and delete", () => {
  it("lists every school book with its PDF (or none), and delete drops rows + Drive files", async () => {
    expect(await bookPdfAdminRows()).toMatchObject([{ bookCode: "C3-BAN", pdf: null }]);
    const pdf = await upload(3);
    expect((await bookPdfAdminRows())[0].pdf).toMatchObject({ id: pdf.id, status: "READY", pageCount: 3 });
    expect(await deleteBookPdf(actor, "C3-BAN")).toBe(true);
    expect(await BookPdf.countDocuments({})).toBe(0);
    expect(await StoredFile.countDocuments({ kind: "bookpdf_page" })).toBe(0);
    expect(mockDelete).toHaveBeenCalledTimes(3);
    await expect(deleteBookPdf(actor, "C3-BAN")).rejects.toThrow(BOOK_PDF_ERRORS_BN.notFound);
  });
});

describe("one render per book, safe finish, stale rows", () => {
  it("refuses a second upload while a render is running (busy), for a new and a replaced book", async () => {
    let release!: (v: Buffer[]) => void;
    mockRender.mockReturnValueOnce(new Promise<Buffer[]>((r) => (release = r)));
    const first = await startBookPdfUpload({ actorId: actor, bookCode: "C3-BAN", sourceName: "a.pdf", pdf: Buffer.from("%PDF") });
    await expect(startBookPdfUpload({ actorId: actor, bookCode: "C3-BAN", sourceName: "b.pdf", pdf: Buffer.from("%PDF") })).rejects.toBeInstanceOf(BookPdfBusyError);
    release(pagesOf(2));
    await first.done;
    // READY now; start a replace and try again while it renders
    mockRender.mockReturnValueOnce(new Promise<Buffer[]>((r) => (release = r)));
    const second = await startBookPdfUpload({ actorId: actor, bookCode: "C3-BAN", sourceName: "c.pdf", pdf: Buffer.from("%PDF") });
    await expect(startBookPdfUpload({ actorId: actor, bookCode: "C3-BAN", sourceName: "d.pdf", pdf: Buffer.from("%PDF") })).rejects.toBeInstanceOf(BookPdfBusyError);
    release(pagesOf(3));
    await second.done;
    expect(await BookPdf.findOne({ bookCode: "C3-BAN" }).lean()).toMatchObject({ status: "READY", pageCount: 3, replacing: false });
  });

  it("a book deleted mid-render leaves no orphan pages", async () => {
    let release!: (v: Buffer[]) => void;
    mockRender.mockReturnValueOnce(new Promise<Buffer[]>((r) => (release = r)));
    const { done } = await startBookPdfUpload({ actorId: actor, bookCode: "C3-BAN", sourceName: "a.pdf", pdf: Buffer.from("%PDF") });
    await deleteBookPdf(actor, "C3-BAN");
    release(pagesOf(4));
    await done;
    expect(await BookPdf.countDocuments({})).toBe(0);
    expect(await StoredFile.countDocuments({ kind: "bookpdf_page" })).toBe(0);
    expect(mockDelete).toHaveBeenCalledTimes(4);
  });

  it("a READY row stuck with replacing=true after a restart reads as not replacing and may be redone", async () => {
    const first = await upload(2);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await BookPdf.collection.updateOne({ _id: new Types.ObjectId(first.id) }, { $set: { replacing: true, updatedAt: old } });
    const row = (await bookPdfAdminRows())[0].pdf!;
    expect(row).toMatchObject({ status: "READY", replacing: false });
    mockRender.mockResolvedValueOnce(pagesOf(2));
    const { done } = await startBookPdfUpload({ actorId: actor, bookCode: "C3-BAN", sourceName: "again.pdf", pdf: Buffer.from("%PDF") });
    await done;
    expect(await BookPdf.findById(first.id).lean()).toMatchObject({ status: "READY", replacing: false, sourceName: "again.pdf" });
  });

  it("hide / show writes an audit row", async () => {
    await upload(2);
    const writeAudit = jest.requireMock("../modules/platform/services/AuditService") as { writeAudit: jest.Mock };
    writeAudit.writeAudit.mockClear();
    await updateBookPdf(actor, "C3-BAN", { active: false });
    expect(writeAudit.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "BOOK_PDF_EDITED", meta: expect.objectContaining({ after: expect.objectContaining({ active: false }) }) }));
  });
});
