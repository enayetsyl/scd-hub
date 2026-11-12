/**
 * Year-change resolvers (YC-5, docs/prd-year-change.md section 5): a GraphQL face over the YC-4/YC-6
 * engine for the Principal's "শিক্ষাবর্ষ পরিবর্তন" screen. The engine does the work and its own
 * `year_change:*` check; these fields add the Pothos gate on top (view / prepare / cut_over / undo,
 * Principal only, LOCKED).
 *
 *   yearChangeSetup(from?, to?)       view      prefill for step 1
 *   yearChangePlan(input)             view      the dry run of the prepare (rows + printed text)
 *   yearChangeCutoverPlan(runId)      view      the dry run of the cut-over
 *   yearChangeUndoPlan(runId, kind)   view      the dry run of an undo
 *   yearChangeRuns                    view      past runs
 *   applyYearChangePrepare(input)     prepare   writes the PLANNED rows (engine refusals come back as Bangla text)
 *   applyYearChangeCutover(runId)     cut_over  the cut-over
 *   undoYearChange(runId, kind)       undo      PREPARE = cancel the preparation, CUTOVER = reverse the cut-over
 *
 * The engine's refusals (`YearChangeRefusal`, `ScheduleCopyRefusal`) are registered in EXPECTED_ERROR_NAMES, so
 * their Bangla sentence reaches the screen instead of "Unexpected error".
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import {
  YearChangeRun,
  applyCutover,
  applyPrepare,
  planCutover,
  planUndoCutover,
  planUndoPrepare,
  planYearChange,
  printCutover,
  printPlan,
  printUndo,
  undoCutover,
  undoPrepare,
  type CutoverPlan,
  type PlanInput,
  type SectionCode,
  type UndoPlan,
  type YearChangeActor,
  type YearChangePlan,
} from "../index";
import { assertYearChangeRight } from "../authz";
import { yearChangeSetup, type SetupAdmission, type SetupChild, type SetupClass, type SetupClassPlan, type SetupClassTeacher, type SetupSection, type SetupTeacher, type SetupYear, type YearChangeSetup } from "../setup";

/**
 * Dev rehearsal only (docs/prd-year-change.md): `YEAR_CHANGE_ALLOW_EARLY=1` lets the cut-over run before
 * the last day of the old year. Production never sets it, so the date guard stays.
 */
export const cutoverOptions = (): { allowEarly?: boolean } => (process.env.YEAR_CHANGE_ALLOW_EARLY === "1" ? { allowEarly: true } : {});

function actorOf(ctx: AppContext): YearChangeActor {
  const a = ctx.auth!;
  return { userId: a.userId, role: a.role, additionalTemplates: a.additionalTemplates };
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

const SetupYearRef = builder.objectRef<SetupYear>("YearChangeYear");
SetupYearRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    label: t.exposeString("label"),
    current: t.exposeBoolean("current"),
  }),
});
const SetupSectionRef = builder.objectRef<SetupSection>("YearChangeSetupSection");
SetupSectionRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    code: t.exposeString("code"),
    nameBn: t.exposeString("nameBn"),
    classTeacherId: t.string({ nullable: true, resolve: (s) => s.classTeacherId }),
  }),
});
const SetupClassRef = builder.objectRef<SetupClass>("YearChangeSetupClass");
SetupClassRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    level: t.exposeInt("level"),
    nameBn: t.exposeString("nameBn"),
    sections: t.field({ type: [SetupSectionRef], resolve: (c) => c.sections }),
  }),
});
const SetupChildRef = builder.objectRef<SetupChild>("YearChangeSetupChild");
SetupChildRef.implement({
  description: "An active child of the past year, listed by school ID (no roll numbers, D-#1463).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    schoolId: t.exposeString("schoolId"),
    name: t.exposeString("name"),
    nameBn: t.string({ nullable: true, resolve: (c) => c.nameBn }),
    gender: t.string({ nullable: true, resolve: (c) => c.gender }),
    level: t.exposeInt("level"),
    sectionCode: t.exposeString("sectionCode"),
    decision: t.exposeString("decision"),
    toSectionCode: t.string({ nullable: true, resolve: (c) => c.toSectionCode }),
  }),
});
const SetupAdmissionRef = builder.objectRef<SetupAdmission>("YearChangeSetupAdmission");
SetupAdmissionRef.implement({
  description: "An admission already written by the prepared run.",
  fields: (t) => ({
    schoolId: t.exposeString("schoolId"),
    name: t.exposeString("name"),
    nameBn: t.string({ nullable: true, resolve: (a) => a.nameBn }),
    gender: t.exposeString("gender"),
    level: t.exposeInt("level"),
    sectionCode: t.exposeString("sectionCode"),
    guardianPhone: t.exposeString("guardianPhone"),
  }),
});
const CopyFlagRef = builder.objectRef<{ key: string; value: boolean }>("YearChangeCopyFlag");
CopyFlagRef.implement({ fields: (t) => ({ key: t.exposeString("key"), value: t.exposeBoolean("value") }) });
const SetupTeacherRef = builder.objectRef<SetupTeacher>("YearChangeTeacher");
SetupTeacherRef.implement({
  fields: (t) => ({ id: t.exposeString("id"), name: t.exposeString("name") }),
});
const SetupClassPlanRef = builder.objectRef<SetupClassPlan>("YearChangeSetupClassPlan");
SetupClassPlanRef.implement({
  fields: (t) => ({
    level: t.exposeInt("level"),
    nameBn: t.exposeString("nameBn"),
    sections: t.stringList({ resolve: (c) => c.sections }),
  }),
});
const SetupClassTeacherRef = builder.objectRef<SetupClassTeacher>("YearChangeSetupClassTeacher");
SetupClassTeacherRef.implement({
  fields: (t) => ({
    level: t.exposeInt("level"),
    sectionCode: t.exposeString("sectionCode"),
    teacherId: t.exposeString("teacherId"),
  }),
});
const SetupRef = builder.objectRef<YearChangeSetup>("YearChangeSetup");
SetupRef.implement({
  fields: (t) => ({
    years: t.field({ type: [SetupYearRef], resolve: (s) => s.years }),
    fromYearId: t.string({ nullable: true, resolve: (s) => s.fromYearId }),
    toYearId: t.string({ nullable: true, resolve: (s) => s.toYearId }),
    classes: t.field({ type: [SetupClassRef], resolve: (s) => s.classes }),
    children: t.field({ type: [SetupChildRef], resolve: (s) => s.children }),
    teachers: t.field({ type: [SetupTeacherRef], resolve: (s) => s.teachers }),
    classPlan: t.field({ type: [SetupClassPlanRef], resolve: (s) => s.classPlan }),
    classTeachers: t.field({ type: [SetupClassTeacherRef], resolve: (s) => s.classTeachers }),
    preparedRunId: t.string({ nullable: true, resolve: (s) => s.preparedRunId }),
    admissions: t.field({ type: [SetupAdmissionRef], resolve: (s) => s.admissions }),
    copy: t.field({ type: [CopyFlagRef], nullable: true, resolve: (s) => (s.copy ? Object.entries(s.copy).map(([key, value]) => ({ key, value })) : null) }),
  }),
});

type PlanClass = YearChangePlan["classes"][number];
type PlanSection = PlanClass["sections"][number];
type PlanEnrolment = YearChangePlan["enrolments"][number];
type PlanLeaver = YearChangePlan["leavers"][number];
type PlanAdmission = YearChangePlan["admissions"][number];
type PlanTeacher = YearChangePlan["classTeachers"][number];
type PlanCounts = YearChangePlan["counts"];

const PlanSectionRef = builder.objectRef<PlanSection>("YearChangePlanSection");
PlanSectionRef.implement({
  fields: (t) => ({
    code: t.exposeString("code"),
    nameBn: t.exposeString("nameBn"),
    existingId: t.string({ nullable: true, resolve: (s) => s.existingId }),
    children: t.exposeInt("children"),
  }),
});
const PlanClassRef = builder.objectRef<PlanClass>("YearChangePlanClass");
PlanClassRef.implement({
  fields: (t) => ({
    level: t.exposeInt("level"),
    nameBn: t.exposeString("nameBn"),
    existingId: t.string({ nullable: true, resolve: (c) => c.existingId }),
    sections: t.field({ type: [PlanSectionRef], resolve: (c) => c.sections }),
    promotedIn: t.exposeInt("promotedIn"),
    repeaters: t.exposeInt("repeaters"),
    admissions: t.exposeInt("admissions"),
    total: t.exposeInt("total"),
    left: t.exposeInt("left"),
  }),
});
const PlanEnrolmentRef = builder.objectRef<PlanEnrolment>("YearChangePlanEnrolment");
PlanEnrolmentRef.implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    schoolId: t.exposeString("schoolId"),
    name: t.exposeString("name"),
    fromLevel: t.exposeInt("fromLevel"),
    fromSectionCode: t.exposeString("fromSectionCode"),
    outcome: t.exposeString("outcome"),
    toLevel: t.exposeInt("toLevel"),
    toSectionCode: t.exposeString("toSectionCode"),
    exists: t.exposeBoolean("exists"),
    update: t.exposeBoolean("update"),
  }),
});
const PlanLeaverRef = builder.objectRef<PlanLeaver>("YearChangePlanLeaver");
PlanLeaverRef.implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    schoolId: t.exposeString("schoolId"),
    name: t.exposeString("name"),
    fromLevel: t.exposeInt("fromLevel"),
    fromSectionCode: t.exposeString("fromSectionCode"),
  }),
});
const PlanAdmissionRef = builder.objectRef<PlanAdmission>("YearChangePlanAdmission");
PlanAdmissionRef.implement({
  fields: (t) => ({
    schoolId: t.exposeString("schoolId"),
    name: t.exposeString("name"),
    nameBn: t.string({ nullable: true, resolve: (a) => a.nameBn ?? null }),
    gender: t.exposeString("gender"),
    toLevel: t.exposeInt("toLevel"),
    toSectionCode: t.exposeString("toSectionCode"),
    guardianPhone: t.exposeString("guardianPhone"),
    exists: t.exposeBoolean("exists"),
    changed: t.exposeBoolean("changed"),
  }),
});
const PlanTeacherRef = builder.objectRef<PlanTeacher>("YearChangePlanTeacher");
PlanTeacherRef.implement({
  fields: (t) => ({
    level: t.exposeInt("level"),
    sectionCode: t.exposeString("sectionCode"),
    teacherId: t.exposeString("teacherId"),
    source: t.exposeString("source"),
    alreadySet: t.exposeBoolean("alreadySet"),
  }),
});
const PlanCountsRef = builder.objectRef<PlanCounts>("YearChangePlanCounts");
PlanCountsRef.implement({
  fields: (t) => ({
    classesToCreate: t.exposeInt("classesToCreate"),
    sectionsToCreate: t.exposeInt("sectionsToCreate"),
    enrolmentsToCreate: t.exposeInt("enrolmentsToCreate"),
    enrolmentsExisting: t.exposeInt("enrolmentsExisting"),
    promoted: t.exposeInt("promoted"),
    repeaters: t.exposeInt("repeaters"),
    left: t.exposeInt("left"),
    admissionsToCreate: t.exposeInt("admissionsToCreate"),
    admissionsExisting: t.exposeInt("admissionsExisting"),
    classTeachersToSet: t.exposeInt("classTeachersToSet"),
    enrolmentsToUpdate: t.exposeInt("enrolmentsToUpdate"),
    enrolmentsToRemove: t.exposeInt("enrolmentsToRemove"),
    admissionsToUpdate: t.exposeInt("admissionsToUpdate"),
    admissionsToRemove: t.exposeInt("admissionsToRemove"),
  }),
});

type PlanRemoval = { studentId: string; schoolId: string; reason?: string };
const PlanRemovalRef = builder.objectRef<PlanRemoval>("YearChangePlanRemoval");
PlanRemovalRef.implement({
  description: "A row of the prepared run the new plan no longer contains (the apply deletes it).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    schoolId: t.exposeString("schoolId"),
    reason: t.string({ nullable: true, resolve: (r) => r.reason ?? null }),
  }),
});

interface PlanView {
  plan: YearChangePlan;
  printText: string;
}
const PlanViewRef = builder.objectRef<PlanView>("YearChangePlan");
PlanViewRef.implement({
  description: "The prepare dry run: the engine's plan rows plus the printed Bangla text.",
  fields: (t) => ({
    fromLabel: t.string({ resolve: (v) => v.plan.fromLabel }),
    toLabel: t.string({ resolve: (v) => v.plan.toLabel }),
    startKey: t.string({ resolve: (v) => v.plan.startKey }),
    closeKey: t.string({ resolve: (v) => v.plan.closeKey }),
    runId: t.string({ nullable: true, resolve: (v) => v.plan.runId }),
    classes: t.field({ type: [PlanClassRef], resolve: (v) => v.plan.classes }),
    enrolments: t.field({ type: [PlanEnrolmentRef], resolve: (v) => v.plan.enrolments }),
    leavers: t.field({ type: [PlanLeaverRef], resolve: (v) => v.plan.leavers }),
    admissions: t.field({ type: [PlanAdmissionRef], resolve: (v) => v.plan.admissions }),
    classTeachers: t.field({ type: [PlanTeacherRef], resolve: (v) => v.plan.classTeachers }),
    counts: t.field({ type: PlanCountsRef, resolve: (v) => v.plan.counts }),
    removeEnrolments: t.field({ type: [PlanRemovalRef], resolve: (v) => v.plan.reconcile.removeEnrolments }),
    removeAdmissions: t.field({ type: [PlanRemovalRef], resolve: (v) => v.plan.reconcile.removeAdmissions }),
    refusals: t.stringList({ resolve: (v) => v.plan.refusals }),
    warnings: t.stringList({ resolve: (v) => v.plan.warnings }),
    printText: t.exposeString("printText"),
  }),
});

type CutoverChild = CutoverPlan["children"][number];
const CutoverChildRef = builder.objectRef<CutoverChild>("YearChangeCutoverChild");
CutoverChildRef.implement({
  fields: (t) => ({
    schoolId: t.exposeString("schoolId"),
    name: t.exposeString("name"),
    fromLevel: t.int({ nullable: true, resolve: (c) => c.fromLevel }),
    fromCode: t.string({ nullable: true, resolve: (c) => c.fromCode }),
    toLevel: t.int({ nullable: true, resolve: (c) => c.toLevel }),
    toCode: t.string({ nullable: true, resolve: (c) => c.toCode }),
    outcome: t.exposeString("outcome"),
  }),
});
interface CutoverView {
  plan: CutoverPlan;
  printText: string;
}
const CutoverViewRef = builder.objectRef<CutoverView>("YearChangeCutoverPlan");
CutoverViewRef.implement({
  description: "The cut-over dry run for a prepared run.",
  fields: (t) => ({
    runId: t.string({ resolve: (v) => v.plan.runId }),
    status: t.string({ resolve: (v) => v.plan.status }),
    fromLabel: t.string({ resolve: (v) => v.plan.fromLabel }),
    toLabel: t.string({ resolve: (v) => v.plan.toLabel }),
    startKey: t.string({ resolve: (v) => v.plan.startKey }),
    closeKey: t.string({ resolve: (v) => v.plan.closeKey }),
    promoted: t.int({ resolve: (v) => v.plan.promoted }),
    repeated: t.int({ resolve: (v) => v.plan.repeated }),
    left: t.int({ resolve: (v) => v.plan.left }),
    activating: t.int({ resolve: (v) => v.plan.activating }),
    admitted: t.int({ resolve: (v) => v.plan.admitted }),
    studentsChanged: t.int({ resolve: (v) => v.plan.studentsChanged }),
    scholarshipCleared: t.int({ resolve: (v) => v.plan.scholarshipCleared }),
    improvementToEnd: t.int({ resolve: (v) => v.plan.improvementToEnd }),
    copyLines: t.stringList({ resolve: (v) => v.plan.copy.lines }),
    children: t.field({ type: [CutoverChildRef], resolve: (v) => v.plan.children }),
    refusals: t.stringList({ resolve: (v) => v.plan.refusals }),
    printText: t.exposeString("printText"),
  }),
});

const UndoCountRef = builder.objectRef<{ key: string; value: number }>("YearChangeUndoCount");
UndoCountRef.implement({ fields: (t) => ({ key: t.exposeString("key"), value: t.exposeInt("value") }) });
interface UndoView {
  plan: UndoPlan;
  printText: string;
}
const UndoViewRef = builder.objectRef<UndoView>("YearChangeUndoPlan");
UndoViewRef.implement({
  description: "An undo dry run (cancel the preparation, or reverse the cut-over).",
  fields: (t) => ({
    kind: t.string({ resolve: (v) => v.plan.kind }),
    runId: t.string({ resolve: (v) => v.plan.runId }),
    counts: t.field({ type: [UndoCountRef], resolve: (v) => Object.entries(v.plan.counts).map(([key, value]) => ({ key, value })) }),
    changedAfter: t.stringList({ resolve: (v) => v.plan.changedAfter ?? [] }),
    createdAfter: t.stringList({ resolve: (v) => v.plan.createdAfter ?? [] }),
    notes: t.stringList({ resolve: (v) => v.plan.notes }),
    refusals: t.stringList({ resolve: (v) => v.plan.refusals }),
    printText: t.exposeString("printText"),
  }),
});

interface RunView {
  runId: string;
  fromYearId: string;
  toYearId: string;
  fromLabel: string;
  toLabel: string;
  status: string;
  createdAt: string;
  cutOverAt: string | null;
}
const RunRef = builder.objectRef<RunView>("YearChangeRunRow");
RunRef.implement({
  fields: (t) => ({
    runId: t.exposeString("runId"),
    fromYearId: t.exposeString("fromYearId"),
    toYearId: t.exposeString("toYearId"),
    fromLabel: t.exposeString("fromLabel"),
    toLabel: t.exposeString("toLabel"),
    // PREPARED | CUTTING_OVER | CUT_OVER
    status: t.exposeString("status"),
    createdAt: t.exposeString("createdAt"),
    cutOverAt: t.string({ nullable: true, resolve: (r) => r.cutOverAt }),
  }),
});

const WriteResultRef = builder.objectRef<{ runId: string; total: number; invariantAfter?: string[] }>("YearChangeWriteResult");
WriteResultRef.implement({
  fields: (t) => ({
    runId: t.exposeString("runId"),
    total: t.exposeInt("total"),
    /** Cut-over only: invariant violations found AFTER the run (empty = clean). */
    invariantAfter: t.stringList({ resolve: (r) => r.invariantAfter ?? [] }),
  }),
});

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

const CopyOptionsInput = builder.inputType("YearChangeCopyOptionsInput", {
  fields: (t) => ({
    routine: t.boolean({ required: false }),
    bellWindows: t.boolean({ required: false }),
    assignmentSchedule: t.boolean({ required: false }),
    grants: t.boolean({ required: false }),
    mastery: t.boolean({ required: false }),
  }),
});
const ClassPlanInputType = builder.inputType("YearChangeClassPlanInput", {
  fields: (t) => ({ level: t.int({ required: true }), sections: t.stringList({ required: true }) }),
});
const PromotionInputType = builder.inputType("YearChangePromotionInput", {
  fields: (t) => ({
    studentId: t.string({ required: true }),
    decision: t.string({ required: true, description: "PROMOTE | REPEAT | LEFT" }),
    toSectionCode: t.string({ required: false }),
  }),
});
const AdmissionInputType = builder.inputType("YearChangeAdmissionInput", {
  fields: (t) => ({
    schoolId: t.string({ required: true }),
    name: t.string({ required: true }),
    nameBn: t.string({ required: false }),
    gender: t.string({ required: true }),
    level: t.int({ required: true }),
    sectionCode: t.string({ required: false }),
    guardianPhone: t.string({ required: true }),
  }),
});
const ClassTeacherInputType = builder.inputType("YearChangeClassTeacherInput", {
  fields: (t) => ({
    level: t.int({ required: true }),
    sectionCode: t.string({ required: true }),
    teacherId: t.string({ required: false }),
  }),
});
const PlanInputType = builder.inputType("YearChangePlanInput", {
  fields: (t) => ({
    fromYearId: t.string({ required: true }),
    toYearId: t.string({ required: true }),
    copy: t.field({ type: CopyOptionsInput, required: false }),
    classPlan: t.field({ type: [ClassPlanInputType], required: false }),
    promotions: t.field({ type: [PromotionInputType], required: false }),
    admissions: t.field({ type: [AdmissionInputType], required: false }),
    classTeachers: t.field({ type: [ClassTeacherInputType], required: false }),
  }),
});

const UndoKindEnum = builder.enumType("YearChangeUndoKind", { values: ["PREPARE", "CUTOVER"] as const });

type PlanInputArg = typeof PlanInputType.$inferInput;

/** GraphQL nulls become absent keys - the engine tells "absent" from "given" with `undefined`. */
export function toPlanInput(i: PlanInputArg): PlanInput {
  const copy = i.copy
    ? Object.fromEntries(Object.entries(i.copy).filter(([, v]) => v !== null && v !== undefined))
    : undefined;
  return {
    fromYearId: i.fromYearId,
    toYearId: i.toYearId,
    ...(copy ? { copy } : {}),
    ...(i.classPlan ? { classPlan: i.classPlan.map((c) => ({ level: c.level, sections: c.sections as SectionCode[] })) } : {}),
    ...(i.promotions
      ? {
          promotions: i.promotions.map((p) => ({
            studentId: p.studentId,
            decision: p.decision as "PROMOTE" | "REPEAT" | "LEFT",
            ...(p.toSectionCode ? { toSectionCode: p.toSectionCode as "Main" | "Boys" | "Girls" } : {}),
          })),
        }
      : {}),
    ...(i.admissions
      ? {
          admissions: i.admissions.map((a) => ({
            schoolId: a.schoolId,
            name: a.name,
            ...(a.nameBn ? { nameBn: a.nameBn } : {}),
            gender: a.gender as "male" | "female" | "other",
            level: a.level,
            ...(a.sectionCode ? { sectionCode: a.sectionCode as "Main" | "Boys" | "Girls" } : {}),
            guardianPhone: a.guardianPhone,
          })),
        }
      : {}),
    ...(i.classTeachers
      ? { classTeachers: i.classTeachers.map((c) => ({ level: c.level, sectionCode: c.sectionCode as "Main" | "Boys" | "Girls", teacherId: c.teacherId ?? null })) }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("yearChangeSetup", (t) =>
  t.field({
    type: SetupRef,
    authScopes: { hasPermission: "year_change:view" },
    args: { fromYearId: t.arg.string({ required: false }), toYearId: t.arg.string({ required: false }) },
    resolve: (_r, a, ctx) => {
      assertYearChangeRight(actorOf(ctx), "view");
      return yearChangeSetup(a.fromYearId, a.toYearId);
    },
  }),
);

builder.queryField("yearChangePlan", (t) =>
  t.field({
    type: PlanViewRef,
    authScopes: { hasPermission: "year_change:view" },
    args: { input: t.arg({ type: PlanInputType, required: true }) },
    resolve: async (_r, a, ctx) => {
      assertYearChangeRight(actorOf(ctx), "view");
      const plan = await planYearChange(toPlanInput(a.input));
      return { plan, printText: printPlan(plan) };
    },
  }),
);

builder.queryField("yearChangeCutoverPlan", (t) =>
  t.field({
    type: CutoverViewRef,
    authScopes: { hasPermission: "year_change:view" },
    args: { runId: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      const plan = await planCutover(a.runId, actorOf(ctx), cutoverOptions());
      return { plan, printText: printCutover(plan) };
    },
  }),
);

builder.queryField("yearChangeUndoPlan", (t) =>
  t.field({
    type: UndoViewRef,
    authScopes: { hasPermission: "year_change:view" },
    args: { runId: t.arg.string({ required: true }), kind: t.arg({ type: UndoKindEnum, required: true }) },
    resolve: async (_r, a, ctx) => {
      const actor = actorOf(ctx);
      const plan = a.kind === "PREPARE" ? await planUndoPrepare(a.runId, actor) : await planUndoCutover(a.runId, actor);
      return { plan, printText: printUndo(plan) };
    },
  }),
);

builder.queryField("yearChangeRuns", (t) =>
  t.field({
    type: [RunRef],
    authScopes: { hasPermission: "year_change:view" },
    resolve: async (_r, _a, ctx) => {
      assertYearChangeRight(actorOf(ctx), "view");
      const runs = await YearChangeRun.find({}).sort({ createdAt: -1 }).lean();
      const years = await AcademicYear.find({}).select("label").lean();
      const label = new Map(years.map((y) => [String(y._id), y.label]));
      return runs.map((r) => ({
        runId: r.runId,
        fromYearId: String(r.fromYearId),
        toYearId: String(r.toYearId),
        fromLabel: label.get(String(r.fromYearId)) ?? "",
        toLabel: label.get(String(r.toYearId)) ?? "",
        status: r.status,
        createdAt: new Date(r.createdAt).toISOString(),
        cutOverAt: r.cutOverAt ? new Date(r.cutOverAt).toISOString() : null,
      }));
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationField("applyYearChangePrepare", (t) =>
  t.field({
    type: WriteResultRef,
    authScopes: { hasPermission: "year_change:prepare" },
    args: { input: t.arg({ type: PlanInputType, required: true }) },
    resolve: async (_r, a, ctx) => {
      const actor = actorOf(ctx);
      assertYearChangeRight(actor, "prepare");
      const plan = await planYearChange(toPlanInput(a.input));
      // One prepared run per year pair: re-use its id, else make a fresh one.
      const runId = plan.runId ?? `yc-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12)}`;
      const r = await applyPrepare(plan, runId, actor);
      return { runId, total: r.total };
    },
  }),
);

builder.mutationField("applyYearChangeCutover", (t) =>
  t.field({
    type: WriteResultRef,
    authScopes: { hasPermission: "year_change:cut_over" },
    args: { runId: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      const r = await applyCutover(a.runId, actorOf(ctx), cutoverOptions());
      return { runId: a.runId, total: r.total, invariantAfter: r.invariantAfter.map((v) => `${v.schoolId}: ${v.kind} (${v.detail})`) };
    },
  }),
);

builder.mutationField("undoYearChange", (t) =>
  t.field({
    type: WriteResultRef,
    authScopes: { hasPermission: "year_change:undo" },
    args: { runId: t.arg.string({ required: true }), kind: t.arg({ type: UndoKindEnum, required: true }) },
    resolve: async (_r, a, ctx) => {
      const actor = actorOf(ctx);
      const r = a.kind === "PREPARE" ? await undoPrepare(a.runId, actor) : await undoCutover(a.runId, actor);
      return { runId: a.runId, total: r.total };
    },
  }),
);
