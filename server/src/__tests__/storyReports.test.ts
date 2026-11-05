/**
 * SB-6 — storybook reports (D-#980, docs/prd-storybook-reading.md, W10).
 *
 *   series   lent / read (desk tick only) / readers / waiting / copies, inside the window only
 *   books    second-copy suggestion (≤ 1 copy, ≥ 3 waiting); never-borrowed; sorted by reads
 *   readers  per child read count + favourite tag; "stopped" after 21 quiet days; preference
 *            cells by class and by section
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
import { StoryTag } from "../modules/library/models/StoryTag";
import { storyBooksReport, storyReadersReport, storySeriesReport, windowStart } from "../modules/library/services/StoryReportService";

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

const NOW = new Date("2026-11-20T10:00:00+06:00");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

let seq = 0;
async function kid(nameBn: string, level: number, sectionBn: string) {
  seq += 1;
  const cls = await Class.collection.insertOne({ level, nameBn: `L${level}`, academicYearId: new Types.ObjectId(), active: true });
  const sec = await Section.collection.insertOne({ classId: cls.insertedId, code: `S${seq}`, nameBn: sectionBn });
  return (await Student.collection.insertOne({ schoolId: `9${seq}`, name: nameBn, nameBn, classId: cls.insertedId, sectionId: sec.insertedId, active: true })).insertedId;
}
async function loan(titleId: Types.ObjectId, studentId: Types.ObjectId, issuedDaysAgo: number, returnedDaysAgo: number | null, read: boolean | null) {
  await BookLoan.collection.insertOne({
    copyId: new Types.ObjectId(),
    titleId,
    borrowerType: "STUDENT",
    studentId,
    issuedAt: ago(issuedDaysAgo),
    dueDate: ago(issuedDaysAgo - 7),
    renewCount: 0,
    status: returnedDaysAgo === null ? "ACTIVE" : "RETURNED",
    ...(returnedDaysAgo === null ? {} : { returnedAt: ago(returnedDaysAgo), readAtReturn: read ?? undefined }),
    issuedBy: new Types.ObjectId(),
  });
}

it("reports by series, by book and by reader", async () => {
  const nature = await StoryTag.create({ nameBn: "প্রকৃতি" });
  const manners = await StoryTag.create({ nameBn: "আদব" });
  const tre = await StorySeries.create({ code: "TRE", nameBn: "গাছের গল্প", ageBandCode: "3-6", status: "PUBLISHED" });
  const lmb = await StorySeries.create({ code: "LMB", nameBn: "ছোট্ট মুসলিম", ageBandCode: "3-6", status: "PUBLISHED" });
  const t1 = await BookTitle.create({ titleBn: "আম-চোর", language: "BANGLA", active: true, seriesId: tre._id, seriesNo: 1, tagIds: [nature._id] });
  const t2 = await BookTitle.create({ titleBn: "কাঁঠাল", language: "BANGLA", active: true, seriesId: tre._id, seriesNo: 2, tagIds: [nature._id] });
  const t3 = await BookTitle.create({ titleBn: "সালাম", language: "BANGLA", active: true, seriesId: lmb._id, seriesNo: 1, tagIds: [manners._id] });
  await BookCopy.create({ titleId: t1._id, accessionNo: "TRE-01-1", status: "ON_LOAN" });
  for (const k of [1, 2]) await BookCopy.create({ titleId: t2._id, accessionNo: `TRE-02-${k}`, status: "AVAILABLE" });
  await BookCopy.create({ titleId: t3._id, accessionNo: "LMB-01-1", status: "AVAILABLE" });

  const boy = await kid("হামযা", 0, "কেজি বালক");
  const girl = await kid("আয়েশা", 0, "কেজি বালিকা");
  const quiet = await kid("মারইয়াম", 1, "১ম");
  await loan(t1._id, boy, 10, 5, true);
  await loan(t1._id, girl, 4, 2, true);
  await loan(t1._id, boy, 1, null, null); // out now
  await loan(t3._id, girl, 8, 6, true);
  await loan(t3._id, girl, 20, 19, false); // returned, not read
  await loan(t1._id, quiet, 60, 40, true); // only inside d90 / year; stopped since
  for (let i = 0; i < 3; i++) await BookReservation.collection.insertOne({ titleId: t1._id, borrowerType: "STUDENT", studentId: new Types.ObjectId(), status: "QUEUED", createdAt: ago(1) });

  expect(windowStart("year", NOW).toISOString()).toBe(new Date("2026-01-01T00:00:00+06:00").toISOString());

  const s30 = await storySeriesReport("d30", NOW);
  const treRow = s30.find((r) => r.nameBn === "গাছের গল্প")!;
  expect(treRow).toMatchObject({ lent: 3, read: 2, readers: 2, waiting: 3, copies: 3 });
  expect(s30.find((r) => r.nameBn === "ছোট্ট মুসলিম")).toMatchObject({ lent: 2, read: 1, returned: 2 });
  expect((await storySeriesReport("d90", NOW)).find((r) => r.nameBn === "গাছের গল্প")!.read).toBe(3);

  const books = await storyBooksReport("d30", tre._id.toString(), NOW);
  expect(books.map((b) => [b.nameBn, b.read, b.secondCopy, b.neverBorrowed])).toEqual([
    ["আম-চোর", 2, true, false],
    ["কাঁঠাল", 0, false, true],
  ]);

  const r = await storyReadersReport("d30", NOW);
  const byName = new Map(r.readers.map((x) => [x.name, x]));
  expect(byName.get("আয়েশা")).toMatchObject({ read: 2, sectionNameBn: "কেজি বালিকা", stopped: false });
  expect(byName.get("হামযা")).toMatchObject({ read: 1, favouriteTagBn: "প্রকৃতি" });
  expect(byName.get("মারইয়াম")).toMatchObject({ read: 0, stopped: true });
  expect(r.readers[0].name).toBe("মারইয়াম"); // stopped readers first
  expect(r.bySection).toEqual(
    expect.arrayContaining([
      { seriesNameBn: "গাছের গল্প", groupLabelBn: "কেজি বালক", read: 1 },
      { seriesNameBn: "গাছের গল্প", groupLabelBn: "কেজি বালিকা", read: 1 },
      { seriesNameBn: "ছোট্ট মুসলিম", groupLabelBn: "কেজি বালিকা", read: 1 },
    ]),
  );
  expect(r.byClass.find((c) => c.seriesNameBn === "গাছের গল্প")).toMatchObject({ groupLabelBn: "কেজি", read: 2 });
});
