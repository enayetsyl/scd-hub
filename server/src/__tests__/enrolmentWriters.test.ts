/**
 * YC-1 step 2 - the writers keep the enrolment invariant: createStudent, section merge / split,
 * and moveStudent (audited). Real services on in-memory MongoDB. Prod has NO enrolment rows until
 * the backfill runs, so every writer is also run on a database with none.
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Enrolment } from "../modules/foundation/models/Enrolment";
import { Student } from "../modules/foundation/models/Student";
import { Section } from "../modules/foundation/models/Section";
import { Audit } from "../modules/platform/models/Audit";
import { backfillEnrolments } from "../modules/foundation/services/EnrolmentBackfillService";
import { mergeSections, splitSections } from "../modules/foundation/services/SectionMergeService";
import {
  assertSectionInClass,
  checkInvariant,
  dayBefore,
  moveStudent,
  openEnrolment,
  openEnrolmentForNewStudent,
  recordSectionMove,
  sectionRoster,
} from "../modules/foundation/services/EnrolmentService";
import { SectionMerge } from "../modules/foundation/models/SectionMerge";
import { rehomeStudentRecords } from "../modules/trackers/services/recordRehome";
import * as fs from "fs";
import * as path from "path";
import { dhakaDayKey } from "../lib/dhakaDay";
import { clearYearChangeFixtures, seedClasses, seedYears, type ClassFixture, type YearFixture } from "./fixtures/yearChange";

jest.setTimeout(120_000);

jest.mock("../modules/trackers/services/recordRehome", () => {
  const actual = jest.requireActual("../modules/trackers/services/recordRehome");
  return { ...actual, rehomeStudentRecords: jest.fn(actual.rehomeStudentRecords) };
});

let mongod: MongoMemoryServer;
beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Enrolment.init();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const ACTOR = new mongoose.Types.ObjectId();
const TODAY = dhakaDayKey(new Date());

let y: YearFixture;
let c: ClassFixture;
let boys: mongoose.Types.ObjectId;
let girls: mongoose.Types.ObjectId;
let b1: mongoose.Types.ObjectId;
let b2: mongoose.Types.ObjectId;
let g1: mongoose.Types.ObjectId;

beforeEach(async () => {
  await Promise.all([clearYearChangeFixtures(), Audit.deleteMany({})]);
  y = await seedYears();
  c = await seedClasses(y);
  boys = (await Section.create({ classId: c.c3Y2026, code: "Boys", nameBn: "B", active: true }))._id;
  girls = (await Section.create({ classId: c.c3Y2026, code: "Girls", nameBn: "G", active: true }))._id;
  const kid = async (n: number, sectionId: mongoose.Types.ObjectId, gender: "male" | "female") =>
    (await Student.create({ schoolId: `T-W${n}`, name: `Writer Child ${n}`, classId: c.c3Y2026, sectionId, gender, active: true }))._id;
  b1 = await kid(1, boys, "male");
  b2 = await kid(2, boys, "male");
  g1 = await kid(3, girls, "female");
});

describe("createStudent (openEnrolmentForNewStudent)", () => {
  it("opens an ACTIVE enrolment in the class's year from today; invariant holds", async () => {
    await backfillEnrolments({ apply: true });
    const s = await Student.create({ schoolId: "T-NEW", name: "New Child", classId: c.c3Y2026, sectionId: boys, active: true });
    const e = await openEnrolmentForNewStudent(s, ACTOR);
    expect(e.status).toBe("ACTIVE");
    expect(e.startKey).toBe(TODAY);
    expect(e.academicYearId.toString()).toBe(y.y2026.toString());
    expect(e.sectionId.toString()).toBe(boys.toString());
    expect(await checkInvariant()).toEqual([]);
  });

  it("is idempotent", async () => {
    const s = await Student.create({ schoolId: "T-NEW", name: "New Child", classId: c.c3Y2026, sectionId: boys, active: true });
    await openEnrolmentForNewStudent(s);
    await openEnrolmentForNewStudent(s);
    expect(await Enrolment.countDocuments({ studentId: s._id })).toBe(1);
  });
});

describe("merge and split", () => {
  it("with NO enrolments yet: creates the missing rows, invariant holds after merge and after split", async () => {
    expect(await Enrolment.countDocuments({})).toBe(0);
    await mergeSections(c.c3Y2026.toString(), null, ACTOR.toString());
    const combined = (await Section.findOne({ classId: c.c3Y2026, code: "ALL" }))!._id;
    expect(await checkInvariant()).toEqual([]);
    const rows = await Enrolment.find({ studentId: b1 }).sort({ startKey: 1 });
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe("CLOSED");
    expect(rows[0].outcome).toBe("MOVED");
    expect(rows[0].sectionId.toString()).toBe(boys.toString());
    expect(rows[0].endKey).toBe(dayBefore(TODAY));
    expect(rows[1].status).toBe("ACTIVE");
    expect(rows[1].sectionId.toString()).toBe(combined.toString());

    await splitSections(c.c3Y2026.toString(), ACTOR.toString());
    expect(await checkInvariant()).toEqual([]);
    for (const [id, sec] of [[b1, boys], [b2, boys], [g1, girls]] as const) {
      const act = await Enrolment.find({ studentId: id, status: "ACTIVE" });
      expect(act).toHaveLength(1);
      expect(act[0].sectionId.toString()).toBe(sec.toString());
      expect((await Student.findById(id))!.sectionId.toString()).toBe(sec.toString());
    }
  });

  it("after the backfill: merge closes the old row MOVED the day before and opens the combined one", async () => {
    await backfillEnrolments({ apply: true });
    await mergeSections(c.c3Y2026.toString(), null, ACTOR.toString());
    expect(await checkInvariant()).toEqual([]);
    const rows = await Enrolment.find({ studentId: g1 }).sort({ startKey: 1 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: "CLOSED", outcome: "MOVED", endKey: dayBefore(TODAY) });
    expect(rows[1]).toMatchObject({ status: "ACTIVE", startKey: TODAY });
    await splitSections(c.c3Y2026.toString(), ACTOR.toString());
    expect(await checkInvariant()).toEqual([]);
  });

  it("does not change which records move: rehome still receives exactly the moved students", async () => {
    const before = await Student.countDocuments({ sectionId: { $in: [boys, girls] }, active: true });
    (rehomeStudentRecords as jest.Mock).mockClear();
    const res = await mergeSections(c.c3Y2026.toString(), null, ACTOR.toString());
    expect(res.movedStudents).toBe(before);
    const combined = (await Section.findOne({ classId: c.c3Y2026, code: "ALL" }))!._id;
    const calls = (rehomeStudentRecords as jest.Mock).mock.calls;
    expect(calls).toHaveLength(1);
    expect((calls[0][0] as mongoose.Types.ObjectId[]).map(String).sort()).toEqual([b1, b2, g1].map(String).sort());
    expect(String(calls[0][1])).toBe(combined.toString());
  });

  it("a thrown enrolment lookup does not abort the merge", async () => {
    const spy = jest.spyOn(Enrolment, "find").mockImplementation(() => {
      throw new Error("lookup boom");
    });
    const err = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const res = await mergeSections(c.c3Y2026.toString(), null, ACTOR.toString());
      expect(res.movedStudents).toBe(3);
      expect(err).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      err.mockRestore();
    }
    const combined = (await Section.findOne({ classId: c.c3Y2026, code: "ALL" }))!._id;
    expect((await Student.findById(b1))!.sectionId.toString()).toBe(combined.toString());
    expect(await SectionMerge.countDocuments({ classId: c.c3Y2026, status: "active" })).toBe(1);
  });
});

describe("moveStudent", () => {
  it("works with no enrolment yet (creates the rows) and writes an ENROLMENT_MOVED audit", async () => {
    const next = await moveStudent(b1, girls, TODAY, ACTOR);
    expect(next.status).toBe("ACTIVE");
    expect((await Student.findById(b1))!.sectionId.toString()).toBe(girls.toString());
    const rows = await Enrolment.find({ studentId: b1 }).sort({ startKey: 1 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: "CLOSED", outcome: "MOVED" });
    expect(rows[0].sectionId.toString()).toBe(boys.toString());
    const audit = await Audit.findOne({ eventKind: "ENROLMENT_MOVED", targetId: b1 });
    expect(audit).toBeTruthy();
    expect(audit!.actorId!.toString()).toBe(ACTOR.toString());
    expect(audit!.meta).toMatchObject({ fromSectionId: boys.toString(), toSectionId: girls.toString(), onKey: TODAY });
    // the other children have no rows yet; the moved child's own pair is consistent
    expect((await checkInvariant()).filter((v) => v.studentId === b1.toString())).toEqual([]);
  });
});

describe("recordSectionMove", () => {
  it("never throws: a missing section or a bad date comes back in failed", async () => {
    const ghost = new mongoose.Types.ObjectId();
    const a = await recordSectionMove({ studentIds: [b1], toSectionId: ghost });
    expect(a.moved).toBe(0);
    expect(a.failed.length).toBeGreaterThan(0);
    const b = await recordSectionMove({ studentIds: [b1], toSectionId: girls, onKey: "2026-02-30" });
    expect(b.failed[0]).toContain("Bad date key");
  });

  it("a row starting AFTER the move date is an error for that child (failed), not a re-point", async () => {
    await openEnrolment({ studentId: b1, sectionId: boys, startKey: "2026-10-01" });
    const r = await recordSectionMove({ studentIds: [b1], toSectionId: girls, onKey: "2026-09-01" });
    expect(r.moved).toBe(0);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toContain(b1.toString());
    expect((await Enrolment.find({ studentId: b1 }))[0].sectionId.toString()).toBe(boys.toString());
  });

  it("a row starting ON the move date is re-pointed (same-day correction)", async () => {
    await openEnrolment({ studentId: b1, sectionId: boys, startKey: "2026-10-01" });
    const r = await recordSectionMove({ studentIds: [b1], toSectionId: girls, onKey: "2026-10-01" });
    expect(r.failed).toEqual([]);
    const rows = await Enrolment.find({ studentId: b1 });
    expect(rows).toHaveLength(1);
    expect(rows[0].sectionId.toString()).toBe(girls.toString());
  });

  it("split-skill path: explicit future onKey after a backfill closes the day before and opens on that date", async () => {
    await backfillEnrolments({ apply: true });
    const half = (await Section.create({ classId: c.c3Y2026, code: "Half", nameBn: "H", active: true }))._id;
    await Student.updateMany({ _id: { $in: [b1, b2] } }, { $set: { sectionId: half } }); // the skill moves the pointer itself
    const r = await recordSectionMove({ studentIds: [b1, b2], toSectionId: half, onKey: "2026-12-20", from: new Map([[b1.toString(), boys]]) });
    expect(r).toEqual({ moved: 2, failed: [] });
    expect((await sectionRoster(boys, { on: "2026-12-19" })).map((e) => e.studentId.toString()).sort()).toEqual([b1, b2].map(String).sort());
    expect(await sectionRoster(boys, { on: "2026-12-20" })).toHaveLength(0);
    expect(await sectionRoster(half, { on: "2026-12-20" })).toHaveLength(2);
    expect(await sectionRoster(half, { on: "2026-12-19" })).toHaveLength(0);
    expect(await checkInvariant()).toEqual([]);
  });
});

describe("moveStudent edge cases", () => {
  it("a retry finishes a half-done move (new row written, pointer and old row not)", async () => {
    await backfillEnrolments({ apply: true });
    await openEnrolment({ studentId: b1, sectionId: girls, startKey: "2026-09-10" }); // crash right after step 1
    expect((await checkInvariant()).map((v) => v.kind).sort()).toEqual(["MULTIPLE_ACTIVE"]);
    const e = await moveStudent(b1, girls, "2026-09-10", ACTOR);
    expect(e.sectionId.toString()).toBe(girls.toString());
    expect((await Student.findById(b1))!.sectionId.toString()).toBe(girls.toString());
    const rows = await Enrolment.find({ studentId: b1 }).sort({ startKey: 1 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: "CLOSED", outcome: "MOVED", endKey: "2026-09-09" });
    expect(rows[1].status).toBe("ACTIVE");
    expect(await checkInvariant()).toEqual([]);
    await expect(moveStudent(b1, girls, "2026-09-10", ACTOR)).rejects.toThrow("already in that section");
  });

  it("a retry after the old row closed but the pointer is stale sets the pointer", async () => {
    await backfillEnrolments({ apply: true });
    await moveStudent(b1, girls, "2026-09-10", ACTOR);
    await Student.updateOne({ _id: b1 }, { $set: { sectionId: boys } });
    await moveStudent(b1, girls, "2026-09-10", ACTOR);
    expect((await Student.findById(b1))!.sectionId.toString()).toBe(girls.toString());
    expect(await checkInvariant()).toEqual([]);
  });

  it("refuses a date outside the target year and an inactive target section", async () => {
    await expect(moveStudent(b1, girls, "2025-12-31", ACTOR)).rejects.toThrow("outside the target year");
    await expect(moveStudent(b1, girls, "2027-01-01", ACTOR)).rejects.toThrow("outside the target year");
    await Section.updateOne({ _id: girls }, { $set: { active: false } });
    await expect(moveStudent(b1, girls, "2026-09-10", ACTOR)).rejects.toThrow("not active");
    expect(await Enrolment.countDocuments({})).toBe(0);
  });

  it("rejects impossible dates with a clear error", async () => {
    await expect(moveStudent(b1, girls, "2026-02-30", ACTOR)).rejects.toThrow("Bad date key");
    await expect(moveStudent(b1, girls, "2026-13-01", ACTOR)).rejects.toThrow("Bad date key");
    await expect(sectionRoster(girls, { on: "2026-02-30" })).rejects.toThrow("Bad date key");
    expect(() => dayBefore("2026-00-10")).toThrow("Bad date key");
  });
});

describe("createStudent section guard", () => {
  it("refuses a missing section or one of another class (Bangla message); accepts a match", async () => {
    await expect(assertSectionInClass(c.c3Y2026, new mongoose.Types.ObjectId())).rejects.toThrow("শাখা পাওয়া যায়নি");
    const other = (await Section.create({ classId: c.c4Y2026, code: "Main", nameBn: "M", active: true }))._id;
    await expect(assertSectionInClass(c.c3Y2026, other)).rejects.toThrow("নির্বাচিত শাখাটি এই শ্রেণির নয়");
    await expect(assertSectionInClass(c.c3Y2026, boys)).resolves.toBeUndefined();
  });

  it("the resolver calls the guard before Student.create", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../modules/foundation/resolvers/students.ts"), "utf-8");
    const at = src.indexOf("await assertSectionInClass(args.classId, args.sectionId)");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(src.indexOf("Student.create({", at));
  });
});
