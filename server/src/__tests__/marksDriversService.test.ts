/**
 * "What moves the marks" — the data-gathering half (D-#906), on an in-memory MongoDB.
 * The statistics are pinned in marksDrivers.test.ts; this pins WHAT reaches them:
 *
 *   - attendance is read through each child's OWN unit: a Class 1–5 child counts the
 *     Quran group's days, never a stray section row after the cutover; KG counts its section
 *   - every source is cut to the window (attendance dateKey, test examDate, item dates)
 *   - only PRINTED tests count; CANCELLED and out-of-window tests do not
 *   - inactive students are not in the report at all
 *   - the ten-minute cache, and `refresh` bypassing it
 *
 * Fixtures are raw inserts, so every uniquely-indexed field is set and indexes are built
 * before the first insert (memory-server index timing otherwise decides pass/fail).
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Student } from "../modules/foundation/models/Student";
import { Class } from "../modules/foundation/models/Class";
import { SubjectGroupMembership } from "../modules/routine/models/SubjectGroupMembership";
import { StudentAttendanceDay } from "../modules/attendance/models/StudentAttendanceDay";
import { ClassTest } from "../modules/trackers/models/ClassTest";
import { ClassTestResult } from "../modules/trackers/models/ClassTestResult";
import { HomeworkItem } from "../modules/trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../modules/trackers/models/HomeworkStudentRecord";
import { marksDriversReport, clearMarksDriversCache } from "../modules/reports/services/MarksDriversService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const NOW = new Date("2026-11-02T06:00:00.000Z"); // d30 window = 2026-10-04 … 2026-11-02
const oid = () => new Types.ObjectId();

const year = oid();
const c3 = oid();
const kg = oid();
const s3 = oid();
const sk = oid();
const quran = oid();
const [a, b, c, d, gone, k1] = [oid(), oid(), oid(), oid(), oid(), oid()];

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;
const utc = (key: string) => new Date(`${key}T00:00:00.000Z`);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));

  await Class.collection.insertMany([
    { _id: c3, level: 3, academicYearId: year, nameBn: "শ্রেণি ৩" },
    { _id: kg, level: 0, academicYearId: year, nameBn: "কেজি" },
  ]);
  const stu = (id: Types.ObjectId, classId: Types.ObjectId, sectionId: Types.ObjectId, schoolId: string, active = true) =>
    ({ _id: id, classId, sectionId, schoolId, name: schoolId, active });
  await Student.collection.insertMany([
    stu(a, c3, s3, "1"), stu(b, c3, s3, "2"), stu(c, c3, s3, "3"), stu(d, c3, s3, "4"),
    stu(gone, c3, s3, "5", false),
    stu(k1, kg, sk, "6"),
  ]);
  await SubjectGroupMembership.collection.insertMany(
    [a, b, c, d, gone].map((studentId) => ({ _id: oid(), groupId: quran, studentId, track: "quran" })),
  );

  // Twelve Quran-group days in the window (a absent twice, `gone` absent every day) …
  const groupDays = Array.from({ length: 12 }, (_, i) => ({
    _id: oid(),
    subjectGroupId: quran,
    dateKey: day(10 + i),
    absentStudentIds: [gone, ...(i < 2 ? [a] : [])],
  }));
  await StudentAttendanceDay.collection.insertMany([
    ...groupDays,
    // … one OUT of the window (must not count) …
    { _id: oid(), subjectGroupId: quran, dateKey: "2026-09-01", absentStudentIds: [a] },
    // … a stray post-cutover SECTION row for Class 3 (not their unit — must not count) …
    { _id: oid(), sectionId: s3, dateKey: day(25), absentStudentIds: [a, b] },
    // … and KG's twelve section days (KG's unit IS the section).
    ...Array.from({ length: 12 }, (_, i) => ({ _id: oid(), sectionId: sk, dateKey: day(10 + i), absentStudentIds: [] })),
  ]);

  const test = (status: string, examKey: string, n: number) => ({
    _id: oid(), ctId: `CT-${n}`, status, examDate: utc(examKey), totalMarks: 20, passMark: 8,
    classLevel: 3, classId: c3, sectionId: s3, subject: "MATH", testNumber: n, academicYearId: year,
  });
  const [t1, t2, t3, tOld, tCancelled] = [
    test("PRINTED", day(12), 1), test("PRINTED", day(15), 2), test("PRINTED", day(18), 3),
    test("PRINTED", "2026-09-01", 4), test("CANCELLED", day(20), 5),
  ];
  await ClassTest.collection.insertMany([t1, t2, t3, tOld, tCancelled]);
  const res = (testId: Types.ObjectId, studentId: Types.ObjectId, marks: number | null) =>
    ({ _id: oid(), testId, studentId, status: marks == null ? "ABSENT" : "PRESENT", ...(marks == null ? {} : { marks }) });
  await ClassTestResult.collection.insertMany([
    // a: 10, 15, 20 of 20 → 75%; the old and the cancelled test's zeros must not drag it.
    res(t1._id, a, 10), res(t2._id, a, 15), res(t3._id, a, 20), res(tOld._id, a, 0), res(tCancelled._id, a, 0),
    // b: absent once → only two scored papers → no result
    res(t1._id, b, null), res(t2._id, b, 12), res(t3._id, b, 14),
    // gone: inactive — must vanish entirely
    res(t1._id, gone, 0), res(t2._id, gone, 0), res(t3._id, gone, 0),
  ]);

  const hw = (dateKey: string, n: number) => ({
    _id: oid(), hwId: `HW-${n}`, classId: c3, sectionId: s3, subject: "MATH", classLevel: 3,
    dateGiven: utc(dateKey), status: "issued", academicYearId: year,
  });
  const [hIn, hOld] = [hw(day(11), 1), hw("2026-09-02", 2)];
  await HomeworkItem.collection.insertMany([hIn, hOld]);
  const rec = (hwItemId: Types.ObjectId, studentId: Types.ObjectId, state: string) =>
    ({ _id: oid(), hwItemId, studentId, state, chaseCount: 0 });
  await HomeworkStudentRecord.collection.insertMany([
    // a: 4 submitted + 1 chased in the window → 80%; three old CHASE rows must not count.
    rec(hIn._id, a, "SUBMITTED"), rec(hIn._id, a, "CHECKED"), rec(hIn._id, a, "RETURNED"), rec(hIn._id, a, "RESUBMIT"),
    rec(hIn._id, a, "CHASE"),
    rec(hOld._id, a, "CHASE"), rec(hOld._id, a, "CHASE"), rec(hOld._id, a, "CHASE"),
    rec(hIn._id, gone, "CHASE"),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(() => clearMarksDriversCache());

describe("marksDriversReport — what reaches the statistics", () => {
  it("counts only active students", async () => {
    const r = await marksDriversReport("d30", { now: NOW });
    expect(r.students).toBe(5);
    expect(r.fromKey).toBe("2026-10-04");
    expect(r.toKey).toBe("2026-11-02");
  });

  it("reads each child's own attendance unit, inside the window only", async () => {
    const r = await marksDriversReport("d30", { now: NOW });
    // 12 Quran days for the four C3 children, 12 section days for KG — not 13 (the stray
    // section row, the out-of-window day) for anyone.
    expect(r.medianMarkedDays).toBe(12);
    expect(r.absenceDays).toBe(2); // a's two; the inactive child's twelve are not here
  });

  it("only printed, in-window tests; a result needs three scored papers", async () => {
    const r = await marksDriversReport("d30", { now: NOW });
    expect(r.testsPrinted).toBe(3);
    expect(r.papersMarked).toBe(5); // a 3 + b 2
    expect(r.withResult).toBe(1);
    expect(r.points).toEqual([{ level: 3, att: 10 / 12, hwDone: 0.8, result: 75 }]);
  });

  it("homework is cut on the item's date given", async () => {
    const r = await marksDriversReport("d30", { now: NOW });
    expect(r.homeworkRecords).toBe(5);
  });

  it("serves the cache inside ten minutes; refresh recomputes", async () => {
    const first = await marksDriversReport("d30", { now: NOW });
    const later = new Date(NOW.getTime() + 5 * 60 * 1000);
    expect((await marksDriversReport("d30", { now: later })).computedAt).toBe(first.computedAt);
    expect((await marksDriversReport("d30", { now: later, refresh: true })).computedAt).toBe(later.toISOString());
  });
});
