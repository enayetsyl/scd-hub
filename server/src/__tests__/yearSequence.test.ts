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
import { nextYearSeq, translateDuplicateId, DUPLICATE_ID_BN } from "../lib/yearSequence";

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

test("a LATER year's row never seeds an earlier year", async () => {
  await HomeworkSequence.create({ academicYearId: y27, classLevel: 3, subject: "BAN", seq: 40 });
  expect(await generateHwId(String(y26), 3, "BAN")).toBe("HW-C3-BAN-0001");
});

test("a duplicate id insert becomes the shared Bangla message", async () => {
  const dup = Object.assign(new Error("E11000 dup key"), { code: 11000, keyPattern: { hwId: 1 } });
  expect(() => translateDuplicateId("hwId")(dup)).toThrow(DUPLICATE_ID_BN);
  expect(DUPLICATE_ID_BN).not.toMatch(/E11000/);
  const other = Object.assign(new Error("boom"), { code: 11000, keyPattern: { sectionId: 1 } });
  expect(() => translateDuplicateId("hwId")(other)).toThrow("boom");
});
