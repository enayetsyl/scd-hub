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
import { checkInvariant, dayBefore, moveStudent, openEnrolmentForNewStudent } from "../modules/foundation/services/EnrolmentService";
import { dhakaDayKey } from "../lib/dhakaDay";
import { clearYearChangeFixtures, seedClasses, seedYears, type ClassFixture, type YearFixture } from "./fixtures/yearChange";

jest.setTimeout(120_000);

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
    const res = await mergeSections(c.c3Y2026.toString(), null, ACTOR.toString());
    expect(res.movedStudents).toBe(before);
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
