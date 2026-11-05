/**
 * SB-1 — the storybook catalogue (D-#980/#981/#986, docs/prd-storybook-reading.md).
 *
 *   pure      file name → English title; preview page picks (3, 4, back page)
 *   bands     defaults when none saved; the first save keeps the other default; class → band
 *   tags      create / duplicate refused / rename / merge moves books and series / bulk tag
 *   series    code + band validation; DRAFT on create; status change
 *   upload    a PDF → DRAFT book with only cover + previews kept, series tags inherited,
 *             series cover set, next number given, a taken number refused; replace drops old pages
 *   guardian  sees only PUBLISHED series of their child's band and published, active books;
 *             availability (in / out until / waiting) and the child's own history; another
 *             family's child refused; images gated by band; staff see drafts
 *
 * In-memory MongoDB, real services; Drive and the PDF renderer stubbed.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { AppContext } from "../context";

const driveStore = new Map<string, Buffer>();
let driveSeq = 0;
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
    downloadFromDrive: async (id: string) => {
      const b = driveStore.get(id);
      if (!b) throw new Error("missing");
      return b;
    },
    deleteFromDrive: async (id: string) => {
      driveStore.delete(id);
    },
  };
});

const mockPicks = jest.fn();
jest.mock("../modules/class-books/services/pdfPages", () => {
  const actual = jest.requireActual("../modules/class-books/services/pdfPages");
  return { ...actual, renderPdfPicks: (pdf: Buffer, pick: (n: number) => number[], px: number) => mockPicks(pdf, pick, px) };
});

import { Class } from "../modules/foundation/models/Class";
import { Student } from "../modules/foundation/models/Student";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { StoredFile } from "../modules/platform/models/StoredFile";
import { BookTitle } from "../modules/library/models/BookTitle";
import { BookCopy } from "../modules/library/models/BookCopy";
import { BookLoan } from "../modules/library/models/BookLoan";
import { BookReservation } from "../modules/library/models/BookReservation";
import { StoryAgeBand } from "../modules/library/models/StoryAgeBand";
import { StoryTag } from "../modules/library/models/StoryTag";
import { StorySeries } from "../modules/library/models/StorySeries";
import {
  STORYBOOK_ERRORS_BN,
  assertStorybookFileReadAccess,
  bandCodesForLevels,
  bulkTagStoryBooks,
  clearStorybookPageCache,
  createStorySeries,
  createStoryTag,
  mergeStoryTags,
  previewPicks,
  replaceStorybookPdf,
  resolveShelfViewer,
  saveStoryAgeBand,
  setStoryBookPublished,
  storyAgeBands,
  storyBookDetail,
  storySeriesDetail,
  storyShelf,
  storybookImage,
  titleFromFileName,
  updateStoryBook,
  updateStorySeries,
  updateStoryTag,
  uploadStorybook,
} from "../modules/library/services/StorybookService";

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

const MODELS = [Class, Student, Guardian, GuardianLink, StoredFile, BookTitle, BookCopy, BookLoan, BookReservation, StoryAgeBand, StoryTag, StorySeries];

beforeEach(async () => {
  await Promise.all(MODELS.map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})));
  driveStore.clear();
  mockPicks.mockReset();
  // A 16-page book: render whatever the service picks, tagging each page with its number.
  mockPicks.mockImplementation(async (_pdf: Buffer, pick: (n: number) => number[]) => {
    const pages = new Map<number, Buffer>();
    for (const p of pick(16)) pages.set(p, Buffer.from(`page-${p}`));
    return { pageCount: 16, pages };
  });
  clearStorybookPageCache();
});

const ctxOf = (userId: string, role: string): AppContext => ({ auth: { userId, role } } as unknown as AppContext);
const office = ctxOf(new Types.ObjectId().toString(), "OFFICE");
const officeId = office.auth!.userId;

async function klass(level: number): Promise<Types.ObjectId> {
  const r = await Class.collection.insertOne({ level, nameBn: `L${level}`, academicYearId: new Types.ObjectId(), active: true });
  return r.insertedId;
}

async function student(classId: Types.ObjectId): Promise<Types.ObjectId> {
  seq += 1;
  const r = await Student.collection.insertOne({ schoolId: `S-${seq}`, name: `Kid ${seq}`, classId, sectionId: new Types.ObjectId(), active: true });
  return r.insertedId;
}

async function guardianOf(kids: Types.ObjectId[]): Promise<AppContext> {
  seq += 1;
  const r = await Guardian.collection.insertOne({ identifierKind: "phone", identifier: `0190000${seq}`, name: `G${seq}`, phone: `8801900000${seq}`, loginEnabled: true, active: true });
  for (const k of kids) await GuardianLink.collection.insertOne({ guardianId: r.insertedId, studentId: k, relation: "mother", active: true });
  return ctxOf(r.insertedId.toString(), "GUARDIAN");
}

async function series(code: string, band = "3-6", status: "DRAFT" | "PUBLISHED" = "PUBLISHED") {
  const s = await createStorySeries({ code, nameBn: `সিরিজ ${code}`, ageBandCode: band }, officeId);
  if (status === "PUBLISHED") await updateStorySeries(s._id.toString(), { status: "PUBLISHED" }, officeId);
  return s;
}

async function book(seriesId: Types.ObjectId, name: string, publish = true) {
  const t = await uploadStorybook({ actorId: officeId, seriesId: seriesId.toString(), sourceName: name, pdf: Buffer.from("%PDF") });
  if (publish) await setStoryBookPublished(t._id.toString(), true, officeId);
  return t;
}

let accSeq = 0;
async function copy(titleId: Types.ObjectId, status = "AVAILABLE") {
  accSeq += 1;
  return (await BookCopy.collection.insertOne({ titleId, accessionNo: `ACC-${accSeq}`, status })).insertedId;
}

describe("pure helpers", () => {
  it("turns a file name into an English title", () => {
    expect(titleFromFileName("01_Hamza_Rides_in_a_Car.pdf")).toBe("Hamza Rides in a Car");
    expect(titleFromFileName("T1-1_Aisha_Says_Assalamu_Alaikum.pdf")).toBe("Aisha Says Assalamu Alaikum");
    expect(titleFromFileName("Book01_Noor_and_the_Five_Oceans.pdf")).toBe("Noor and the Five Oceans");
    expect(titleFromFileName("01_Sundarbans_Bangla-English.pdf")).toBe("Sundarbans");
    expect(titleFromFileName("T3-3_Ruqayyah_s_Baby_Brother.pdf")).toBe("Ruqayyah's Baby Brother");
  });

  it("picks pages 3, 4 and the back page unless asked otherwise", () => {
    expect(previewPicks(16)).toEqual([3, 4, 16]);
    expect(previewPicks(3)).toEqual([3]);
    expect(previewPicks(16, [5, 1, 99, 6, 7, 8])).toEqual([5, 6, 7]);
  });
});

describe("age bands", () => {
  it("answers the defaults until one is saved, and the first save keeps the other", async () => {
    const before = await storyAgeBands();
    expect(before.map((b) => [b.code, b.classLevels, b.isDefault])).toEqual([
      ["3-6", [-1, 0, 1], true],
      ["7-9", [2, 3, 4], true],
    ]);
    await saveStoryAgeBand({ code: "3-6", labelBn: "৩–৬ বছর", ageMin: 3, ageMax: 6, classLevels: [-1, 0] }, officeId);
    const after = await storyAgeBands();
    expect(after.map((b) => [b.code, b.classLevels, b.isDefault])).toEqual([
      ["3-6", [-1, 0], false],
      ["7-9", [2, 3, 4], false],
    ]);
    expect(await bandCodesForLevels([1])).toEqual([]);
    expect(await bandCodesForLevels([0])).toEqual(["3-6"]);
  });

  it("refuses a bad class level or age range", async () => {
    await expect(saveStoryAgeBand({ code: "x", labelBn: "x", ageMin: 3, ageMax: 6, classLevels: [9] }, officeId)).rejects.toThrow(STORYBOOK_ERRORS_BN.badLevels);
    await expect(saveStoryAgeBand({ code: "x", labelBn: "x", ageMin: 6, ageMax: 3, classLevels: [1] }, officeId)).rejects.toThrow(STORYBOOK_ERRORS_BN.badAges);
  });
});

describe("tags", () => {
  it("creates, refuses a duplicate, renames, merges and bulk-tags", async () => {
    const nature = await createStoryTag({ nameBn: "প্রকৃতি", nameEn: "Nature" }, officeId);
    await expect(createStoryTag({ nameBn: "প্রকৃতি" }, officeId)).rejects.toThrow(STORYBOOK_ERRORS_BN.dupTag);
    const plants = await createStoryTag({ nameBn: "গাছ" }, officeId);
    const renamed = await updateStoryTag(plants._id.toString(), { nameBn: "গাছপালা" }, officeId);
    expect(renamed.nameBn).toBe("গাছপালা");

    const s = await createStorySeries({ code: "TRE", nameBn: "গাছের গল্প", ageBandCode: "3-6", tagIds: [plants._id.toString()] }, officeId);
    const t = await book(s._id, "01_Mango.pdf", false);
    expect(t.tagIds?.map(String)).toEqual([plants._id.toString()]); // inherited from the series

    await mergeStoryTags(plants._id.toString(), nature._id.toString(), officeId);
    expect((await BookTitle.findById(t._id).lean())!.tagIds!.map(String)).toEqual([nature._id.toString()]);
    expect((await StorySeries.findById(s._id).lean())!.tagIds.map(String)).toEqual([nature._id.toString()]);
    expect((await StoryTag.findById(plants._id).lean())!.active).toBe(false);

    const mystery = await createStoryTag({ nameBn: "রহস্য" }, officeId);
    const t2 = await book(s._id, "02_Jackfruit.pdf", false);
    expect(await bulkTagStoryBooks([t._id.toString(), t2._id.toString()], [mystery._id.toString()], [nature._id.toString()], officeId)).toBe(2);
    const after = await BookTitle.find({ _id: { $in: [t._id, t2._id] } }).lean();
    for (const row of after) expect(row.tagIds!.map(String)).toEqual([mystery._id.toString()]);
  });
});

describe("series", () => {
  it("validates the code and band, starts as a draft, and changes status", async () => {
    await expect(createStorySeries({ code: "tr", nameBn: "x", ageBandCode: "3-6" }, officeId)).resolves.toBeTruthy(); // upper-cased → TR
    await expect(createStorySeries({ code: "TR", nameBn: "x", ageBandCode: "3-6" }, officeId)).rejects.toThrow(STORYBOOK_ERRORS_BN.dupCode);
    await expect(createStorySeries({ code: "TOOLONG", nameBn: "x", ageBandCode: "3-6" }, officeId)).rejects.toThrow(STORYBOOK_ERRORS_BN.badCode);
    await expect(createStorySeries({ code: "AB", nameBn: "x", ageBandCode: "10-12" }, officeId)).rejects.toThrow(STORYBOOK_ERRORS_BN.badBand);
    const s = await createStorySeries({ code: "SEA", nameBn: "সাগরের প্রাণী", ageBandCode: "3-6", learnPointsBn: ["  মাছ চেনা ", ""] }, officeId);
    expect(s.status).toBe("DRAFT");
    expect(s.learnPointsBn).toEqual(["মাছ চেনা"]);
    const u = await updateStorySeries(s._id.toString(), { status: "PUBLISHED", nameEn: "Sea Creatures" }, officeId);
    expect([u.status, u.nameEn]).toEqual(["PUBLISHED", "Sea Creatures"]);
    await expect(updateStorySeries(s._id.toString(), { status: "GONE" }, officeId)).rejects.toThrow(STORYBOOK_ERRORS_BN.badStatus);
  });
});

describe("upload", () => {
  it("keeps only the cover and previews, makes a draft, numbers it, and sets the series cover", async () => {
    const s = await series("TRE");
    const t = await uploadStorybook({ actorId: officeId, seriesId: s._id.toString(), sourceName: "01_Mango_The_Midnight_Mango_Thief.pdf", pdf: Buffer.from("%PDF") });
    expect(t.draft).toBe(true);
    expect(t.seriesNo).toBe(1);
    expect(t.titleEn).toBe("Mango The Midnight Mango Thief");
    expect(t.titleBn).toBe("Mango The Midnight Mango Thief"); // Office types the Bangla name before publishing
    expect(t.previewFileIds).toHaveLength(3);
    const files = await StoredFile.find({ kind: "storybook_page" }).lean();
    expect(files).toHaveLength(4); // never the whole 16-page book
    expect(mockPicks.mock.calls[0][2]).toBe(1000);
    expect((await StorySeries.findById(s._id).lean())!.coverFileId!.toString()).toBe(t.coverFileId!.toString());

    const t2 = await uploadStorybook({ actorId: officeId, seriesId: s._id.toString(), sourceName: "x.pdf", pdf: Buffer.from("%PDF"), previewPages: [5] });
    expect(t2.seriesNo).toBe(2);
    expect(t2.previewFileIds).toHaveLength(1);
    await expect(uploadStorybook({ actorId: officeId, seriesId: s._id.toString(), seriesNo: 2, sourceName: "y.pdf", pdf: Buffer.from("%PDF") })).rejects.toThrow(STORYBOOK_ERRORS_BN.dupNo);
  });

  it("reports a render failure in Bangla and stores nothing", async () => {
    const s = await series("TRE");
    mockPicks.mockRejectedValueOnce(new Error("pdftoppm failed"));
    await expect(uploadStorybook({ actorId: officeId, seriesId: s._id.toString(), sourceName: "bad.pdf", pdf: Buffer.from("x") })).rejects.toThrow(STORYBOOK_ERRORS_BN.renderFailed);
    expect(await BookTitle.countDocuments({})).toBe(0);
  });

  it("replaces a book's pages and drops the old ones, the series cover following", async () => {
    const s = await series("TRE");
    const t = await book(s._id, "01_Mango.pdf");
    const oldCover = t.coverFileId!.toString();
    const r = await replaceStorybookPdf(t._id.toString(), Buffer.from("%PDF2"), null, "01_Mango_v2.pdf", officeId);
    expect(r.coverFileId!.toString()).not.toBe(oldCover);
    expect(await StoredFile.countDocuments({ kind: "storybook_page" })).toBe(4);
    expect(await StoredFile.exists({ _id: oldCover })).toBeNull();
    expect((await StorySeries.findById(s._id).lean())!.coverFileId!.toString()).toBe(r.coverFileId!.toString());
  });

  it("refuses publishing a book with no series and edits book details", async () => {
    const lone = await BookTitle.create({ titleBn: "একা বই", language: "BANGLA", active: true });
    await expect(setStoryBookPublished(lone._id.toString(), true, officeId)).rejects.toThrow(STORYBOOK_ERRORS_BN.needSeries);
    const s = await series("TRE");
    const t = await book(s._id, "01_Mango.pdf", false);
    const e = await updateStoryBook(t._id.toString(), { titleBn: "রাতের আম-চোর", learnedPointsBn: ["আম চেনা", " "], parentTipBn: "একসাথে পড়ুন" }, officeId);
    expect([e.titleBn, e.learnedPointsBn, e.parentTipBn]).toEqual(["রাতের আম-চোর", ["আম চেনা"], "একসাথে পড়ুন"]);
  });
});

describe("what a guardian sees", () => {
  it("shows only published series of the child's band, published books, availability and the child's history", async () => {
    const kg = await klass(0);
    const c3 = await klass(3);
    const kid = await student(kg);
    const older = await student(c3);
    const g = await guardianOf([kid]);

    const tree = await series("TRE");
    await series("DRF", "3-6", "DRAFT");
    await series("BIG", "7-9");
    const t1 = await book(tree._id, "01_Mango.pdf");
    const t2 = await book(tree._id, "02_Jackfruit.pdf");
    await book(tree._id, "03_Coconut.pdf", false); // draft
    const t4 = await book(tree._id, "04_Dates.pdf");
    await BookTitle.updateOne({ _id: t4._id }, { $set: { active: false } }); // retired

    await copy(t1._id);
    const out = await copy(t2._id, "ON_LOAN");
    const due = new Date("2026-11-09T00:00:00Z");
    await BookLoan.collection.insertOne({ copyId: out, titleId: t2._id, borrowerType: "STUDENT", studentId: older, issuedAt: new Date(), dueDate: due, renewCount: 0, status: "ACTIVE", issuedBy: new Types.ObjectId() });
    await BookReservation.collection.insertOne({ titleId: t2._id, borrowerType: "STUDENT", studentId: kid, status: "QUEUED", createdAt: new Date() });
    await BookLoan.collection.insertOne({ copyId: new Types.ObjectId(), titleId: t1._id, borrowerType: "STUDENT", studentId: kid, issuedAt: new Date(), dueDate: new Date(), renewCount: 0, status: "RETURNED", returnedAt: new Date(), issuedBy: new Types.ObjectId() });

    const viewer = await resolveShelfViewer(g, kid.toString());
    const shelf = await storyShelf(viewer);
    expect(shelf.map((c) => [c.series.code, c.bookCount, c.availableBooks])).toEqual([["TRE", 2, 1]]);

    const detail = await storySeriesDetail(viewer, tree._id.toString());
    expect(detail.books.map((b) => [b.title.seriesNo, b.availableCopies, b.waitingCount, b.childReadCount])).toEqual([
      [1, 1, 0, 1],
      [2, 0, 1, 0],
    ]);
    expect(detail.books[1].nextDueDate!.toISOString()).toBe(due.toISOString());

    await expect(storySeriesDetail(viewer, (await StorySeries.findOne({ code: "BIG" }))!._id.toString())).rejects.toThrow(STORYBOOK_ERRORS_BN.seriesNotFound);
    await expect(storyBookDetail(viewer, t4._id.toString())).rejects.toThrow(STORYBOOK_ERRORS_BN.notFound);

    // Another family's child is refused; no child at all is refused for a guardian.
    await expect(resolveShelfViewer(g, older.toString())).rejects.toThrow();
    await expect(resolveShelfViewer(g, null)).rejects.toThrow(STORYBOOK_ERRORS_BN.pickStudent);
  });

  it("lets staff see drafts, and gates images by band", async () => {
    const kg = await klass(0);
    const c3 = await klass(3);
    const g = await guardianOf([await student(kg)]);
    const g3 = await guardianOf([await student(c3)]);
    const tree = await series("TRE");
    const t1 = await book(tree._id, "01_Mango.pdf");
    const draft = await book(tree._id, "02_Draft.pdf", false);

    const staffShelf = await storyShelf(await resolveShelfViewer(office, null));
    expect(staffShelf[0].bookCount).toBe(2);
    expect(staffShelf[0].draftBooks).toBe(1);

    expect(await storybookImage(g, t1.coverFileId!.toString())).toBe(`data:image/jpeg;base64,${Buffer.from("page-1").toString("base64")}`);
    await expect(assertStorybookFileReadAccess(g, draft.coverFileId!.toString())).rejects.toThrow(STORYBOOK_ERRORS_BN.forbidden);
    await expect(assertStorybookFileReadAccess(g3, t1.coverFileId!.toString())).rejects.toThrow(STORYBOOK_ERRORS_BN.forbidden);
    await expect(assertStorybookFileReadAccess(office, draft.coverFileId!.toString())).resolves.toBeUndefined();
    await expect(storybookImage(ctxOf(new Types.ObjectId().toString(), "TEACHER"), t1.coverFileId!.toString())).resolves.toMatch(/^data:image\/jpeg/);
  });
});
