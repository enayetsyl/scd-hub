/**
 * SB-2 — the storybook desk (D-#982/#983/#985/#990, docs/prd-storybook-reading.md).
 *
 *   codes      TRE-7-1 / tre 07 1 → TRE-07-1; copies made per book, idempotent, by number
 *   children   a typed school ID matches numerically (103 = 0103, never 1035); name search;
 *              today's desk list, newest first
 *   issue      2 at once for a child; a 3rd refused; an overdue book blocks a new one
 *   holiday    a rule in force lifts the limit and sets the due day; validation
 *   return     read → sticker by default; not read → no sticker; a waiting child gets the hold
 *   lookup     who has it, who it is held for, how many wait
 *   stickers   a real PDF, one page per 24
 *
 * In-memory MongoDB, real services.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { BookTitle } from "../modules/library/models/BookTitle";
import { BookCopy } from "../modules/library/models/BookCopy";
import { BookLoan } from "../modules/library/models/BookLoan";
import { BookReservation } from "../modules/library/models/BookReservation";
import { StorySeries } from "../modules/library/models/StorySeries";
import { LibraryHolidayRule } from "../modules/library/models/LibraryHolidayRule";
import { LibraryPolicy } from "../modules/library/models/LibraryPolicy";
import { issueBook, returnBook } from "../modules/library/services/LibraryCirculationService";
import { reserveTitle } from "../modules/library/services/LibraryReservationService";
import {
  STORY_DESK_ERRORS_BN,
  addStoryCopies,
  deskStudentsToday,
  findDeskStudents,
  lookupStoryCopy,
  normalizeCopyCode,
  saveLibraryHolidayRule,
  storyStickerCodes,
  storyStickerPdf,
} from "../modules/library/services/StoryDeskService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const actor = new Types.ObjectId().toString();

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
  await Promise.all(
    [Class, Section, Student, BookTitle, BookCopy, BookLoan, BookReservation, StorySeries, LibraryHolidayRule, LibraryPolicy].map((m) =>
      (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
});

let seq = 0;
async function kid(schoolId: string, nameBn: string) {
  seq += 1;
  const cls = await Class.collection.insertOne({ level: 0, nameBn: "কেজি", academicYearId: new Types.ObjectId(), active: true });
  const sec = await Section.collection.insertOne({ classId: cls.insertedId, code: `A${seq}`, nameBn: "কেজি বালিকা" });
  const r = await Student.collection.insertOne({ schoolId, name: `Kid ${seq}`, nameBn, classId: cls.insertedId, sectionId: sec.insertedId, rollNumber: String(seq), active: true });
  return r.insertedId.toString();
}

async function treSeries(books = 3) {
  const s = await StorySeries.create({ code: "TRE", nameBn: "গাছের গল্প", nameEn: "Tree Adventures", ageBandCode: "3-6", status: "PUBLISHED" });
  for (let n = 1; n <= books; n++) await BookTitle.create({ titleBn: `বই ${n}`, language: "BANGLA", active: true, seriesId: s._id, seriesNo: n });
  return s;
}

const student = (id: string) => ({ type: "STUDENT" as const, id });

describe("codes and copies", () => {
  it("normalises typed codes", () => {
    expect(normalizeCopyCode("tre-7-1")).toBe("TRE-07-1");
    expect(normalizeCopyCode(" TRE 07 2 ")).toBe("TRE-07-2");
    expect(normalizeCopyCode("tre07-1")).toBe("TRE-07-1");
    expect(normalizeCopyCode("ACC-0042")).toBe("ACC-0042"); // an ordinary accession number passes through
  });

  it("makes N copies per book, only the missing ones, optionally for listed numbers", async () => {
    const s = await treSeries(3);
    expect(await addStoryCopies(s._id.toString(), 1, null, actor)).toEqual(["TRE-01-1", "TRE-02-1", "TRE-03-1"]);
    expect(await addStoryCopies(s._id.toString(), 2, [2], actor)).toEqual(["TRE-02-2"]);
    expect(await addStoryCopies(s._id.toString(), 2, null, actor)).toEqual(["TRE-01-2", "TRE-03-2"]);
    expect(await BookCopy.countDocuments({})).toBe(6);
    await expect(addStoryCopies(s._id.toString(), 9, null, actor)).rejects.toThrow(STORY_DESK_ERRORS_BN.badCopies);
  });
});

describe("finding a child", () => {
  it("matches a typed school ID numerically and never a longer ID", async () => {
    const a = await kid("0103", "আয়েশা");
    await kid("1035", "হামযা");
    await kid("2103", "মারইয়াম");
    const hits = await findDeskStudents("103");
    expect(hits.map((h) => h.id)).toEqual([a]);
    expect(hits[0]).toMatchObject({ name: "আয়েশা", schoolId: "0103", classLabelBn: "কেজি", sectionNameBn: "কেজি বালিকা", activeLoans: 0, maxLoans: 2, overdue: false });
    expect((await findDeskStudents("হামযা")).map((h) => h.schoolId)).toEqual(["1035"]);
  });
});

describe("issue, limits and the holiday rule", () => {
  it("allows 2 books, refuses a 3rd, and an overdue book blocks a new one", async () => {
    const s = await treSeries(4);
    await addStoryCopies(s._id.toString(), 1, null, actor);
    const a = await kid("0103", "আয়েশা");
    await issueBook("TRE-01-1", student(a), actor);
    const second = await issueBook("TRE-02-1", student(a), actor);
    await expect(issueBook("TRE-03-1", student(a), actor)).rejects.toThrow("সর্বোচ্চ 2টি");
    // Seven days pass: the first two are overdue — return one, the other still blocks.
    const later = new Date(Date.now() + 9 * 86_400_000);
    await returnBook(second._id.toString(), actor, later);
    await expect(issueBook("TRE-03-1", student(a), actor, later)).rejects.toThrow("ফেরতের সময় পেরিয়ে গেছে");
  });

  it("a holiday rule lifts the limit and sets the due day", async () => {
    const s = await treSeries(4);
    await addStoryCopies(s._id.toString(), 1, null, actor);
    const a = await kid("0103", "আয়েশা");
    await saveLibraryHolidayRule({ nameBn: "শীতের ছুটি", fromDay: "2026-12-20", toDay: "2026-12-31", dueDay: "2027-01-01", maxConcurrent: 4 }, actor);
    const inHoliday = new Date("2026-12-22T09:00:00+06:00");
    const loans = [];
    for (const n of [1, 2, 3]) loans.push(await issueBook(`TRE-0${n}-1`, student(a), actor, inHoliday));
    expect(loans[2].dueDate.toISOString()).toBe(new Date("2027-01-01T23:59:59+06:00").toISOString());
    expect(loans[2].holidayRuleId).toBeTruthy();
    const desk = await findDeskStudents("103");
    expect(desk[0].activeLoans).toBe(3);
  });

  it("validates a holiday rule", async () => {
    const base = { nameBn: "ঈদ", fromDay: "2027-03-26", toDay: "2027-04-05", dueDay: "2027-04-06", maxConcurrent: 4 };
    await expect(saveLibraryHolidayRule({ ...base, toDay: "2027-03-01" }, actor)).rejects.toThrow(STORY_DESK_ERRORS_BN.badWindow);
    await expect(saveLibraryHolidayRule({ ...base, dueDay: "2027-04-01" }, actor)).rejects.toThrow(STORY_DESK_ERRORS_BN.badDue);
    await expect(saveLibraryHolidayRule({ ...base, maxConcurrent: 0 }, actor)).rejects.toThrow(STORY_DESK_ERRORS_BN.badMax);
    await expect(saveLibraryHolidayRule({ ...base, fromDay: "26/03/2027" }, actor)).rejects.toThrow(STORY_DESK_ERRORS_BN.badDay);
    const r = await saveLibraryHolidayRule(base, actor);
    const off = await saveLibraryHolidayRule({ ...base, ruleId: r._id.toString(), active: false }, actor);
    expect(off.active).toBe(false);
  });
});

describe("return, lookup and today's list", () => {
  it("records read + sticker, hands a waiting child the hold, and lists today's children", async () => {
    const s = await treSeries(1);
    await addStoryCopies(s._id.toString(), 1, null, actor);
    const a = await kid("0103", "আয়েশা");
    const m = await kid("0204", "মারইয়াম");
    const loan = await issueBook("TRE-01-1", student(a), actor);
    let look = await lookupStoryCopy("tre-1-1");
    expect([look.borrower?.name, look.loan?._id.toString(), look.waitingCount]).toEqual(["আয়েশা", loan._id.toString(), 0]);

    const title = await BookTitle.findOne({ seriesNo: 1 });
    await reserveTitle(title!._id.toString(), student(m), actor);
    look = await lookupStoryCopy("TRE-01-1");
    expect(look.waitingCount).toBe(1);

    const back = await returnBook(loan._id.toString(), actor, new Date(), { read: true });
    expect([back.readAtReturn, back.stickerGiven]).toEqual([true, true]);
    look = await lookupStoryCopy("TRE-01-1");
    expect([look.copy.status, look.heldFor?.name, look.loan]).toEqual(["ON_HOLD", "মারইয়াম", null]);

    const loan2 = await issueBook("TRE-01-1", student(m), actor);
    const back2 = await returnBook(loan2._id.toString(), actor, new Date(), { read: false });
    expect([back2.readAtReturn, back2.stickerGiven]).toEqual([false, false]);

    const today = await deskStudentsToday();
    expect(today.map((t) => t.name)).toEqual(["মারইয়াম", "আয়েশা"]);
  });
});

describe("sticker sheet", () => {
  it("makes a real PDF with one page per 24 labels", async () => {
    const s = await treSeries(13);
    await addStoryCopies(s._id.toString(), 2, null, actor); // 26 copies → 2 pages
    const labels = await storyStickerCodes(s._id.toString(), null);
    expect(labels).toHaveLength(26);
    expect(labels[0]).toEqual({ code: "TRE-01-1", seriesNo: 1, seriesName: "Tree Adventures" });
    const pdf = await storyStickerPdf(labels);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBe(2);
    await expect(storyStickerCodes(null, ["NOPE-01-1"])).rejects.toThrow(STORY_DESK_ERRORS_BN.noCopies);
  });
});
