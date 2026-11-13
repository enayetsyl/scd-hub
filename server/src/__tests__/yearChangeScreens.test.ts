/**
 * YC-5 - the Principal's year-change screens over GraphQL (docs/prd-year-change.md section 5).
 *
 *   gates     the Principal passes; Office, a teacher, a guardian and anonymous are denied on EVERY op
 *   setup     the prefill: everyone PROMOTE, the default section shape, Class 6 present, teachers carried
 *   plan      the GraphQL dry run has the same counts as calling planYearChange directly
 *   flow      prepare -> runs list -> cut-over plan -> undo plan -> undo, on in-memory Mongo
 *   refusals  an engine refusal reaches the screen as its Bangla message, an exposable domain error
 *   app       the pure helpers of app/src/lib/yearHandling.ts (SectionContext reset, past-year labels)
 *
 * In-memory Mongo only: the engine is never pointed at a real database.
 */
import mongoose, { Types } from "mongoose";
import { graphql, type ExecutionResult } from "graphql";
import { MongoMemoryServer } from "mongodb-memory-server";
import { builder } from "../schema";
import "../registerResolvers";
import type { AppContext } from "../context";
import { isExposableDomainError } from "../observability/errorMask";
import { isExpectedError } from "../observability/sentry";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { Enrolment } from "../modules/foundation/models/Enrolment";
import { User } from "../modules/foundation/models/User";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { ClassTeacherAssignment } from "../modules/foundation/models/ClassTeacherAssignment";
import { Audit } from "../modules/platform/models/Audit";
import { HomeworkItem } from "../modules/trackers/models/HomeworkItem";
import { ImprovementAction } from "../modules/improvement/models/ImprovementAction";
import { YearChangeRun, planYearChange } from "../modules/year-change";
import { bySchoolId } from "../modules/year-change/setup";
import { cutoverOptions, toPlanInput } from "../modules/year-change/resolvers/yearChange";
import { clearYearChangeFixtures, seedEngineWorld, type EngineWorld } from "./fixtures/yearChange";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  mongoose.set("autoIndex", false);
  await mongoose.connect(mongo.getUri());
  await Promise.all([AcademicYear, Class, Section, Student, Enrolment, YearChangeRun].map((m) => (m as unknown as mongoose.Model<unknown>).init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

let w: EngineWorld;
beforeEach(async () => {
  await clearYearChangeFixtures();
  await Promise.all(
    [User, Guardian, GuardianLink, ClassTeacherAssignment, HomeworkItem, ImprovementAction, YearChangeRun, Audit].map((m) =>
      (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
  w = await seedEngineWorld();
});

const schema = builder.toSchema();
const ctxOf = (role: string | null, userId = new Types.ObjectId().toString()): AppContext =>
  ({ auth: role ? { role, userId } : null }) as unknown as AppContext;
const principalCtx = (): AppContext => ctxOf("PRINCIPAL", w.principal.userId);
const run = (source: string, ctx: AppContext, variableValues?: Record<string, unknown>): Promise<ExecutionResult> =>
  graphql({ schema, source, contextValue: ctx, variableValues }) as Promise<ExecutionResult>;

const planInput = () => ({
  fromYearId: w.years.y2026.toString(),
  toYearId: w.years.y2027.toString(),
  promotions: w.promotions,
  admissions: w.admissions,
});

const SETUP = `query { yearChangeSetup { fromYearId toYearId years { id label current }
  classes { level sections { code classTeacherId } }
  children { studentId schoolId name level sectionCode decision }
  teachers { id name }
  classPlan { level sections }
  classTeachers { level sectionCode teacherId } } }`;
const PLAN = `query($input: YearChangePlanInput!) { yearChangePlan(input: $input) {
  runId refusals warnings printText
  counts { classesToCreate sectionsToCreate enrolmentsToCreate promoted repeaters left admissionsToCreate classTeachersToSet }
  classes { level total sections { code children } } } }`;
const PREPARE = `mutation($input: YearChangePlanInput!) { applyYearChangePrepare(input: $input) { runId total } }`;
const CUT_PLAN = `query($runId: String!) { yearChangeCutoverPlan(runId: $runId) { runId status refusals printText promoted repeated left admitted } }`;
const UNDO_PLAN = `query($runId: String!, $kind: YearChangeUndoKind!) { yearChangeUndoPlan(runId: $runId, kind: $kind) { kind runId refusals counts { key value } printText } }`;
const RUNS = `query { yearChangeRuns { runId status fromLabel toLabel } }`;
const CUT = `mutation($runId: String!) { applyYearChangeCutover(runId: $runId) { runId total } }`;
const UNDO = `mutation($runId: String!, $kind: YearChangeUndoKind!) { undoYearChange(runId: $runId, kind: $kind) { runId total } }`;

describe("YC-5: gates (every op)", () => {
  const ops = (): Array<[string, string, Record<string, unknown>]> => [
    ["yearChangeSetup", SETUP, {}],
    ["yearChangePlan", PLAN, { input: planInput() }],
    ["yearChangeCutoverPlan", CUT_PLAN, { runId: "x" }],
    ["yearChangeUndoPlan", UNDO_PLAN, { runId: "x", kind: "PREPARE" }],
    ["yearChangeRuns", RUNS, {}],
    ["applyYearChangePrepare", PREPARE, { input: planInput() }],
    ["applyYearChangeCutover", CUT, { runId: "x" }],
    ["undoYearChange", UNDO, { runId: "x", kind: "PREPARE" }],
  ];

  it.each(["OFFICE", "TEACHER", "GUARDIAN", null])("denies %s on every operation and writes nothing", async (role) => {
    for (const [name, source, vars] of ops()) {
      const r = await run(source, ctxOf(role), vars);
      expect(r.errors?.length ?? 0).toBeGreaterThan(0);
      expect((r.data as Record<string, unknown> | null | undefined)?.[name] ?? null).toBeNull();
    }
    expect(await YearChangeRun.countDocuments()).toBe(0);
    expect(await Class.countDocuments({ academicYearId: w.years.y2027 })).toBe(0);
  });

  it("lets the Principal through the read fields", async () => {
    for (const [name, source, vars] of ops().slice(0, 2)) {
      const r = await run(source, principalCtx(), vars);
      expect(r.errors).toBeUndefined();
      expect((r.data as Record<string, unknown>)[name]).toBeTruthy();
    }
    const runs = await run(RUNS, principalCtx());
    expect(runs.errors).toBeUndefined();
  });
});

describe("YC-5: setup prefill", () => {
  it("everyone PROMOTE, children by school ID, the default shape, Class 6 present, teachers carried", async () => {
    const r = await run(SETUP, principalCtx());
    expect(r.errors).toBeUndefined();
    const s = (r.data as { yearChangeSetup: any }).yearChangeSetup;
    expect(s.fromYearId).toBe(w.years.y2026.toString()); // the current year
    expect(s.toYearId).toBe(w.years.y2027.toString()); // the next year by start date
    expect(s.years.map((y: { label: string }) => y.label)).toEqual(["2026", "2027", "2029"]);

    expect(s.children.map((c: { schoolId: string }) => c.schoolId)).toEqual(["T-E1", "T-E2", "T-E3", "T-E4", "T-E5", "T-E6", "T-E7"]);
    expect(s.children.every((c: { decision: string }) => c.decision === "PROMOTE")).toBe(true);
    expect(s.children[0]).toMatchObject({ level: 2, sectionCode: "Main" });

    const shape = Object.fromEntries(s.classPlan.map((c: { level: number; sections: string[] }) => [c.level, c.sections]));
    expect(shape[2]).toEqual(["Main"]);
    expect(shape[3]).toEqual(["Boys", "Girls"]);
    expect(shape[6]).toEqual(["Boys", "Girls"]); // Class 6 is there although 2026 has no Class 6 row
    // the fixture has two Class-5 rows (Boys and Girls); the plan is per level
    expect([...new Set(s.classes.map((c: { level: number }) => c.level))]).toEqual([2, 4, 5]);

    // the 2026 C4 Boys teacher is the prefill for 2027 C4 Boys
    expect(s.classTeachers).toEqual([{ level: 4, sectionCode: "Boys", teacherId: w.teacher4.toString() }]);
    expect(s.teachers.map((t: { name: string }) => t.name)).toEqual(["Test Teacher Four", "Test Teacher Other"]);
  });

  it("a child already in the top class defaults to LEFT (there is no class after it)", async () => {
    const classId = (await Class.create({ level: 6, nameBn: "Class 6 (2026)", academicYearId: w.years.y2026 }))._id;
    const sectionId = (await Section.create({ classId, code: "Boys", nameBn: "বালক", active: true }))._id;
    await Student.create({ schoolId: "T-E8", name: "Top Class Child", gender: "male", classId, sectionId, active: true });
    const r = await run(SETUP, principalCtx());
    const kids = (r.data as { yearChangeSetup: any }).yearChangeSetup.children as Array<{ schoolId: string; decision: string }>;
    expect(kids.find((c) => c.schoolId === "T-E8")!.decision).toBe("LEFT");
    expect(kids.find((c) => c.schoolId === "T-E1")!.decision).toBe("PROMOTE");
  });

  it("orders school IDs numerically", () => {
    expect(["103", "0059", "20", "T-B"].sort(bySchoolId)).toEqual(["20", "0059", "103", "T-B"]);
  });
});

describe("YC-5: the dry run over GraphQL", () => {
  it("has the same counts as calling planYearChange directly, and writes nothing", async () => {
    const direct = await planYearChange(planInput());
    const r = await run(PLAN, principalCtx(), { input: planInput() });
    expect(r.errors).toBeUndefined();
    const p = (r.data as { yearChangePlan: any }).yearChangePlan;
    expect(p.counts).toEqual({
      classesToCreate: direct.counts.classesToCreate,
      sectionsToCreate: direct.counts.sectionsToCreate,
      enrolmentsToCreate: direct.counts.enrolmentsToCreate,
      promoted: direct.counts.promoted,
      repeaters: direct.counts.repeaters,
      left: direct.counts.left,
      admissionsToCreate: direct.counts.admissionsToCreate,
      classTeachersToSet: direct.counts.classTeachersToSet,
    });
    expect(p.classes.map((c: { level: number; total: number }) => [c.level, c.total])).toEqual(direct.classes.map((c) => [c.level, c.total]));
    expect(p.refusals).toEqual([]);
    expect(p.printText).toContain("শিক্ষাবর্ষ পরিবর্তন");
    expect(p.counts).toMatchObject({ promoted: 4, repeaters: 1, left: 2, admissionsToCreate: 2 });
    expect(await YearChangeRun.countDocuments()).toBe(0);
    expect(await Class.countDocuments({ academicYearId: w.years.y2027 })).toBe(0);
  });

  it("carries the engine's refusals (a wrong section pick) as text, not as an error", async () => {
    const r = await run(PLAN, principalCtx(), {
      input: { ...planInput(), promotions: [{ studentId: w.c2Up.toString(), decision: "PROMOTE", toSectionCode: "Main" }] },
    });
    expect(r.errors).toBeUndefined();
    expect((r.data as { yearChangePlan: any }).yearChangePlan.refusals.length).toBeGreaterThan(0);
  });
});

describe("YC-5: prepare -> cut-over plan -> undo, on in-memory Mongo", () => {
  it("runs the whole flow through the resolvers", async () => {
    const prep = await run(PREPARE, principalCtx(), { input: planInput() });
    expect(prep.errors).toBeUndefined();
    const { runId, total } = (prep.data as { applyYearChangePrepare: { runId: string; total: number } }).applyYearChangePrepare;
    expect(runId).toMatch(/^yc-/);
    expect(total).toBeGreaterThan(0);
    expect(await Enrolment.countDocuments({ runId, status: "PLANNED" })).toBe(7);

    // a second prepare of the same year pair re-uses the run and writes nothing new
    const again = await run(PREPARE, principalCtx(), { input: planInput() });
    expect(again.errors).toBeUndefined();
    expect((again.data as { applyYearChangePrepare: { runId: string; total: number } }).applyYearChangePrepare).toEqual({ runId, total: 0 });

    const runs = await run(RUNS, principalCtx());
    expect((runs.data as { yearChangeRuns: any[] }).yearChangeRuns).toEqual([{ runId, status: "PREPARED", fromLabel: "2026", toLabel: "2027" }]);

    const cut = await run(CUT_PLAN, principalCtx(), { runId });
    expect(cut.errors).toBeUndefined();
    const cp = (cut.data as { yearChangeCutoverPlan: any }).yearChangeCutoverPlan;
    // while the plan is refused (too early) the engine counts nobody as promoted or repeating
    expect(cp).toMatchObject({ runId, status: "PREPARED", promoted: 0, repeated: 0, left: 2, admitted: 2 });
    // today is long before 31 Dec 2026: the dry run says so in red
    expect(cp.refusals.join(" ")).toContain("উত্তরণ");
    expect(cp.printText).toContain(runId);

    const undoPlan = await run(UNDO_PLAN, principalCtx(), { runId, kind: "PREPARE" });
    expect(undoPlan.errors).toBeUndefined();
    const up = (undoPlan.data as { yearChangeUndoPlan: any }).yearChangeUndoPlan;
    expect(up.kind).toBe("PREPARE");
    expect(up.refusals).toEqual([]);
    expect(Object.fromEntries(up.counts.map((c: { key: string; value: number }) => [c.key, c.value]))).toMatchObject({ enrolments: 7, admissions: 2 });

    const undone = await run(UNDO, principalCtx(), { runId, kind: "PREPARE" });
    expect(undone.errors).toBeUndefined();
    expect(await Enrolment.countDocuments({ runId })).toBe(0);
    expect(await YearChangeRun.countDocuments({ runId })).toBe(0);
    expect(await Class.countDocuments({ runId })).toBe(0);
  });
});

describe("YC-5: an engine refusal arrives as its Bangla message", () => {
  it("applyYearChangeCutover before the last day: a Bangla sentence, an exposable domain error", async () => {
    const prep = await run(PREPARE, principalCtx(), { input: planInput() });
    const runId = (prep.data as { applyYearChangePrepare: { runId: string } }).applyYearChangePrepare.runId;
    const r = await run(CUT, principalCtx(), { runId });
    expect(r.errors).toHaveLength(1);
    const e = r.errors![0];
    expect(e.message).toContain("উত্তরণ");
    expect(e.message).not.toMatch(/unexpected error/i);
    // the server masks any error that is not a registered domain class: this one must pass through
    const original = e.originalError as Error;
    expect(isExposableDomainError(original)).toBe(true);
    expect(isExpectedError(original)).toBe(true); // and never pages GlitchTip
    expect(await Student.countDocuments({ active: true })).toBe(7); // nothing moved
  });

  it("preparing with a refusing plan names the reason in Bangla", async () => {
    const r = await run(PREPARE, principalCtx(), {
      input: { ...planInput(), admissions: [{ schoolId: "T-E1", name: "Clash", gender: "male", level: 6, guardianPhone: "01800000009" }] },
    });
    expect(r.errors).toHaveLength(1);
    expect(r.errors![0].message).toContain("আইডি");
    expect(isExposableDomainError(r.errors![0].originalError as Error)).toBe(true);
    expect(await YearChangeRun.countDocuments()).toBe(0);
  });
});

describe("YC-5 review: a prepared run is re-opened, not overwritten", () => {
  const SETUP_RUN = `query { yearChangeSetup { preparedRunId copy { key value }
    children { schoolId decision toSectionCode }
    admissions { schoolId level sectionCode guardianPhone }
    classPlan { level sections } classTeachers { level sectionCode teacherId } } }`;
  const prep = async (input: unknown) => run(PREPARE, principalCtx(), { input });

  it("setup after a prepare returns the run's own decisions, admissions, shapes, teachers and copy options", async () => {
    const input = { ...planInput(), copy: { routine: false }, classPlan: [{ level: 6, sections: ["Girls"] }], classTeachers: [{ level: 4, sectionCode: "Boys", teacherId: w.teacherOther.toString() }] };
    expect((await prep(input)).errors).toBeUndefined();
    const s = ((await run(SETUP_RUN, principalCtx())).data as { yearChangeSetup: any }).yearChangeSetup;
    expect(s.preparedRunId).toMatch(/^yc-/);
    const by = Object.fromEntries(s.children.map((c: { schoolId: string }) => [c.schoolId, c]));
    expect(by["T-E2"]).toMatchObject({ decision: "REPEAT", toSectionCode: "Main" }); // the C2 repeater
    expect(by["T-E1"]).toMatchObject({ decision: "PROMOTE", toSectionCode: "Boys" });
    expect(by["T-E4"].decision).toBe("LEFT");
    expect(by["T-E7"].decision).toBe("LEFT");
    expect(s.admissions.map((a: { schoolId: string }) => a.schoolId)).toEqual(["T-A1", "T-A2"]);
    expect(s.admissions[0]).toMatchObject({ level: 6, guardianPhone: "01800000001" });
    expect(s.classPlan.find((c: { level: number }) => c.level === 6).sections).toEqual(["Girls"]);
    expect(s.classTeachers).toContainEqual({ level: 4, sectionCode: "Boys", teacherId: w.teacherOther.toString() });
    expect(Object.fromEntries(s.copy.map((f: { key: string; value: boolean }) => [f.key, f.value])).routine).toBe(false);
  });

  it("re-preparing with changed decisions reconciles, and the dry run lists what it deletes", async () => {
    expect((await prep(planInput())).errors).toBeUndefined();
    const changed = {
      ...planInput(),
      promotions: [...w.promotions, { studentId: w.c2Up.toString(), decision: "LEFT" }],
      admissions: [w.admissions[0]],
    };
    const dry = await run(
      `query($input: YearChangePlanInput!) { yearChangePlan(input: $input) { counts { enrolmentsToRemove admissionsToRemove } removeEnrolments { schoolId reason } removeAdmissions { schoolId } refusals } }`,
      principalCtx(),
      { input: changed },
    );
    expect(dry.errors).toBeUndefined();
    const p = (dry.data as { yearChangePlan: any }).yearChangePlan;
    expect(p.counts).toMatchObject({ enrolmentsToRemove: 1, admissionsToRemove: 1 });
    expect(p.removeAdmissions).toEqual([{ schoolId: "T-A2" }]);
    expect(p.removeEnrolments.map((r: { schoolId: string }) => r.schoolId)).toEqual(["T-E1"]);

    expect((await prep(changed)).errors).toBeUndefined();
    expect(await Enrolment.countDocuments({ academicYearId: w.years.y2027, status: "PLANNED" })).toBe(5);
    expect(await Student.countDocuments({ schoolId: "T-A2" })).toBe(0);
  });

  it("applying the setup's own list back changes nothing", async () => {
    expect((await prep(planInput())).errors).toBeUndefined();
    const s = ((await run(SETUP_RUN, principalCtx())).data as { yearChangeSetup: any }).yearChangeSetup;
    const ids: Record<string, string> = { "T-E1": w.c2Up, "T-E2": w.c2Repeat, "T-E3": w.c4Up, "T-E4": w.c4Leaver, "T-E5": w.c5Girl, "T-E6": w.c5Boy, "T-E7": w.c5Leaver } as never;
    const again = {
      ...planInput(),
      promotions: s.children.map((c: any) => ({ studentId: String(ids[c.schoolId]), decision: c.decision, toSectionCode: c.toSectionCode ?? undefined })),
    };
    const r = await run(PREPARE, principalCtx(), { input: again });
    expect(r.errors).toBeUndefined();
    expect((r.data as any).applyYearChangePrepare.total).toBe(0);
    expect(await Enrolment.countDocuments({ academicYearId: w.years.y2027, status: "PLANNED" })).toBe(7);
  });
});

describe("YC-5 review: teacher prefill, explicit years, input nulls, dev rehearsal", () => {
  it("prefills only an active TEACHER: an inactive or re-roled past class teacher is dropped", async () => {
    await Section.updateOne({ _id: w.c2Main.sectionId }, { $set: { classTeacherId: w.teacherOther } });
    let s = ((await run(SETUP, principalCtx())).data as { yearChangeSetup: any }).yearChangeSetup;
    expect(s.classTeachers).toEqual(
      expect.arrayContaining([
        { level: 2, sectionCode: "Main", teacherId: w.teacherOther.toString() },
        { level: 4, sectionCode: "Boys", teacherId: w.teacher4.toString() },
      ]),
    );
    await User.updateOne({ _id: w.teacher4 }, { $set: { active: false } }); // left the school
    await User.updateOne({ _id: w.teacherOther }, { $set: { role: "OFFICE" } }); // no longer a teacher
    s = ((await run(SETUP, principalCtx())).data as { yearChangeSetup: any }).yearChangeSetup;
    expect(s.classTeachers).toEqual([]);
    expect(s.teachers).toEqual([]);
  });

  it("setup honours explicit from/to years and falls back for an unknown from", async () => {
    const q = `query($f: String, $t: String) { yearChangeSetup(fromYearId: $f, toYearId: $t) { fromYearId toYearId } }`;
    const a = await run(q, principalCtx(), { f: w.years.y2026.toString(), t: w.years.y2029.toString() });
    expect((a.data as any).yearChangeSetup).toEqual({ fromYearId: w.years.y2026.toString(), toYearId: w.years.y2029.toString() });
    const b = await run(q, principalCtx(), { f: new Types.ObjectId().toString(), t: null });
    expect((b.data as any).yearChangeSetup).toEqual({ fromYearId: w.years.y2026.toString(), toYearId: w.years.y2027.toString() });
  });

  it("toPlanInput turns GraphQL nulls into absent keys and keeps a null teacher", () => {
    const out = toPlanInput({
      fromYearId: "a",
      toYearId: "b",
      copy: { routine: null, mastery: false },
      promotions: [{ studentId: "s", decision: "PROMOTE", toSectionCode: null }],
      classTeachers: [{ level: 4, sectionCode: "Boys", teacherId: null }],
      admissions: [{ schoolId: "x", name: "n", nameBn: null, gender: "male", level: 1, sectionCode: null, guardianPhone: "0" }],
    } as never);
    expect(out.copy).toEqual({ mastery: false });
    expect(out.promotions![0]).toEqual({ studentId: "s", decision: "PROMOTE" });
    expect(out.classTeachers![0].teacherId).toBeNull();
    expect(out.admissions![0]).not.toHaveProperty("nameBn");
    expect(out.admissions![0]).not.toHaveProperty("sectionCode");
  });

  it("the cut-over is refused without YEAR_CHANGE_ALLOW_EARLY and runs with it (dev rehearsal)", async () => {
    const prep = await run(PREPARE, principalCtx(), { input: planInput() });
    const runId = (prep.data as any).applyYearChangePrepare.runId;
    delete process.env.YEAR_CHANGE_ALLOW_EARLY;
    expect(cutoverOptions()).toEqual({});
    expect((await run(CUT, principalCtx(), { runId })).errors).toHaveLength(1);
    process.env.YEAR_CHANGE_ALLOW_EARLY = "1";
    try {
      expect(cutoverOptions()).toEqual({ allowEarly: true });
      const plan = await run(CUT_PLAN, principalCtx(), { runId });
      expect((plan.data as any).yearChangeCutoverPlan.refusals).toEqual([]);
      const r = await run(`mutation($runId: String!) { applyYearChangeCutover(runId: $runId) { total invariantAfter } }`, principalCtx(), { runId });
      expect(r.errors).toBeUndefined();
      expect((r.data as any).applyYearChangeCutover.invariantAfter).toEqual([]);
      expect((await AcademicYear.findOne({ current: true }).lean())!.label).toBe("2027");
    } finally {
      delete process.env.YEAR_CHANGE_ALLOW_EARLY;
    }
  });
});

describe("YC-5: app year handling (pure helpers)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const h = require("../../../app/src/lib/yearHandling") as {
    healSelection: <T extends { academicYearId: string | null; classId: string | null; sectionId: string | null }>(
      sel: T,
      years: ReadonlyArray<{ id: string; current: boolean }>,
      seenCurrentYearId: string | null,
    ) => { academicYearId: string } | null;
    yearOptionLabel: (y: { label: string; current: boolean }, currentLabel: string | null) => string;
    pastYearSuffix: (yearLabel: string | null | undefined, currentLabel: string | null, digits?: (s: string) => string) => string;
    confirmMatchesYear: (typed: string, yearLabel: string) => boolean;
  };
  const years = [
    { id: "y26", current: false },
    { id: "y27", current: true },
  ];
  const RESET = { academicYearId: "y27", classId: null, sectionId: null };
  const pick = (academicYearId: string | null) => ({ academicYearId, classId: academicYearId ? "c1" : null, sectionId: academicYearId ? "s1" : null });

  it("drops a saved pick of a past year once the current year has changed (a teacher with a 2026 pick opens on 2027)", () => {
    expect(h.healSelection(pick("y26"), years, "y26")).toMatchObject(RESET); // the flip happened since the last run
    expect(h.healSelection(pick("y26"), years, null)).toMatchObject(RESET); // an install from before this rule
  });

  it("keeps a pick that is already on the current year, and a deliberate past-year pick made after the flip", () => {
    expect(h.healSelection(pick("y27"), years, "y26")).toBeNull();
    expect(h.healSelection(pick("y27"), years, "y27")).toBeNull();
    expect(h.healSelection(pick("y26"), years, "y27")).toBeNull();
  });

  it("a missing or vanished year becomes the current one (D-#304)", () => {
    expect(h.healSelection(pick(null), years, "y27")).toMatchObject(RESET);
    expect(h.healSelection(pick("gone"), years, "y27")).toMatchObject(RESET);
    expect(h.healSelection(pick(null), [], null)).toBeNull();
  });

  it("labels a past year, and a section of a past year", () => {
    expect(h.yearOptionLabel({ label: "2027", current: true }, "2027")).toBe("2027 ✓");
    expect(h.yearOptionLabel({ label: "2026", current: false }, "2027")).toBe("2026 (গত বছর)");
    expect(h.yearOptionLabel({ label: "2028", current: false }, "2027")).toBe("2028");
    expect(h.pastYearSuffix("2026", "2027")).toBe(" (2026)");
    expect(h.pastYearSuffix("2026", "2027", (x) => x.replace(/2/g, "২"))).toBe(" (২০২৬)".replace("০", "0").replace("৬", "6"));
    expect(h.pastYearSuffix("2027", "2027")).toBe("");
    expect(h.pastYearSuffix(null, "2027")).toBe("");
  });

  it("the typed cut-over confirmation accepts the year in English or Bangla digits", () => {
    expect(h.confirmMatchesYear("২০২৭", "2027")).toBe(true);
    expect(h.confirmMatchesYear(" 2027 ", "2027")).toBe(true);
    expect(h.confirmMatchesYear("২০২৬", "2027")).toBe(false);
    expect(h.confirmMatchesYear("", "2027")).toBe(false);
  });
});
