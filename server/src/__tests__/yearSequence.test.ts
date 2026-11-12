/**
 * YC-0 step 2 (D-#1450): a new academic year's id counters CONTINUE the previous
 * year's numbers, atomically, and a duplicate id is a plain Bangla error.
 * In-memory MongoDB, real sequence models + the real generate* functions.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { HomeworkSequence } from "../modules/trackers/models/HomeworkSequence";
import { AssignmentSequence } from "../modules/trackers/models/AssignmentSequence";
import { ClassTestSequence } from "../modules/trackers/models/ClassTestSequence";
import { ClassTestGroupSequence } from "../modules/trackers/models/ClassTestGroupSequence";
import { ScholarshipSequence } from "../modules/scholarship/models/ScholarshipSequence";
import { generateHwId } from "../modules/trackers/services/HomeworkService";
import { generateAsId } from "../modules/trackers/services/AssignmentService";
import { generateCtId, generateGroupCtId } from "../modules/trackers/services/ClassTestService";
import { generatePaperId } from "../modules/scholarship/services/ScholarshipService";
import { nextYearSeq, translateDuplicateId, createWithYearId, DUPLICATE_ID_BN } from "../lib/yearSequence";

let mongo: MongoMemoryServer;
let y26: Types.ObjectId;
let y27: Types.ObjectId;
const groupId = new Types.ObjectId();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(
    [AcademicYear, HomeworkSequence, AssignmentSequence, ClassTestSequence, ClassTestGroupSequence, ScholarshipSequence].map((m) => m.init()),
  );
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all(
    [AcademicYear, HomeworkSequence, AssignmentSequence, ClassTestSequence, ClassTestGroupSequence, ScholarshipSequence].map(
      (m) => (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
  y26 = (await AcademicYear.create({ label: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), current: true }))._id;
  y27 = (await AcademicYear.create({ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31"), current: false }))._id;
});

test("2026 at -0005: a 2027 create gets -0006 for HW / AS / CT / CT-G / SP", async () => {
  await HomeworkSequence.create({ academicYearId: y26, classLevel: 3, subject: "BAN", seq: 5 });
  await AssignmentSequence.create({ academicYearId: y26, classLevel: 3, subject: "BAN", seq: 5 });
  await ClassTestSequence.create({ academicYearId: y26, classLevel: 3, subject: "BAN", seq: 5 });
  await ClassTestGroupSequence.create({ academicYearId: y26, subjectGroupId: groupId, seq: 5 });
  await ScholarshipSequence.create({ academicYearId: y26, classLevel: 5, subjectKey: "ENG", seq: 5 });

  expect(await generateHwId(String(y27), 3, "BAN")).toBe("HW-C3-BAN-0006");
  expect(await generateAsId(String(y27), 3, "BAN")).toBe("AS-C3-BAN-0006");
  expect(await generateCtId(String(y27), 3, "BAN")).toBe("CT-C3-BAN-0006");
  expect(await generateGroupCtId(String(y27), String(groupId), "ARABIC_BOOK_2")).toBe("CT-G-ARABIC_BOOK_2-0006");
  expect(await generatePaperId(y27, 5, ["ENG"])).toBe("SP-C5-ENG-0006");
  // the 2026 row is untouched
  expect((await HomeworkSequence.findOne({ academicYearId: y26 }))!.seq).toBe(5);
});

test("a key with no earlier-year row starts at 1; other keys do not leak", async () => {
  await HomeworkSequence.create({ academicYearId: y26, classLevel: 3, subject: "BAN", seq: 9 });
  expect(await generateHwId(String(y27), 3, "ENG")).toBe("HW-C3-ENG-0001");
  expect(await generateHwId(String(y27), 2, "BAN")).toBe("HW-C2-BAN-0001");
});

test("the first-ever year still starts at 1", async () => {
  expect(await generateHwId(String(y26), 3, "BAN")).toBe("HW-C3-BAN-0001");
});

test("concurrent first-creates of a new year never hand out the same number", async () => {
  await HomeworkSequence.create({ academicYearId: y26, classLevel: 3, subject: "BAN", seq: 5 });
  const got = await Promise.all(
    Array.from({ length: 12 }, () => nextYearSeq(HomeworkSequence, y27, { classLevel: 3, subject: "BAN" })),
  );
  expect(new Set(got).size).toBe(12);
  expect([...got].sort((a, b) => a - b)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  expect(await HomeworkSequence.countDocuments({ academicYearId: y27 })).toBe(1);
});

const ItemModel = mongoose.model(
  "YearSeqItem",
  new mongoose.Schema({ hwId: { type: String, unique: true, required: true }, y: String }),
);
const key = { classLevel: 3, subject: "BAN" };
const mkHw = (year: Types.ObjectId) => generateHwId(String(year), 3, "BAN");
const insertHw = async (year: Types.ObjectId): Promise<string> =>
  createWithYearId({
    idField: "hwId",
    seqModel: HomeworkSequence,
    academicYearId: year,
    key,
    firstId: await mkHw(year),
    makeId: () => mkHw(year),
    create: async (id) => (await ItemModel.create({ hwId: id, y: String(year) })).hwId,
  });

test("after 2027 handed out M+1, a late 2026 create gets a fresh unused number (and vice versa)", async () => {
  await ItemModel.init();
  await ItemModel.deleteMany({});
  await HomeworkSequence.create({ academicYearId: y26, classLevel: 3, subject: "BAN", seq: 5 });
  // 2027 continues at 6 and files an item with it
  expect(await insertHw(y27)).toBe("HW-C3-BAN-0006");
  // 2026's own counter is still at 5: its next number (6) is taken -> catch-up, no error
  expect(await insertHw(y26)).toBe("HW-C3-BAN-0007");
  // and vice versa: 2027's counter is at 6, the next (7) is taken -> catch-up to 8
  expect(await insertHw(y27)).toBe("HW-C3-BAN-0008");
  expect(await ItemModel.countDocuments()).toBe(3);
});

test("a persistent duplicate gives up after 3 attempts with the Bangla message", async () => {
  let calls = 0;
  const dup = Object.assign(new Error("E11000"), { code: 11000, keyPattern: { hwId: 1 } });
  await expect(
    createWithYearId({
      idField: "hwId",
      seqModel: HomeworkSequence,
      academicYearId: y26,
      key,
      firstId: "HW-C3-BAN-0001",
      makeId: () => mkHw(y26),
      create: async () => {
        calls += 1;
        throw dup;
      },
    }),
  ).rejects.toThrow(DUPLICATE_ID_BN);
  expect(calls).toBe(3);
});

test("a duplicate id insert becomes the shared Bangla message", async () => {
  const dup = Object.assign(new Error("E11000 dup key"), { code: 11000, keyPattern: { hwId: 1 } });
  expect(() => translateDuplicateId("hwId")(dup)).toThrow(DUPLICATE_ID_BN);
  expect(DUPLICATE_ID_BN).not.toMatch(/E11000/);
  const other = Object.assign(new Error("boom"), { code: 11000, keyPattern: { sectionId: 1 } });
  expect(() => translateDuplicateId("hwId")(other)).toThrow("boom");
});
