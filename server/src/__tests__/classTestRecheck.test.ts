/**
 * CT-RC — unusual-mark recheck (docs/prd-ct-mark-recheck.md).
 *
 * Part 1, pure: the R1–R4 rules in percentage points, the subject → all-subject fallback,
 *         the tick that only holds for the mark it was given for.
 * Part 2, on a real in-memory Mongo: the submit gate, the teacher's tick, the approver's
 *         own tick, Option B hold → the rest publish → release / correct (a corrected mark
 *         is a quiet tier-2 note in the teacher's mistake record), and the % rules.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  deriveClassFlag,
  deriveRowFlag,
  marksKeyOf,
  rowTickValid,
  type RecheckRules,
} from "../modules/trackers/classTestRecheck";
import { User } from "../modules/foundation/models/User";
import { Student } from "../modules/foundation/models/Student";
import { Notification } from "../modules/notifications/models/Notification";
import { ClassTest } from "../modules/trackers/models/ClassTest";
import { ClassTestResult } from "../modules/trackers/models/ClassTestResult";
import { ClassTestRecheckSettings } from "../modules/trackers/models/ClassTestRecheckSettings";
import { StaffMistake } from "../modules/staff-mistakes/models/StaffMistake";
import { approveExam, submitExam } from "../modules/trackers/services/ClassTestPublishService";
import {
  approvalFlagCount,
  confirmRecheck,
  recheckRules,
  recheckView,
  saveRecheckRules,
} from "../modules/trackers/services/ClassTestRecheckService";
import { correctHeld, heldResults, releaseHeld, setRecheckHold } from "../modules/trackers/services/ClassTestRecheckHoldService";

const RULES: RecheckRules = { enabled: true, highPct: 20, lowPct: 20, fullMarksBelowPct: 85, classHighPct: 15, minPriorTests: 3 };
const hist = (subject: number[], extra: number[] = []) => ({ subjectPcts: subject, allPcts: [...subject, ...extra] });

// ---------------------------------------------------------------------------
// Part 1 — pure rules
// ---------------------------------------------------------------------------

describe("CT-RC rules (percentage points; a 20-mark test makes 1 mark = 5%)", () => {
  const row = (marks: number | null, status = "PRESENT") => ({ studentId: "s1", status, marks });

  it("R1: 4 marks above a 12/20 average (60% → 80%) is flagged; 3 marks above is not", () => {
    expect(deriveRowFlag(row(16), 20, hist([60, 60, 60]), RULES)?.kinds).toEqual(["HIGH"]);
    expect(deriveRowFlag(row(15), 20, hist([60, 60, 60]), RULES)).toBeNull();
  });

  it("R2: 4 marks below a 16/20 average (80% → 60%) is flagged", () => {
    const f = deriveRowFlag(row(12), 20, hist([80, 80, 80]), RULES);
    expect(f?.kinds).toEqual(["LOW"]);
    expect(f?.averagePct).toBe(80);
  });

  it("R3: full marks while the average is under 85% — even when R1 would not fire (82% → 100%)", () => {
    expect(deriveRowFlag(row(20), 20, hist([82, 82, 82]), RULES)?.kinds).toEqual(["FULL"]);
    expect(deriveRowFlag(row(20), 20, hist([90, 90, 90]), RULES)).toBeNull();
    expect(deriveRowFlag(row(20), 20, hist([58, 58, 58]), RULES)?.kinds).toEqual(["HIGH", "FULL"]);
  });

  it("falls back to the all-subject average with too few tests in the subject; with none, only R3 applies", () => {
    const f = deriveRowFlag(row(16), 20, hist([60], [60, 60]), RULES);
    expect(f?.basis).toBe("ALL");
    expect(f?.kinds).toEqual(["HIGH"]);
    expect(deriveRowFlag(row(19), 20, hist([]), RULES)).toBeNull();
    expect(deriveRowFlag(row(20), 20, hist([]), RULES)).toMatchObject({ basis: "NONE", kinds: ["FULL"], averagePct: null });
  });

  it("an absent student and a switched-off rule set never flag", () => {
    expect(deriveRowFlag(row(null, "ABSENT"), 20, hist([10, 10, 10]), RULES)).toBeNull();
    expect(deriveRowFlag(row(20), 20, hist([10, 10, 10]), { ...RULES, enabled: false })).toBeNull();
  });

  it("works on any total, not only 20 (percent of the total)", () => {
    expect(deriveRowFlag(row(40), 50, hist([60, 60, 60]), RULES)?.kinds).toEqual(["HIGH"]); // 80%
  });

  it("R4: the class average 15% above its usual level flags the whole test (≥ 3 present, ≥ 3 earlier tests)", () => {
    const rows = [16, 16, 16].map((marks) => ({ status: "PRESENT", marks }));
    expect(deriveClassFlag(rows, 20, { pcts: [62, 62, 66], tests: 3 }, RULES)).toMatchObject({ classPct: 80, usualPct: 63.3 });
    expect(deriveClassFlag(rows, 20, { pcts: [70, 70, 70], tests: 3 }, RULES)).toBeNull();
    expect(deriveClassFlag(rows, 20, { pcts: [50], tests: 2 }, RULES)).toBeNull();
    expect(deriveClassFlag(rows.slice(0, 2), 20, { pcts: [50, 50, 50], tests: 3 }, RULES)).toBeNull();
  });

  it("a tick holds only for the mark it was given for; the class fingerprint ignores row order", () => {
    expect(rowTickValid({ status: "PRESENT", marks: 20, recheck: { marks: 20 } })).toBe(true);
    expect(rowTickValid({ status: "PRESENT", marks: 19, recheck: { marks: 20 } })).toBe(false);
    const a = [{ studentId: "a", status: "PRESENT", marks: 10 }, { studentId: "b", status: "ABSENT", marks: null }];
    expect(marksKeyOf(a)).toBe(marksKeyOf([...a].reverse()));
    expect(marksKeyOf(a)).not.toBe(marksKeyOf([{ ...a[0], marks: 11 }, a[1]]));
  });
});

// ---------------------------------------------------------------------------
// Part 2 — the flow on an in-memory Mongo
// ---------------------------------------------------------------------------

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let seq = 0;
const YEAR = new Types.ObjectId();

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
    [User, Student, Notification, ClassTest, ClassTestResult, ClassTestRecheckSettings, StaffMistake].map((m) =>
      (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
});

async function user(name: string, role = "TEACHER"): Promise<string> {
  seq += 1;
  const r = await User.collection.insertOne({
    name, role, active: true, phone: `8801755000${seq}`, passwordHash: "x",
    grantedPermissions: ["staff_mistakes:view_own"], revokedPermissions: [], additionalTemplates: [],
  });
  return r.insertedId.toString();
}

async function makeTest(teacher: string, sectionId: Types.ObjectId, subject = "ENG"): Promise<string> {
  seq += 1;
  const t = await ClassTest.create({
    ctId: `CT-C4-${subject}-${String(seq).padStart(4, "0")}`, academicYearId: YEAR, sectionId, subject,
    testNumber: seq, examDate: new Date("2026-11-01"), totalMarks: 20, passMark: 10, source: "UPLOADED_PAPER",
    status: "PRINTED", requestedBy: new Types.ObjectId(teacher), teacherId: new Types.ObjectId(teacher),
  });
  return t._id.toString();
}

/** A class of four with three earlier published English tests: Ayesha ~12/20, Mariam ~16/20,
 *  the other two ~14/20. Returns the new (draft) test with this time's marks. */
async function scenario(now: { ayesha: number; mariam: number; abdullah?: number; fatima?: number }) {
  const teacher = await user("Rubel");
  const office = await user("Kamrul", "OFFICE");
  const sectionId = new Types.ObjectId();
  const kids: Record<string, string> = {};
  for (const name of ["Ayesha", "Mariam", "Abdullah", "Fatima"]) {
    seq += 1;
    const s = await Student.collection.insertOne({ schoolId: `R-${seq}`, name, sectionId, classId: new Types.ObjectId(), active: true });
    kids[name] = s.insertedId.toString();
  }
  const usual: Record<string, number> = { Ayesha: 12, Mariam: 16, Abdullah: 14, Fatima: 14 };
  for (let i = 0; i < 3; i++) {
    const prior = await makeTest(teacher, sectionId);
    for (const [name, marks] of Object.entries(usual)) {
      await ClassTestResult.create({
        testId: prior, studentId: kids[name], status: "PRESENT", marks, enteredBy: new Types.ObjectId(teacher),
        submittedAt: new Date(), publishedAt: new Date(), publishedVersion: 1,
      });
    }
  }
  const testId = await makeTest(teacher, sectionId);
  const marks = { Ayesha: now.ayesha, Mariam: now.mariam, Abdullah: now.abdullah ?? 14, Fatima: now.fatima ?? 14 };
  for (const [name, m] of Object.entries(marks)) {
    await ClassTestResult.create({ testId, studentId: kids[name], status: "PRESENT", marks: m, enteredBy: new Types.ObjectId(teacher) });
  }
  return { teacher, office, testId, kids };
}

describe("CT-RC flow", () => {
  it("flags Ayesha (12 → 20, high + full) and Mariam (16 → 7, low); submit is refused until both are ticked", async () => {
    const { teacher, testId, kids } = await scenario({ ayesha: 20, mariam: 7 });
    const v = await recheckView(testId);
    expect(v.rows.map((r) => [r.studentName, r.kinds])).toEqual(
      expect.arrayContaining([["Ayesha", ["HIGH", "FULL"]], ["Mariam", ["LOW"]]]),
    );
    expect(v.rows.find((r) => r.studentName === "Ayesha")).toMatchObject({ averagePct: 60, percent: 100, basis: "SUBJECT", priorCount: 3 });
    expect(v.unconfirmedCount).toBe(2);
    expect(v.classFlag).toBeNull();

    await expect(submitExam(testId, teacher)).rejects.toThrow(/২ জনের অস্বাভাবিক নম্বর এখনো নিশ্চিত করা হয়নি/);
    expect(await ClassTestResult.countDocuments({ testId, submittedAt: { $ne: null } })).toBe(0);

    await confirmRecheck({ testId, studentId: kids.Ayesha, confirmed: true, note: "এই অধ্যায়টি ভালো পড়েছে", actorId: teacher });
    await expect(submitExam(testId, teacher)).rejects.toThrow(/Mariam/);
    const after = await confirmRecheck({ testId, studentId: kids.Mariam, confirmed: true, actorId: teacher });
    expect(after.unconfirmedCount).toBe(0);
    expect(after.rows.find((r) => r.studentName === "Ayesha")).toMatchObject({ confirmed: true, confirmedByName: "Rubel", note: "এই অধ্যায়টি ভালো পড়েছে" });

    const out = await submitExam(testId, teacher, { scriptReminderAck: true });
    expect(out.count).toBe(4);
    // The approvers' notice says how many unusual marks are coming.
    const n = await Notification.findOne({ kind: "CT_RESULT_SUBMITTED" }).lean();
    expect((n as { bodyBn: string } | null)?.bodyBn).toMatch(/২টি অস্বাভাবিক নম্বর/);
  });

  it("a tick is void once the mark changes, so the row is flagged again", async () => {
    const { teacher, testId, kids } = await scenario({ ayesha: 20, mariam: 15 });
    await confirmRecheck({ testId, studentId: kids.Ayesha, confirmed: true, actorId: teacher });
    expect((await recheckView(testId)).unconfirmedCount).toBe(0);
    await ClassTestResult.updateOne({ testId, studentId: kids.Ayesha }, { $set: { marks: 19 } });
    const v = await recheckView(testId);
    expect(v.rows.find((r) => r.studentName === "Ayesha")).toMatchObject({ confirmed: false, kinds: ["HIGH"] });
    expect(v.unconfirmedCount).toBe(1);
  });

  it("approval needs the approver's own tick when the submission carries flags", async () => {
    const { teacher, office, testId, kids } = await scenario({ ayesha: 20, mariam: 15 });
    await confirmRecheck({ testId, studentId: kids.Ayesha, confirmed: true, actorId: teacher });
    await submitExam(testId, teacher);
    expect(await approvalFlagCount(testId)).toBe(1);
    await expect(approveExam(testId, office)).rejects.toThrow(/অস্বাভাবিক নম্বরগুলো আমি দেখেছি/);
    const out = await approveExam(testId, office, { flagsReviewed: true });
    expect(out.recipients).toHaveLength(4);
    // The teacher's "published" notice now carries the script hand-in line.
    const n = await Notification.findOne({ kind: "CT_RESULT_PUBLISHED" }).lean();
    expect((n as { bodyBn: string } | null)?.bodyBn).toMatch(/খাতা অফিসে জমা দিন — শিক্ষার্থীদের নয়/);
  });

  it("Option B: a held row stays back while the rest publish; release publishes it", async () => {
    const { teacher, office, testId, kids } = await scenario({ ayesha: 20, mariam: 15 });
    await confirmRecheck({ testId, studentId: kids.Ayesha, confirmed: true, actorId: teacher });
    await submitExam(testId, teacher);
    await setRecheckHold(testId, kids.Ayesha, true, office);
    const out = await approveExam(testId, office, { flagsReviewed: true });
    expect(out.recipients.map((r) => r.studentId)).not.toContain(kids.Ayesha);
    expect(out.recipients).toHaveLength(3);

    const held = await heldResults();
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ studentName: "Ayesha", marks: 20, confirmed: true, held: true, averagePct: 60 });

    await releaseHeld(testId, kids.Ayesha, office);
    const row = await ClassTestResult.findOne({ testId, studentId: kids.Ayesha }).lean();
    expect(row?.publishedAt).toBeTruthy();
    expect(row?.recheckHold ?? null).toBeNull();
    expect(await heldResults()).toHaveLength(0);
    expect(await StaffMistake.countDocuments({})).toBe(0);
  });

  it("Option B: a corrected held mark publishes the right mark and leaves a quiet tier-2 note for the teacher", async () => {
    const { teacher, office, testId, kids } = await scenario({ ayesha: 20, mariam: 15 });
    await confirmRecheck({ testId, studentId: kids.Ayesha, confirmed: true, actorId: teacher });
    await submitExam(testId, teacher);
    await setRecheckHold(testId, kids.Ayesha, true, office);
    await approveExam(testId, office, { flagsReviewed: true });

    await expect(correctHeld(testId, kids.Ayesha, 21, office)).rejects.toThrow(/০ থেকে ২০/);
    await correctHeld(testId, kids.Ayesha, 13, office);
    const row = await ClassTestResult.findOne({ testId, studentId: kids.Ayesha }).lean();
    expect(row).toMatchObject({ marks: 13 });
    expect(row?.publishedAt).toBeTruthy();
    const m = await StaffMistake.findOne({ kind: "CT_RECHECK_WRONG" }).lean();
    expect(m).toBeTruthy();
    expect(m?.staffUserId.toString()).toBe(teacher);
    expect((m as unknown as { tier: number }).tier).toBe(2);
  });

  it("only a submitted, unpublished row can be held", async () => {
    const { office, testId, kids } = await scenario({ ayesha: 20, mariam: 15 });
    await expect(setRecheckHold(testId, kids.Ayesha, true, office)).rejects.toThrow(/জমা দেওয়ার পরই/);
  });

  it("R4: a whole class far above its usual level needs ONE class tick", async () => {
    // Usual ≈ 70%; this time everyone ~ 19/20 → class ≈ 92.5%.
    const { teacher, testId, kids } = await scenario({ ayesha: 18, mariam: 19, abdullah: 19, fatima: 18 });
    const v = await recheckView(testId);
    expect(v.classFlag).toMatchObject({ confirmed: false });
    expect(v.classFlag!.classPct - v.classFlag!.usualPct).toBeGreaterThanOrEqual(15);
    // Several are far above their own level too (Ayesha 60% → 90%); tick each of them first.
    expect(v.rows.length).toBeGreaterThan(0);
    for (const r of v.rows) await confirmRecheck({ testId, studentId: r.studentId, confirmed: true, actorId: teacher });
    void kids;
    await expect(submitExam(testId, teacher)).rejects.toThrow(/পুরো শ্রেণির নম্বর অস্বাভাবিক বেশি/);
    await confirmRecheck({ testId, studentId: null, confirmed: true, note: "প্রশ্ন সহজ ছিল", actorId: teacher });
    expect((await recheckView(testId)).classFlag).toMatchObject({ confirmed: true, note: "প্রশ্ন সহজ ছিল" });
    await expect(submitExam(testId, teacher)).resolves.toMatchObject({ count: 4 });
  });

  it("the % rules are configurable, bounded, and switching them off removes every flag", async () => {
    const office = await user("Office", "OFFICE");
    expect(await recheckRules()).toMatchObject({ highPct: 20, lowPct: 20, fullMarksBelowPct: 85, classHighPct: 15, isDefault: true });
    await expect(saveRecheckRules({ highPct: 2 }, office)).rejects.toThrow();
    await expect(saveRecheckRules({ highPct: 25.5 }, office)).rejects.toThrow();
    expect(await saveRecheckRules({ highPct: 30, lowPct: 25 }, office)).toMatchObject({ highPct: 30, lowPct: 25, fullMarksBelowPct: 85, isDefault: false });

    const { teacher, testId } = await scenario({ ayesha: 17, mariam: 15 }); // 60% → 85%: +25 < 30
    expect((await recheckView(testId)).rows).toHaveLength(0);
    await saveRecheckRules({ enabled: false }, office);
    const off = await scenario({ ayesha: 20, mariam: 7 });
    expect((await recheckView(off.testId)).rows).toHaveLength(0);
    await expect(submitExam(off.testId, off.teacher)).resolves.toMatchObject({ count: 4 });
    void teacher;
  });
});
