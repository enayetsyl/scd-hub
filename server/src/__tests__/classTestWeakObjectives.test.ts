/**
 * Class-test weak objectives (docs/prd-ct-weak-objectives.md §3, D-#1360–#1364) on a real
 * in-memory Mongo, through enterResult, the guardian read and the GraphQL schema:
 *
 *   1. no LOCKED catalogue → no picker, a save without the field is exactly as before
 *   2. another class / subject, a grouping row, a draft row, a sixth code → refused
 *   3. field omitted keeps, [] clears, ABSENT clears
 *   4. a submitted or published result refuses a change
 *   5. the guardian payload carries objective labels only — no code, no sub-objective label
 *   6. classTestWeakObjectivesPage: only that student's picks, and the caller's scope applies
 */
import mongoose, { Types } from "mongoose";
import { graphql } from "graphql";
import { MongoMemoryServer } from "mongodb-memory-server";
import { builder } from "../schema";
import "../registerResolvers";
import type { AppContext } from "../context";
import { ClassTest } from "../modules/trackers/models/ClassTest";
import { ClassTestResult } from "../modules/trackers/models/ClassTestResult";
import { MasteryOutcome } from "../modules/mastery/models/MasteryOutcome";
import { MasteryChapter } from "../modules/mastery/models/MasteryChapter";
import { Student } from "../modules/foundation/models/Student";
import { Section } from "../modules/foundation/models/Section";
import { ScopeGrant } from "../modules/foundation/models/ScopeGrant";
import { MasteryEnablement } from "../modules/mastery/models/MasteryEnablement";
import { buildClassTestResultMessage } from "../modules/trackers/services/ClassTestPublishService";
import { enterResult, childTestResults } from "../modules/trackers/services/ClassTestResultService";
import { weakLoOptions, classTestWeakObjectivesPage } from "../modules/trackers/services/ClassTestWeakObjectiveService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([ClassTest, ClassTestResult, MasteryOutcome, MasteryChapter, MasteryEnablement, Student, Section, ScopeGrant].map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})));
});

const ACTOR = new Types.ObjectId().toString();
const EXAM_DAY = new Date("2026-11-10T00:00:00.000Z");
const NOW = new Date("2026-11-11T06:00:00.000Z");
let seq = 0;

async function test(over: Record<string, unknown> = {}): Promise<string> {
  seq += 1;
  const r = await ClassTest.collection.insertOne({
    ctId: `CT-C1-MATH-${String(seq).padStart(4, "0")}`,
    academicYearId: new Types.ObjectId(),
    classLevel: 1,
    classId: new Types.ObjectId(),
    sectionId: new Types.ObjectId(),
    subject: "MATH",
    testNumber: seq,
    examDate: EXAM_DAY,
    totalMarks: 20,
    passMark: 8,
    source: "TEACHER",
    status: "PRINTED",
    deadlineDays: 2,
    requestedBy: new Types.ObjectId(),
    requestedAt: EXAM_DAY,
    ...over,
  });
  return r.insertedId.toString();
}

const outcome = (code: string, over: Record<string, unknown> = {}) => ({
  code,
  classToken: "C1",
  subject: "MATH",
  chapterNumber: 1,
  strand: null,
  labelBn: code.replace("LO-C1-MATH-", "লেবেল "),
  sourceText: "",
  assess: "WRITTEN",
  questionTypeCodes: [],
  order: 0,
  status: "LOCKED",
  level: "OBJECTIVE",
  tagged: true,
  ...over,
});

/** A LOCKED C1 MATH tree: 01-01 tagged; 01-02 a grouping parent with subs .1 and .2; 01-03 draft. */
async function lockedCatalogue(): Promise<void> {
  await MasteryOutcome.collection.insertMany([
    outcome("LO-C1-MATH-01-01", { order: 1 }),
    outcome("LO-C1-MATH-01-02", { order: 2, tagged: false }),
    outcome("LO-C1-MATH-01-02.1", { order: 3, level: "SUB", parentCode: "LO-C1-MATH-01-02" }),
    outcome("LO-C1-MATH-01-02.2", { order: 4, level: "SUB", parentCode: "LO-C1-MATH-01-02" }),
    outcome("LO-C1-MATH-01-03", { order: 5, status: "DRAFT" }),
    outcome("LO-C1-MATH-01-04", { order: 6 }),
    outcome("LO-C1-MATH-01-05", { order: 7 }),
    outcome("LO-C1-MATH-01-06", { order: 8 }),
    outcome("LO-C1-MATH-01-07", { order: 9 }),
    outcome("LO-C2-MATH-01-01", { classToken: "C2" }),
    outcome("LO-C1-ENG-01-01", { subject: "ENG" }),
  ]);
  await MasteryChapter.collection.insertOne({ classToken: "C1", subject: "MATH", number: 1, titleBn: "সংখ্যা", order: 1 });
}

const enter = (testId: string, studentId: string, extra: Record<string, unknown> = {}) =>
  enterResult({ testId, studentId, status: "PRESENT", marks: 12, weakness: "যোগে ভুল", actorId: ACTOR, now: NOW, ...extra });

const stored = async (testId: string, studentId: string) =>
  ClassTestResult.findOne({ testId: new Types.ObjectId(testId), studentId: new Types.ObjectId(studentId) }).lean();

describe("1 · no LOCKED catalogue", () => {
  it("offers no picker and saves exactly as before", async () => {
    await MasteryOutcome.collection.insertOne(outcome("LO-C1-MATH-01-01", { status: "DRAFT" }));
    const t = await test();
    expect((await weakLoOptions({ classLevel: 1, subject: "MATH" })).available).toBe(false);
    const sid = new Types.ObjectId().toString();
    const res = await enter(t, sid);
    expect(res.weakLoCodes).toEqual([]);
    const row = await stored(t, sid);
    expect(row).not.toHaveProperty("weakLoCodes");
    expect(row?.weakness).toBe("যোগে ভুল");
  });
});

describe("2 · refusals", () => {
  beforeEach(lockedCatalogue);

  it("lists only tagged LOCKED rows of the class × subject, with the chapter title", async () => {
    const o = await weakLoOptions({ classLevel: 1, subject: "MATH" });
    expect(o.available).toBe(true);
    expect(o.options.map((x) => x.code)).toEqual([
      "LO-C1-MATH-01-01",
      "LO-C1-MATH-01-02.1",
      "LO-C1-MATH-01-02.2",
      "LO-C1-MATH-01-04",
      "LO-C1-MATH-01-05",
      "LO-C1-MATH-01-06",
      "LO-C1-MATH-01-07",
    ]);
    expect(o.options[0].chapterTitleBn).toBe("সংখ্যা");
    // A group-anchored test never gets the picker.
    expect((await weakLoOptions({ classLevel: null, subject: "MATH", subjectGroupId: new Types.ObjectId() })).available).toBe(false);
  });

  it.each([
    ["another class", ["LO-C2-MATH-01-01"], /শ্রেণি ও বিষয়ের শিখনফল নয়/],
    ["another subject", ["LO-C1-ENG-01-01"], /শ্রেণি ও বিষয়ের শিখনফল নয়/],
    ["an unknown code", ["LO-C1-MATH-09-09"], /শ্রেণি ও বিষয়ের শিখনফল নয়/],
    ["a grouping row", ["LO-C1-MATH-01-02"], /দলবদ্ধ সারি/],
    ["a draft row", ["LO-C1-MATH-01-03"], /চূড়ান্ত \(লক\)/],
    [
      "a sixth code",
      ["LO-C1-MATH-01-01", "LO-C1-MATH-01-02.1", "LO-C1-MATH-01-02.2", "LO-C1-MATH-01-04", "LO-C1-MATH-01-05", "LO-C1-MATH-01-06"],
      /সর্বোচ্চ ৫টি/,
    ],
  ])("refuses %s", async (_name, codes, msg) => {
    const t = await test();
    await expect(enter(t, new Types.ObjectId().toString(), { weakLoCodes: codes })).rejects.toThrow(msg);
  });

  it("refuses any pick on a group-anchored test", async () => {
    const t = await test({ classLevel: null, classId: null, sectionId: null, subjectGroupId: new Types.ObjectId() });
    // The group-membership gate runs first; satisfy it with a member row.
    const sid = new Types.ObjectId();
    await mongoose.connection.collection("subjectgroupmemberships").insertOne({ groupId: (await ClassTest.findById(t).lean())!.subjectGroupId, studentId: sid });
    await expect(enter(t, sid.toString(), { weakLoCodes: ["LO-C1-MATH-01-01"] })).rejects.toThrow(/বাছাই করা যায় না/);
  });

  it("accepts five valid codes (duplicates collapse)", async () => {
    const t = await test();
    const sid = new Types.ObjectId().toString();
    const five = ["LO-C1-MATH-01-01", "LO-C1-MATH-01-02.1", "LO-C1-MATH-01-04", "LO-C1-MATH-01-05", "LO-C1-MATH-01-06"];
    const res = await enter(t, sid, { weakLoCodes: [...five, "LO-C1-MATH-01-01"] });
    expect(res.weakLoCodes).toEqual(five);
  });
});

describe("3 · keep / clear / absent", () => {
  beforeEach(lockedCatalogue);

  it("omitted keeps, [] clears, ABSENT clears and refuses picks", async () => {
    const t = await test();
    const sid = new Types.ObjectId().toString();
    await enter(t, sid, { weakLoCodes: ["LO-C1-MATH-01-01", "LO-C1-MATH-01-02.1"] });
    // An older phone build sends no field → the picks stay.
    await enter(t, sid, { marks: 14 });
    expect((await stored(t, sid))?.weakLoCodes).toEqual(["LO-C1-MATH-01-01", "LO-C1-MATH-01-02.1"]);
    // null is "not sent" too.
    await enter(t, sid, { weakLoCodes: null });
    expect((await stored(t, sid))?.weakLoCodes).toEqual(["LO-C1-MATH-01-01", "LO-C1-MATH-01-02.1"]);
    // [] clears.
    await enter(t, sid, { weakLoCodes: [] });
    expect(await stored(t, sid)).not.toHaveProperty("weakLoCodes");
    // ABSENT clears, like the three comments.
    await enter(t, sid, { weakLoCodes: ["LO-C1-MATH-01-04"] });
    await enterResult({ testId: t, studentId: sid, status: "ABSENT", actorId: ACTOR, now: NOW });
    expect(await stored(t, sid)).not.toHaveProperty("weakLoCodes");
    await expect(
      enterResult({ testId: t, studentId: sid, status: "ABSENT", weakLoCodes: ["LO-C1-MATH-01-04"], actorId: ACTOR, now: NOW }),
    ).rejects.toThrow(/অনুপস্থিত শিক্ষার্থীর জন্য শিখনফল বাছাই করা যাবে না/);
  });
});

describe("4 · locks", () => {
  beforeEach(lockedCatalogue);

  it.each([
    ["submitted", { submittedAt: new Date() }, /submitted for approval/],
    ["published", { publishedAt: new Date() }, /published/],
  ])("a %s result refuses a change to the codes", async (_n, set, msg) => {
    const t = await test();
    const sid = new Types.ObjectId().toString();
    await enter(t, sid, { weakLoCodes: ["LO-C1-MATH-01-01"] });
    await ClassTestResult.updateOne({ testId: new Types.ObjectId(t), studentId: new Types.ObjectId(sid) }, { $set: set });
    await expect(enter(t, sid, { weakLoCodes: ["LO-C1-MATH-01-04"] })).rejects.toThrow(msg);
    await expect(enter(t, sid, { weakLoCodes: [] })).rejects.toThrow(msg);
    expect((await stored(t, sid))?.weakLoCodes).toEqual(["LO-C1-MATH-01-01"]);
  });
});

describe("5 · guardian payload", () => {
  beforeEach(lockedCatalogue);

  it("carries objective labels only — a sub-objective reads as its parent, no code anywhere", async () => {
    const t = await test();
    const sid = new Types.ObjectId().toString();
    await enter(t, sid, { weakLoCodes: ["LO-C1-MATH-01-02.1", "LO-C1-MATH-01-02.2", "LO-C1-MATH-01-01"] });
    await ClassTestResult.updateOne({ testId: new Types.ObjectId(t) }, { $set: { publishedAt: new Date() } });
    const [row] = await childTestResults(sid);
    expect(row.weakObjectives).toEqual(["লেবেল 01-02", "লেবেল 01-01"]);
    expect(row.weakObjectivesWordBn).toBe("শিখনফল");
    const wire = JSON.stringify(row);
    expect(wire).not.toMatch(/LO-C1/);
    expect(wire).not.toMatch(/লেবেল 01-02\.\d/);
    expect(row).not.toHaveProperty("weakLoCodes");
  });

  it("a result with no picks is unchanged (empty list, no word)", async () => {
    const t = await test();
    const sid = new Types.ObjectId().toString();
    await enter(t, sid);
    await ClassTestResult.updateOne({ testId: new Types.ObjectId(t) }, { $set: { publishedAt: new Date() } });
    const [row] = await childTestResults(sid);
    expect(row.weakObjectives).toEqual([]);
    expect(row.weakObjectivesWordBn).toBeNull();
  });
});

describe("6 · classTestWeakObjectivesPage", () => {
  beforeEach(lockedCatalogue);

  const ctxOf = (userId: string, role: string): AppContext =>
    ({ auth: { userId, role, grantedPermissions: [], revokedPermissions: [], additionalTemplates: [] } } as unknown as AppContext);

  const QUERY = `query($studentId: String!, $subject: String!, $page: Int, $pageSize: Int) {
    classTestWeakObjectivesPage(studentId: $studentId, subject: $subject, page: $page, pageSize: $pageSize) {
      rows { code labelBn testId ctId testNumber examDate published } total page pageSize
    }
  }`;

  it("returns only that student's picks in that subject, newest first, paged", async () => {
    const sid = new Types.ObjectId().toString();
    const other = new Types.ObjectId().toString();
    const t1 = await test({ examDate: new Date("2026-11-01T00:00:00.000Z") });
    const t2 = await test();
    const eng = await test({ subject: "ENG" });
    await enter(t1, sid, { weakLoCodes: ["LO-C1-MATH-01-01"] });
    await enter(t2, sid, { weakLoCodes: ["LO-C1-MATH-01-04", "LO-C1-MATH-01-02.1"] });
    await enter(t2, other, { weakLoCodes: ["LO-C1-MATH-01-05"] });
    await enter(eng, sid, { weakLoCodes: ["LO-C1-ENG-01-01"] });
    const p = await classTestWeakObjectivesPage(sid, "MATH", { page: 1, pageSize: 2 });
    expect(p.total).toBe(3);
    expect(p.rows.map((r) => [r.testId, r.code])).toEqual([
      [t2, "LO-C1-MATH-01-04"],
      [t2, "LO-C1-MATH-01-02.1"],
    ]);
    expect(p.rows[0].labelBn).toBe("লেবেল 01-04");
    const p2 = await classTestWeakObjectivesPage(sid, "MATH", { page: 2, pageSize: 2 });
    expect(p2.rows.map((r) => r.code)).toEqual(["LO-C1-MATH-01-01"]);
  });

  it("respects the caller's scope: view_all reads, an unscoped teacher is refused, a section teacher reads", async () => {
    const sectionId = new Types.ObjectId();
    const classId = new Types.ObjectId();
    await Section.collection.insertOne({ _id: sectionId, classId, code: "A", nameBn: "ক", active: true });
    const st = await Student.collection.insertOne({ schoolId: "S-1", name: "Rahim", classId, sectionId, active: true });
    const sid = st.insertedId.toString();
    const t = await test({ sectionId, classId });
    await enter(t, sid, { weakLoCodes: ["LO-C1-MATH-01-01"] });

    const schema = builder.toSchema();
    const run = (ctx: AppContext) => graphql({ schema, source: QUERY, variableValues: { studentId: sid, subject: "MATH" }, contextValue: ctx });

    const principal = await run(ctxOf(new Types.ObjectId().toString(), "PRINCIPAL"));
    expect(principal.errors).toBeUndefined();
    expect((principal.data as any).classTestWeakObjectivesPage.total).toBe(1); // eslint-disable-line @typescript-eslint/no-explicit-any

    const teacherId = new Types.ObjectId();
    const refused = await run(ctxOf(teacherId.toString(), "TEACHER"));
    expect(refused.errors?.length).toBeGreaterThan(0);

    await ScopeGrant.collection.insertOne({
      teacherId,
      kind: "teaching",
      active: true,
      source: "manual",
      createdBy: new Types.ObjectId(),
      classId,
      sectionId,
      subjectId: new Types.ObjectId(),
    });
    const allowed = await run(ctxOf(teacherId.toString(), "TEACHER"));
    expect(allowed.errors).toBeUndefined();
    expect((allowed.data as any).classTestWeakObjectivesPage.rows[0].code).toBe("LO-C1-MATH-01-01"); // eslint-disable-line @typescript-eslint/no-explicit-any

    const guardian = await run(ctxOf(new Types.ObjectId().toString(), "GUARDIAN"));
    expect(guardian.errors?.length).toBeGreaterThan(0);
  });
});

describe("7 · guardian message (D-#1430: picks alone make it the feedback message)", () => {
  beforeEach(lockedCatalogue);
  const meta = { subject: "MATH", testNumber: 3, examDate: EXAM_DAY, totalMarks: 20 };

  it("picks + empty text → feedback template with objective names, no codes, sub shown as its parent", async () => {
    const m = await buildClassTestResultMessage(
      { status: "PRESENT", marks: 12, weakness: "", weakLoCodes: ["LO-C1-MATH-01-02.1", "LO-C1-MATH-01-02.2", "LO-C1-MATH-01-01"] },
      meta,
      "করিম",
    );
    expect(m.kind).toBe("regular");
    expect(m.messageBn).toContain("লক্ষণীয় দিক:");
    expect(m.messageBn).toContain("দুর্বল শিখনফল: লেবেল 01-02، লেবেল 01-01");
    expect(m.messageBn).not.toMatch(/LO-C1/);
    expect(m.messageBn).not.toMatch(/লেবেল 01-02\.\d/);
    expect(m.messageBn).not.toContain("আলহামদুলিল্লাহ");
  });

  it("text + picks → both appear; text alone → as before", async () => {
    const both = await buildClassTestResultMessage(
      { status: "PRESENT", marks: 12, weakness: "যোগে ভুল", weakLoCodes: ["LO-C1-MATH-01-01"] },
      meta,
      "করিম",
    );
    expect(both.kind).toBe("regular");
    expect(both.messageBn).toContain("যোগে ভুল");
    expect(both.messageBn).toContain("দুর্বল শিখনফল: লেবেল 01-01");
    const textOnly = await buildClassTestResultMessage({ status: "PRESENT", marks: 12, weakness: "যোগে ভুল" }, meta, "করিম");
    expect(textOnly.messageBn).not.toContain("দুর্বল শিখনফল");
  });

  it("no picks + empty text → the excellent template as today (also with an empty list)", async () => {
    for (const weakLoCodes of [undefined, null, []]) {
      const m = await buildClassTestResultMessage({ status: "PRESENT", marks: 20, weakness: "", weakLoCodes }, meta, "করিম");
      expect(m.kind).toBe("excellent");
      expect(m.messageBn).toContain("আলহামদুলিল্লাহ");
    }
  });

  it("absent child → absent template, picks (even if stored) never reach the message", async () => {
    const m = await buildClassTestResultMessage(
      { status: "ABSENT", marks: null, weakLoCodes: ["LO-C1-MATH-01-01"] },
      meta,
      "করিম",
    );
    expect(m.kind).toBe("absent");
    expect(m.messageBn).not.toContain("লেবেল");
  });

  it("the guardian card line shows with the mastery switch off, absent and on", async () => {
    const check = async () => {
      const t = await test();
      const sid = new Types.ObjectId().toString();
      await enter(t, sid, { weakLoCodes: ["LO-C1-MATH-01-01"] });
      await ClassTestResult.updateOne({ testId: new Types.ObjectId(t) }, { $set: { publishedAt: new Date() } });
      const [row] = await childTestResults(sid);
      expect(row.weakObjectives).toEqual(["লেবেল 01-01"]);
      expect(row.weakObjectivesWordBn).toBe("শিখনফল");
    };
    await check(); // no enablement row at all
    await MasteryEnablement.collection.insertOne({ academicYearId: new Types.ObjectId(), classToken: "C1", subject: "MATH", enabled: false });
    await check(); // explicitly off
    await MasteryEnablement.deleteMany({});
    await MasteryEnablement.collection.insertOne({ academicYearId: new Types.ObjectId(), classToken: "C1", subject: "MATH", enabled: true });
    await check(); // on
  });
});
