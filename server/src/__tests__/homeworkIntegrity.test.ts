/**
 * GH-3 homework-honesty flag (D-#1522) - in-memory Mongo.
 *  - the rule: gap 20 -> case, 19 -> none; needs both sides; superseded / excluded evidence ignored; year scope
 *  - recompute after a CT paper (recomputeForPaper), and the confirm hook is wired for source CT only
 *  - one OPEN case per child x objective; a recompute updates numbers and keeps history
 *  - a closed case reopens only on NEW evidence
 *  - the Office outcome closes the case and changes no mark; double record refused
 *  - nothing is notified; the service never imports the notification layer
 *  - the teacher hint count shows the max step across a child's guardians
 */
import fs from "fs";
import path from "path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { MasteryEvidence } from "../modules/mastery/models/MasteryEvidence";
import { HintView } from "../modules/guardian-help/models/HintView";
import { Notification } from "../modules/notifications/models/Notification";
import { IntegrityCase } from "../modules/homework-integrity/models/IntegrityCase";
import {
  caseDetail,
  evaluateRows,
  hintStepsFor,
  listCases,
  recomputeForPaper,
  recomputeForStudentsLos,
  recordOutcome,
  sweepYear,
  type EvidenceRowLike,
} from "../modules/homework-integrity/services/IntegrityService";

jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
let year: Types.ObjectId;
let otherYear: Types.ObjectId;
let sectionId: Types.ObjectId;
let classId: Types.ObjectId;
const students: Types.ObjectId[] = [];
const OFFICE = { userId: new Types.ObjectId().toString(), role: "OFFICE" };
let lo = 0;
const nextLo = () => `LO-GH3-${++lo}`;

const row = (source: string, earned: number, available: number, day: string): EvidenceRowLike => ({
  source, paperId: new Types.ObjectId(), qid: undefined, itemNo: 1, earned, available, at: new Date(`${day}T06:00:00Z`),
});

let seq = 0;
async function ev(opts: {
  s: Types.ObjectId; lo: string; source: string; earned: number; available: number; day: string;
  paperId?: Types.ObjectId; academicYearId?: Types.ObjectId; supersededAt?: Date; excludedAt?: Date; qid?: string;
}): Promise<Types.ObjectId> {
  const paperId = opts.paperId ?? new Types.ObjectId();
  await MasteryEvidence.create({
    studentId: opts.s, sectionId, academicYearId: opts.academicYearId ?? year, classToken: "C3", subject: "MATH",
    loCode: opts.lo, source: opts.source, paperId, itemNo: ++seq, qid: opts.qid, earned: opts.earned, available: opts.available,
    at: new Date(`${opts.day}T06:00:00Z`), week: "2027-W01", supersededAt: opts.supersededAt, excludedAt: opts.excludedAt,
  });
  return paperId;
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [y, y0] = await AcademicYear.create([
    { label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31"), current: true },
    { label: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") },
  ]);
  year = y._id;
  otherYear = y0._id;
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year }]);
  classId = cls._id;
  const [sec] = await Section.create([{ classId, code: "M", nameBn: "মূল" }]);
  sectionId = sec._id;
  for (let i = 1; i <= 8; i++) {
    const [st] = await Student.create([{ schoolId: `GH3-${i}`, name: `Child ${i}`, rollNumber: String(i), classId, sectionId, active: true }]);
    students.push(st._id);
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("the rule (pure)", () => {
  it("gap exactly 20 flags; 19 does not", () => {
    const at20 = evaluateRows([row("HW", 80, 100, "2027-02-01"), row("CT", 60, 100, "2027-02-10")]);
    expect(at20?.flagged).toBe(true);
    expect(at20?.gap).toBe(20);
    const at19 = evaluateRows([row("HW", 79, 100, "2027-02-01"), row("CT", 60, 100, "2027-02-10")]);
    expect(at19?.flagged).toBe(false);
  });
  it("HW and AS both count on the homework side", () => {
    const e = evaluateRows([row("HW", 9, 10, "2027-02-01"), row("AS", 9, 10, "2027-02-02"), row("CT", 1, 10, "2027-02-10")]);
    expect(e?.hwPct).toBe(90);
    expect(e?.ctPct).toBe(10);
    expect(e?.flagged).toBe(true);
  });
  it("needs both sides", () => {
    expect(evaluateRows([row("HW", 10, 10, "2027-02-01")])).toBeNull();
    expect(evaluateRows([row("CT", 1, 10, "2027-02-01")])).toBeNull();
    expect(evaluateRows([row("AS", 0, 0, "2027-02-01"), row("CT", 1, 10, "2027-02-02")])).toBeNull();
  });
  it("homework after the class test's date is not counted", () => {
    const e = evaluateRows([row("HW", 5, 10, "2027-02-01"), row("HW", 10, 10, "2027-03-01"), row("CT", 5, 10, "2027-02-10")]);
    expect(e?.hwPct).toBe(50);
    expect(e?.flagged).toBe(false);
  });
});

describe("recompute", () => {
  it("opens one case at gap 20, none at 19", async () => {
    const a = nextLo();
    const b = nextLo();
    await ev({ s: students[0], lo: a, source: "HW", earned: 80, available: 100, day: "2027-02-01" });
    await ev({ s: students[0], lo: a, source: "CT", earned: 60, available: 100, day: "2027-02-10" });
    await ev({ s: students[0], lo: b, source: "HW", earned: 79, available: 100, day: "2027-02-01" });
    await ev({ s: students[0], lo: b, source: "CT", earned: 60, available: 100, day: "2027-02-10" });
    const r = await recomputeForStudentsLos([{ studentId: String(students[0]), loCode: a }, { studentId: String(students[0]), loCode: b }], year);
    expect(r.opened).toBe(1);
    expect(await IntegrityCase.countDocuments({ studentId: students[0], loCode: a, status: "OPEN" })).toBe(1);
    expect(await IntegrityCase.countDocuments({ studentId: students[0], loCode: b })).toBe(0);
  });

  it("ignores superseded and excluded evidence", async () => {
    const l = nextLo();
    await ev({ s: students[1], lo: l, source: "HW", earned: 100, available: 100, day: "2027-02-01", supersededAt: new Date() });
    await ev({ s: students[1], lo: l, source: "HW", earned: 100, available: 100, day: "2027-02-02", excludedAt: new Date() });
    await ev({ s: students[1], lo: l, source: "CT", earned: 0, available: 100, day: "2027-02-10" });
    await recomputeForStudentsLos([{ studentId: String(students[1]), loCode: l }], year);
    expect(await IntegrityCase.countDocuments({ studentId: students[1] })).toBe(0);
  });

  it("is scoped to the academic year", async () => {
    const l = nextLo();
    await ev({ s: students[2], lo: l, source: "HW", earned: 100, available: 100, day: "2026-02-01", academicYearId: otherYear });
    await ev({ s: students[2], lo: l, source: "CT", earned: 0, available: 100, day: "2027-02-10" });
    await recomputeForStudentsLos([{ studentId: String(students[2]), loCode: l }], year);
    expect(await IntegrityCase.countDocuments({ studentId: students[2] })).toBe(0);
  });

  it("recomputes for a confirmed CT paper's children and objectives", async () => {
    const l = nextLo();
    await ev({ s: students[3], lo: l, source: "HW", earned: 10, available: 10, day: "2027-03-01" });
    const ctPaper = await ev({ s: students[3], lo: l, source: "CT", earned: 2, available: 10, day: "2027-03-10" });
    const r = await recomputeForPaper(ctPaper, year);
    expect(r.opened).toBe(1);
    const c = await IntegrityCase.findOne({ studentId: students[3], loCode: l });
    expect(c?.gap).toBe(80);
  });

  it("the confirm hook is wired for class-test papers only", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../modules/mastery/services/MasteryWorkService.ts"), "utf8");
    expect(src).toMatch(/paper\.source === "CT"[\s\S]{0,400}recomputeForPaper/);
    expect(src).not.toMatch(/await[^\n]*recomputeForPaper/);
  });

  it("keeps one OPEN case per child x objective and records history", async () => {
    const l = nextLo();
    await ev({ s: students[4], lo: l, source: "HW", earned: 90, available: 100, day: "2027-04-01" });
    await ev({ s: students[4], lo: l, source: "CT", earned: 50, available: 100, day: "2027-04-10" });
    const pair = [{ studentId: String(students[4]), loCode: l }];
    await recomputeForStudentsLos(pair, year);
    await ev({ s: students[4], lo: l, source: "CT", earned: 40, available: 100, day: "2027-04-20" }); // CT falls to 45
    const r = await recomputeForStudentsLos(pair, year);
    expect(r.updated).toBe(1);
    expect(r.opened).toBe(0);
    const cases = await IntegrityCase.find({ studentId: students[4], loCode: l });
    expect(cases).toHaveLength(1);
    expect(cases[0].ctPct).toBe(45);
    expect(cases[0].history).toHaveLength(2);
  });

  it("a repeated sweep leaves history and the update count alone", async () => {
    const l = nextLo();
    await ev({ s: students[5], lo: l, source: "HW", earned: 10, available: 10, day: "2027-05-21" });
    await ev({ s: students[5], lo: l, source: "CT", earned: 1, available: 10, day: "2027-05-22" });
    await sweepYear();
    const first = await IntegrityCase.findOne({ studentId: students[5], loCode: l });
    const again = await sweepYear();
    const second = await IntegrityCase.findOne({ studentId: students[5], loCode: l });
    expect(first!.history).toHaveLength(1);
    expect(second!.history).toHaveLength(1);
    expect(again.updated).toBe(0);
  });

  it("ignores routed rows", async () => {
    const l = nextLo();
    await ev({ s: students[2], lo: l, source: "HW", earned: 10, available: 10, day: "2027-05-21" });
    await ev({ s: students[2], lo: l, source: "CT", earned: 1, available: 10, day: "2027-05-22" });
    await MasteryEvidence.updateMany({ studentId: students[2], loCode: l, source: "HW" }, { $set: { routed: true } });
    await recomputeForStudentsLos([{ studentId: String(students[2]), loCode: l }], year);
    expect(await IntegrityCase.countDocuments({ studentId: students[2], loCode: l })).toBe(0);
  });

  it("concurrent sweeps share one run", async () => {
    const [a, b] = [sweepYear(), sweepYear()];
    expect(a).toBe(b);
    await a;
  });

  it("the sweep finds pairs with both sides and is idempotent", async () => {
    const l = nextLo();
    await ev({ s: students[5], lo: l, source: "AS", earned: 10, available: 10, day: "2027-05-01" });
    await ev({ s: students[5], lo: l, source: "CT", earned: 1, available: 10, day: "2027-05-10" });
    await sweepYear();
    await sweepYear();
    expect(await IntegrityCase.countDocuments({ studentId: students[5], loCode: l })).toBe(1);
  });
});

describe("closing and reopening", () => {
  it("records the outcome, changes no mark, and a closed case reopens only on new evidence", async () => {
    const l = nextLo();
    await ev({ s: students[6], lo: l, source: "HW", earned: 100, available: 100, day: "2027-06-01" });
    await ev({ s: students[6], lo: l, source: "CT", earned: 0, available: 100, day: "2027-06-10" });
    const pair = [{ studentId: String(students[6]), loCode: l }];
    await recomputeForStudentsLos(pair, year);
    const open = await IntegrityCase.findOne({ studentId: students[6], loCode: l, status: "OPEN" });
    const evBefore = await MasteryEvidence.find({ studentId: students[6], loCode: l }).lean();

    const closed = await recordOutcome(String(open!._id), "GUARDIAN_DID", "  অভিভাবকের সাথে কথা হয়েছে  ", OFFICE);
    expect(closed.status).toBe("CLOSED");
    expect(closed.outcome).toBe("GUARDIAN_DID");
    expect(closed.note).toBe("অভিভাবকের সাথে কথা হয়েছে");
    expect(await MasteryEvidence.find({ studentId: students[6], loCode: l }).lean()).toEqual(evBefore);
    await expect(recordOutcome(String(open!._id), "UNCLEAR", null, OFFICE)).rejects.toThrow();
    await expect(recordOutcome(String(new Types.ObjectId()), "BOGUS", null, OFFICE)).rejects.toThrow();

    // No new evidence since closing: stays closed.
    expect((await recomputeForStudentsLos(pair, year)).reopened).toBe(0);
    expect(await IntegrityCase.countDocuments({ studentId: students[6], loCode: l, status: "OPEN" })).toBe(0);

    // New evidence, gap still 20+: a new OPEN case; the old record stays.
    await new Promise((r) => setTimeout(r, 15));
    await ev({ s: students[6], lo: l, source: "AS", earned: 10, available: 10, day: "2027-06-20" }); // after the CT cutoff: unused
    expect((await recomputeForStudentsLos(pair, year)).reopened).toBe(0);
    // A CT resave with the same marks (new rows, same numbers): no reopen.
    await MasteryEvidence.updateMany({ studentId: students[6], loCode: l, source: "CT" }, { $set: { supersededAt: new Date() } });
    await ev({ s: students[6], lo: l, source: "CT", earned: 0, available: 100, day: "2027-06-10" });
    expect((await recomputeForStudentsLos(pair, year)).reopened).toBe(0);
    // Used evidence that moves the numbers (HW before the cutoff): reopens.
    await ev({ s: students[6], lo: l, source: "HW", earned: 0, available: 10, day: "2027-06-05" });
    expect((await recomputeForStudentsLos(pair, year)).reopened).toBe(1);
    expect(await IntegrityCase.countDocuments({ studentId: students[6], loCode: l, status: "OPEN" })).toBe(1);
    expect(await IntegrityCase.countDocuments({ studentId: students[6], loCode: l, status: "CLOSED" })).toBe(1);
  });
});

describe("Office read", () => {
  it("lists with filters, marks a recurring child, and the detail carries the max hint step", async () => {
    const l1 = nextLo();
    const l2 = nextLo();
    for (const l of [l1, l2]) {
      await ev({ s: students[7], lo: l, source: "HW", earned: 10, available: 10, day: "2027-07-01", qid: `Q-${l}` });
      await ev({ s: students[7], lo: l, source: "CT", earned: 1, available: 10, day: "2027-07-10" });
    }
    await recomputeForStudentsLos([l1, l2].map((l) => ({ studentId: String(students[7]), loCode: l })), year);

    const rows = await listCases({ status: "OPEN", classToken: "C3", subject: "MATH", sectionId: String(sectionId) });
    const mine = rows.filter((r) => r.studentId === String(students[7]));
    expect(mine).toHaveLength(2);
    expect(mine.every((r) => r.recurring)).toBe(true);
    expect(mine[0].studentName).toBe("Child 8");
    expect(mine[0].sectionNameBn).toBe("মূল");
    expect(await listCases({ status: "CLOSED", subject: "MATH" })).toEqual(expect.not.arrayContaining(mine));
    expect(await listCases({ subject: "ENG" })).toHaveLength(0);

    // Two guardians of the child opened hint steps on the same question: the max wins.
    await HintView.create([
      { guardianUserId: new Types.ObjectId(), studentId: students[7], qid: `Q-${l1}`, step: 1, day: "2027-07-02" },
      { guardianUserId: new Types.ObjectId(), studentId: students[7], qid: `Q-${l1}`, step: 3, day: "2027-07-02" },
      { guardianUserId: new Types.ObjectId(), studentId: students[7], qid: `Q-${l1}`, step: 2, day: "2027-07-03" },
    ]);
    const steps = await hintStepsFor(String(students[7]), [`Q-${l1}`, `Q-${l2}`]);
    expect(steps.get(`Q-${l1}`)).toBe(3);
    expect(steps.has(`Q-${l2}`)).toBe(false);
    const detail = await caseDetail(mine.find((r) => r.loCode === l1)!.id);
    expect(detail.hwItems.map((i) => i.hintStep)).toEqual([3]);
    expect(detail.ctItems).toHaveLength(1);
    expect(detail.history).toHaveLength(1);
  });
});

describe("no guardian message", () => {
  it("creates no notification in recompute or record, and the service never imports the notification layer", async () => {
    const before = await Notification.countDocuments({});
    const l = nextLo();
    await ev({ s: students[0], lo: l, source: "HW", earned: 10, available: 10, day: "2027-08-01" });
    await ev({ s: students[0], lo: l, source: "CT", earned: 0, available: 10, day: "2027-08-10" });
    await sweepYear();
    const c = await IntegrityCase.findOne({ studentId: students[0], loCode: l });
    await recordOutcome(String(c!._id), "CHILD_DID", null, OFFICE);
    expect(await Notification.countDocuments({})).toBe(before);
    const src = fs.readFileSync(path.resolve(__dirname, "../modules/homework-integrity/services/IntegrityService.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*notifications/);
  });
});
