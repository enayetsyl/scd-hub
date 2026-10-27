/**
 * D-#870 — class books (docs/prd-class-books.md).
 *
 *   upload     a PDF becomes PROCESSING, then READY with one page image per page (in
 *              order, aspect read from the JPEG); a render failure leaves FAILED with a
 *              Bangla reason; bad class / title / mime / size refused
 *   guardian   sees only READY, visible books of their linked, active children's class
 *              levels; reads those pages; is refused another class's page, a hidden book,
 *              an unlinked child's class, and a page through /files of another class
 *   staff      class_books:view reads every book; a login without it is refused
 *   pages      1-based, out of range refused; served from the cache on the second read
 *   edit       hide → the guardian loses it; move class; delete drops rows + Drive files
 *
 * In-memory MongoDB, real services; Drive and pdftoppm stubbed.
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

import { Class } from "../modules/foundation/models/Class";
import { Student } from "../modules/foundation/models/Student";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { StoredFile } from "../modules/platform/models/StoredFile";
import { ClassBook } from "../modules/class-books/models/ClassBook";
import { downloadFromDrive } from "../modules/platform/services/DriveStore";
import { jpegSize } from "../modules/class-books/services/pdfPages";
import {
  CLASS_BOOK_ERRORS_BN,
  CLASS_BOOK_MAX_PDF_BYTES,
  assertClassBookFileReadAccess,
  classBookPage,
  classBooksForStaff,
  clearClassBookPageCache,
  deleteClassBook,
  myClassBooks,
  startClassBookUpload,
  updateClassBook,
  validateClassBookUpload,
} from "../modules/class-books/services/ClassBookService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let seq = 0;

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
  await Promise.all([Class, Student, Guardian, GuardianLink, StoredFile, ClassBook].map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})));
  driveStore.clear();
  mockDelete.mockReset();
  mockRender.mockReset();
  clearClassBookPageCache();
  (downloadFromDrive as jest.Mock).mockClear();
});

/** A minimal JPEG header: SOI + SOF0 carrying the size, then a tag byte to tell pages apart. */
function fakeJpeg(w: number, h: number, tag: number): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, tag]);
}

const ctxOf = (userId: string, role: string, extra: Record<string, unknown> = {}): AppContext =>
  ({ auth: { userId, role, ...extra } } as unknown as AppContext);
const office = ctxOf(new Types.ObjectId().toString(), "OFFICE");
const teacher = ctxOf(new Types.ObjectId().toString(), "TEACHER");

async function klass(level: number): Promise<Types.ObjectId> {
  const r = await Class.collection.insertOne({ level, nameBn: `L${level}`, academicYearId: new Types.ObjectId(), active: true });
  return r.insertedId;
}

async function student(classId: Types.ObjectId, active = true): Promise<Types.ObjectId> {
  seq += 1;
  const r = await Student.collection.insertOne({ schoolId: `S-${seq}`, name: `Kid ${seq}`, classId, sectionId: new Types.ObjectId(), active });
  return r.insertedId;
}

async function guardian(kids: Types.ObjectId[], linkActive = true): Promise<AppContext> {
  seq += 1;
  const r = await Guardian.collection.insertOne({ identifierKind: "phone", identifier: `0190000${seq}`, name: `G${seq}`, phone: `8801900000${seq}`, loginEnabled: true, active: true });
  for (const k of kids) await GuardianLink.collection.insertOne({ guardianId: r.insertedId, studentId: k, relation: "mother", active: linkActive });
  return ctxOf(r.insertedId.toString(), "GUARDIAN");
}

async function upload(classLevel: number, title: string, pages = 3): Promise<string> {
  mockRender.mockResolvedValueOnce(Array.from({ length: pages }, (_, i) => fakeJpeg(1050, 1425, i + 1)));
  const { book, done } = await startClassBookUpload({
    actorId: office.auth!.userId,
    classLevel,
    title,
    sourceName: `${title}.pdf`,
    pdf: Buffer.from("%PDF-1.4"),
  });
  await done;
  return book.id;
}

const pageTag = (dataUri: string) => Buffer.from(dataUri.split(",")[1], "base64").at(-1);

describe("upload", () => {
  test("a PDF becomes READY with one page image per page, in order", async () => {
    mockRender.mockResolvedValueOnce([fakeJpeg(1050, 1425, 1), fakeJpeg(1050, 1425, 2)]);
    const { book, done } = await startClassBookUpload({
      actorId: office.auth!.userId,
      classLevel: -1,
      title: "  নার্সারি বাংলা  ",
      sourceName: "bn.pdf",
      pdf: Buffer.from("%PDF"),
    });
    expect(book.status).toBe("PROCESSING");
    expect(book.title).toBe("নার্সারি বাংলা");
    expect(book.classLabelBn).toBe("নার্সারি");
    await done;

    const [row] = await classBooksForStaff();
    expect(row).toMatchObject({ status: "READY", pageCount: 2, error: null });
    expect(row.pageAspect).toBeCloseTo(1425 / 1050, 5);
    const files = await StoredFile.find({ kind: "class_book_page" }).lean();
    expect(files).toHaveLength(2);
    const p2 = await classBookPage(office, row.id, 2);
    expect(p2.dataUri.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(pageTag(p2.dataUri)).toBe(2);
  });

  test("a render failure leaves the book FAILED with a Bangla reason, and no pages", async () => {
    mockRender.mockRejectedValueOnce(new Error("pdftoppm: broken"));
    const { done } = await startClassBookUpload({ actorId: office.auth!.userId, classLevel: 0, title: "KG", sourceName: "x.pdf", pdf: Buffer.from("x") });
    await done;
    const [row] = await classBooksForStaff();
    expect(row).toMatchObject({ status: "FAILED", error: CLASS_BOOK_ERRORS_BN.renderFailed, pageCount: 0 });
    await expect(classBookPage(office, row.id, 1)).rejects.toThrow(CLASS_BOOK_ERRORS_BN.notReady);
  });

  test("bad class, empty title, non-PDF and oversized files are refused", async () => {
    await expect(startClassBookUpload({ actorId: office.auth!.userId, classLevel: 9, title: "x", sourceName: "", pdf: Buffer.from("x") })).rejects.toThrow(CLASS_BOOK_ERRORS_BN.badClass);
    await expect(startClassBookUpload({ actorId: office.auth!.userId, classLevel: 1, title: "  ", sourceName: "", pdf: Buffer.from("x") })).rejects.toThrow(CLASS_BOOK_ERRORS_BN.badTitle);
    expect(validateClassBookUpload("image/png", 10)).toBe(CLASS_BOOK_ERRORS_BN.badMime);
    expect(validateClassBookUpload("application/pdf", CLASS_BOOK_MAX_PDF_BYTES + 1)).toBe(CLASS_BOOK_ERRORS_BN.tooLarge);
    expect(validateClassBookUpload("application/pdf", 1000)).toBeNull();
    expect(await ClassBook.countDocuments()).toBe(0);
  });

  test("jpegSize reads the SOF marker", () => {
    expect(jpegSize(fakeJpeg(800, 600, 0))).toEqual({ width: 800, height: 600 });
    expect(jpegSize(Buffer.from([0xff, 0xd8, 0x00]))).toBeNull();
  });
});

describe("guardian", () => {
  test("sees only READY, visible books of their children's class levels", async () => {
    const nursery = await klass(-1);
    const kg = await klass(0);
    const g = await guardian([await student(nursery)]);
    const bn = await upload(-1, "বাংলা");
    await upload(0, "KG English");
    const hidden = await upload(-1, "Hidden");
    await updateClassBook(office.auth!.userId, hidden, { active: false });
    mockRender.mockImplementationOnce(() => new Promise(() => undefined)); // never finishes
    await startClassBookUpload({ actorId: office.auth!.userId, classLevel: -1, title: "Still rendering", sourceName: "", pdf: Buffer.from("x") });

    const mine = await myClassBooks(g.auth!.userId);
    expect(mine.map((b) => b.id)).toEqual([bn]);
    // Staff see all four (hidden and processing included).
    expect(await classBooksForStaff()).toHaveLength(4);
    expect(await classBooksForStaff(-1)).toHaveLength(3);
    void kg;
  });

  test("reads their child's class pages and is refused everything else", async () => {
    const nursery = await klass(-1);
    const kg = await klass(0);
    const g = await guardian([await student(nursery)]);
    const unlinked = await guardian([await student(kg)], false);
    const left = await guardian([await student(kg, false)]);
    const bn = await upload(-1, "বাংলা");
    const kgBook = await upload(0, "KG");

    expect(pageTag((await classBookPage(g, bn, 1)).dataUri)).toBe(1);
    await expect(classBookPage(g, kgBook, 1)).rejects.toThrow(CLASS_BOOK_ERRORS_BN.forbidden);
    await expect(classBookPage(unlinked, kgBook, 1)).rejects.toThrow(CLASS_BOOK_ERRORS_BN.forbidden);
    await expect(classBookPage(left, kgBook, 1)).rejects.toThrow(CLASS_BOOK_ERRORS_BN.forbidden);
    expect(await myClassBooks(unlinked.auth!.userId)).toEqual([]);

    // The /files/:id gate for a page id is the same gate.
    const kgRow = await ClassBook.findById(kgBook).lean();
    await expect(assertClassBookFileReadAccess(g, kgRow!.pageFileIds[0].toString())).rejects.toThrow(CLASS_BOOK_ERRORS_BN.forbidden);
    const bnRow = await ClassBook.findById(bn).lean();
    await expect(assertClassBookFileReadAccess(g, bnRow!.pageFileIds[0].toString())).resolves.toBeUndefined();

    // Hidden → gone for the family.
    await updateClassBook(office.auth!.userId, bn, { active: false });
    await expect(classBookPage(g, bn, 1)).rejects.toThrow(CLASS_BOOK_ERRORS_BN.forbidden);
    // Moved to KG and shown again → still not theirs.
    await updateClassBook(office.auth!.userId, bn, { active: true, classLevel: 0 });
    await expect(classBookPage(g, bn, 1)).rejects.toThrow(CLASS_BOOK_ERRORS_BN.forbidden);
  });
});

describe("staff and pages", () => {
  test("class_books:view reads any book; a login without it is refused", async () => {
    const id = await upload(3, "C3");
    expect((await classBookPage(teacher, id, 3)).pageCount).toBe(3);
    const revoked = ctxOf(new Types.ObjectId().toString(), "TEACHER", { revokedPermissions: ["class_books:view"] });
    await expect(classBookPage(revoked, id, 1)).rejects.toThrow(CLASS_BOOK_ERRORS_BN.forbidden);
  });

  test("pages are 1-based and bounded; a second read comes from the cache", async () => {
    const id = await upload(1, "C1", 2);
    await expect(classBookPage(office, id, 0)).rejects.toThrow(CLASS_BOOK_ERRORS_BN.badPage);
    await expect(classBookPage(office, id, 3)).rejects.toThrow(CLASS_BOOK_ERRORS_BN.badPage);
    await expect(classBookPage(office, "nope", 1)).rejects.toThrow(CLASS_BOOK_ERRORS_BN.notFound);
    await classBookPage(office, id, 1);
    await classBookPage(office, id, 1);
    expect(downloadFromDrive).toHaveBeenCalledTimes(1);
  });

  test("delete removes the book, its page rows and its Drive files", async () => {
    const id = await upload(2, "C2", 3);
    await upload(2, "Other", 1);
    expect(await deleteClassBook(office.auth!.userId, id)).toBe(true);
    expect(await ClassBook.countDocuments()).toBe(1);
    expect(await StoredFile.countDocuments({ kind: "class_book_page" })).toBe(1);
    expect(mockDelete).toHaveBeenCalledTimes(3);
    await expect(classBookPage(office, id, 1)).rejects.toThrow(CLASS_BOOK_ERRORS_BN.notFound);
  });

  test("edit refuses an empty title and a bad class", async () => {
    const id = await upload(1, "C1", 1);
    await expect(updateClassBook(office.auth!.userId, id, { title: " " })).rejects.toThrow(CLASS_BOOK_ERRORS_BN.badTitle);
    await expect(updateClassBook(office.auth!.userId, id, { classLevel: 7 })).rejects.toThrow(CLASS_BOOK_ERRORS_BN.badClass);
    const r = await updateClassBook(office.auth!.userId, id, { title: "নতুন নাম", sortOrder: 2 });
    expect(r).toMatchObject({ title: "নতুন নাম", sortOrder: 2 });
  });
});
