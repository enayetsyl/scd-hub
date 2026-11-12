/**
 * YC-1 step 1 - Enrolment model, EnrolmentService, invariant check and the backfill.
 * In-memory MongoDB, real services, YC-0 fixtures.
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Enrolment } from "../modules/foundation/models/Enrolment";
import { Student } from "../modules/foundation/models/Student";
import { backfillEnrolments } from "../modules/foundation/services/EnrolmentBackfillService";
import {
  checkInvariant,
  enrolmentOf,
  moveStudent,
  openEnrolment,
  sectionRoster,
  EnrolmentError,
} from "../modules/foundation/services/EnrolmentService";
import {
  clearYearChangeFixtures,
  seedClasses,
  seedSections,
  seedProdSplit,
  seedSplitHistory,
  seedYears,
  type ClassFixture,
  type SectionFixture,
  type SplitHistoryFixture,
  type YearFixture,
} from "./fixtures/yearChange";

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

let y: YearFixture;
let c: ClassFixture;
let s: SectionFixture;
let h: SplitHistoryFixture;
let inactiveId: string;

beforeEach(async () => {
  await clearYearChangeFixtures();
  y = await seedYears();
  c = await seedClasses(y);
  s = await seedSections(c);
  h = await seedSplitHistory(c);
  // One active child in class 4 (no split history) and one inactive child.
  await Student.create({ schoolId: "T-S5", name: "Plain Child", classId: c.c4Y2026, sectionId: s.s4Y2026, active: true });
  inactiveId = (await Student.create({ schoolId: "T-S6", name: "Gone Child", classId: c.c4Y2026, sectionId: s.s4Y2026, active: false }))._id.toString();
});

describe("backfillEnrolments", () => {
  it("dry run writes nothing", async () => {
    const r = await backfillEnrolments({ apply: false });
    expect(r.students).toBe(5);
    expect(r.rowsPlanned).toBeGreaterThan(5);
    expect(await Enrolment.countDocuments({})).toBe(0);
  });

  it("apply: every active student gets an ACTIVE enrolment, none for the inactive child, invariant passes", async () => {
    const r = await backfillEnrolments({ apply: true });
    expect(r.students).toBe(5);
    expect(await Enrolment.countDocuments({ status: "ACTIVE" })).toBe(5);
    expect(await Enrolment.countDocuments({ studentId: new mongoose.Types.ObjectId(inactiveId) })).toBe(0);
    expect(await checkInvariant()).toEqual([]);
  });

  it("re-run writes 0 rows", async () => {
    await backfillEnrolments({ apply: true });
    const before = await Enrolment.countDocuments({});
    const r = await backfillEnrolments({ apply: true });
    expect(r.rowsWritten).toBe(0);
    expect(r.rowsPlanned).toBe(0);
    expect(r.alreadyDone).toBe(5);
    expect(await Enrolment.countDocuments({})).toBe(before);
  });

  it("rebuilds the split history: the combined section's roster before the split is the pre-split children", async () => {
    const r = await backfillEnrolments({ apply: true });
    expect(r.rebuiltHistory).toBe(4);
    const before = await sectionRoster(h.combined, { on: "2026-04-15" });
    expect(before.map((e) => e.studentId.toString()).sort()).toEqual(
      [h.boy1, h.boy2, h.girl1, h.girl2].map((i) => i.toString()).sort(),
    );
    expect(await sectionRoster(h.combined, { on: "2026-02-01" })).toHaveLength(0);
    expect(await sectionRoster(h.combined, { on: "2026-06-01" })).toHaveLength(0);
    const boysEarly = await sectionRoster(h.boys, { on: "2026-02-01" });
    expect(boysEarly).toHaveLength(2);
    const boysNow = await sectionRoster(h.boys, { on: "2026-09-01" });
    expect(boysNow).toHaveLength(2);
    const e = await enrolmentOf(h.girl1, { on: "2026-03-01" });
    expect(e?.sectionId.toString()).toBe(h.combined.toString());
    expect(e?.endKey).toBe("2026-05-31");
    expect((await enrolmentOf(h.girl1, { academicYearId: y.y2026 }))?.status).toBe("ACTIVE");
  });

  it("reports a child the merge row does not name instead of guessing", async () => {
    await Student.create({ schoolId: "T-S7", name: "Late Joiner", classId: c.c3Y2026, sectionId: h.boys, active: true });
    const r = await backfillEnrolments({ apply: true });
    expect(r.couldNot.some((l) => l.startsWith("T-S7"))).toBe(true);
    expect(await Enrolment.countDocuments({ studentId: (await Student.findOne({ schoolId: "T-S7" }))!._id })).toBe(1);
  });
});

describe("backfillEnrolments - prod split shape (no SectionMerge, one SECTIONS_SPLIT audit)", () => {
  const ids = (p: { kids: mongoose.Types.ObjectId[] }): string[] => p.kids.map((k) => k.toString()).sort();

  it("rebuilds the combined span from the audit: roster before the split = the moved children, empty on/after", async () => {
    const p = await seedProdSplit(y);
    const r = await backfillEnrolments({ apply: true });
    expect(r.couldNot.filter((l) => l.startsWith("T-P"))).toEqual([]);
    expect((await sectionRoster(p.combined, { on: "2026-09-30" })).map((e) => e.studentId.toString()).sort()).toEqual(ids(p));
    expect(await sectionRoster(p.combined, { on: "2026-10-01" })).toHaveLength(0);
    expect(await sectionRoster(p.combined, { on: "2026-12-01" })).toHaveLength(0);
    expect(await sectionRoster(p.boys, { on: "2026-09-30" })).toHaveLength(0);
    expect(await sectionRoster(p.boys, { on: "2026-10-01" })).toHaveLength(2);
    const e = await enrolmentOf(p.kids[2], { on: "2026-02-01" });
    expect(e).toMatchObject({ outcome: "MOVED", endKey: "2026-09-30", startKey: "2026-01-01" });
    expect((await enrolmentOf(p.kids[2], { academicYearId: y.y2026 }))).toMatchObject({ status: "ACTIVE", startKey: "2026-10-01" });
    expect(await checkInvariant()).toEqual([]);
  });

  it("count mismatch: plain single rows and every affected child listed in couldNot", async () => {
    const p = await seedProdSplit(y, { movedStudents: 4 });
    const r = await backfillEnrolments({ apply: true });
    for (const n of [1, 2, 3]) expect(r.couldNot.some((l) => l.startsWith(`T-P${n}:`))).toBe(true);
    expect(await Enrolment.countDocuments({ studentId: { $in: p.kids } })).toBe(3);
    expect(await sectionRoster(p.combined, { on: "2026-02-01" })).toHaveLength(0);
    expect(await checkInvariant()).toEqual([]);
  });

  it("missing meta.effective: plain single rows and the children listed", async () => {
    const p = await seedProdSplit(y, { effective: null });
    const r = await backfillEnrolments({ apply: true });
    expect(r.couldNot.filter((l) => l.startsWith("T-P") && l.includes("effective"))).toHaveLength(3);
    expect(await Enrolment.countDocuments({ studentId: { $in: p.kids } })).toBe(3);
    expect(await sectionRoster(p.combined, { on: "2026-02-01" })).toHaveLength(0);
  });
});

describe("moveStudent", () => {
  it("closes the current enrolment MOVED the day before and opens the next; the pointer follows", async () => {
    await backfillEnrolments({ apply: true });
    const sec = await seedExtraSection();
    const next = await moveStudent(h.boy1, sec, "2026-09-10");
    expect(next.status).toBe("ACTIVE");
    expect(next.startKey).toBe("2026-09-10");
    const rows = await Enrolment.find({ studentId: h.boy1 }).sort({ startKey: 1 });
    const closed = rows[rows.length - 2];
    expect(closed.status).toBe("CLOSED");
    expect(closed.outcome).toBe("MOVED");
    expect(closed.endKey).toBe("2026-09-09");
    expect(rows.filter((r) => r.status === "ACTIVE")).toHaveLength(1);
    expect((await Student.findById(h.boy1))!.sectionId.toString()).toBe(sec.toString());
    expect(await checkInvariant()).toEqual([]);
  });

  it("refuses a move into another year and a move on or before the start", async () => {
    await backfillEnrolments({ apply: true });
    await expect(moveStudent(h.boy1, s.s3Y2027, "2026-09-10")).rejects.toThrow(EnrolmentError);
    await expect(moveStudent(h.boy1, s.s3Y2026, "2026-06-01")).rejects.toThrow(EnrolmentError);
  });
});

describe("checkInvariant", () => {
  it("flags a missing enrolment, a stale pointer and a doubled ACTIVE row", async () => {
    await backfillEnrolments({ apply: true });
    await Student.updateOne({ _id: h.boy2 }, { $set: { sectionId: h.girls } });
    await Enrolment.deleteOne({ studentId: (await Student.findOne({ schoolId: "T-S5" }))!._id });
    await openEnrolment({ studentId: h.girl2, sectionId: h.boys, startKey: "2026-10-01" });
    const kinds = (await checkInvariant()).map((v) => v.kind).sort();
    expect(kinds).toEqual(["MULTIPLE_ACTIVE", "NO_ACTIVE_ENROLMENT", "POINTER_MISMATCH"]);
  });

  it("is empty when no year is current", async () => {
    await mongoose.model("AcademicYear").updateMany({}, { $set: { current: false } });
    expect(await checkInvariant()).toEqual([]);
  });
});

async function seedExtraSection(): Promise<mongoose.Types.ObjectId> {
  const { Section } = await import("../modules/foundation/models/Section");
  return (await Section.create({ classId: c.c3Y2026, code: "Extra", nameBn: "Extra", active: true }))._id;
}
