/**
 * Student progress board + improvement actions — GraphQL (docs/prd-student-progress.md,
 * D-#734..#738).
 *
 * RBAC composes EXISTING permissions only (§9):
 *   - board, student page, create/stop/extend, per-day assignee, the Office day list,
 *     ticking on behalf: `roster:manage` (Office template + Principal).
 *   - the teacher's own day + ticks: `tracker:write`; that the caller is the person
 *     responsible for the day is checked in the service.
 *   - the guardian's day + ticks: `guardian:read_child` + `assertGuardianOfStudent`.
 *   - leave hand-over rows: `roster:manage`/`leave:manage`, or the leave's own applicant.
 */
import { builder } from "../../../schema";
import { callerHasPermission, type ImprovementPart, type ImprovementTickStatus, type ImprovementReason, type ImprovementScope, type ImprovementRepeat } from "@scd/shared";
import { ForbiddenError, assertGuardianOfStudent } from "../../../middleware/authz";
import { StaffLeaveApplication } from "../../hr/models/StaffLeaveApplication";
import { resolveStaffProfileForUser } from "../../hr/services/staffMatch";
import {
  createAction,
  stopAction,
  extendAction,
  tick,
  untick,
  setDayAssignee,
  teacherTasks,
  guardianTasks,
  guardianStreak,
  officeDayTasks,
  listActions,
  actionDetail,
  leaveTasks,
  summarize,
  defaultSubjectTeacher,
  type TaskRow,
  type ActionSummary,
  type DayCell,
  type FamilyRow,
  type ActionDetail,
  type LeaveTaskRow,
} from "../services/ImprovementActionService";
import {
  sectionBoard,
  schoolOverview,
  studentProgress,
  suggestReason,
  type SectionBoard,
  type GridStudent,
  type SchoolOverview,
  type AttentionRow,
  type StudentProgress,
  type StudentSubjectRow,
} from "../services/ProgressBoardService";
import type { Cell } from "../rules";

const actor = (ctx: { auth?: { userId: unknown } | null }): string => {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return ctx.auth.userId as string;
};

// ---------------------------------------------------------------------------
// Object types
// ---------------------------------------------------------------------------

const TaskRef = builder.objectRef<TaskRow>("ImprovementTask").implement({
  description: "One improvement-action task for one day — a teacher's, or a guardian's for one child (SP-2, D-#735).",
  fields: (t) => ({
    actionId: t.exposeString("actionId"),
    part: t.exposeString("part"),
    dayKey: t.exposeString("dayKey"),
    dayNumber: t.exposeInt("dayNumber"),
    totalDays: t.exposeInt("totalDays"),
    scope: t.exposeString("scope"),
    subject: t.exposeString("subject"),
    sectionId: t.exposeString("sectionId"),
    classLevel: t.int({ nullable: true, resolve: (r) => r.classLevel }),
    sectionNameBn: t.exposeString("sectionNameBn"),
    studentId: t.string({ nullable: true, resolve: (r) => r.studentId }),
    studentName: t.string({ nullable: true, resolve: (r) => r.studentName }),
    task: t.exposeString("task"),
    responsibleUserId: t.string({ nullable: true, resolve: (r) => r.responsibleUserId }),
    responsibleName: t.string({ nullable: true, resolve: (r) => r.responsibleName }),
    responsibleSource: t.string({ nullable: true, resolve: (r) => r.responsibleSource }),
    assignedTeacherName: t.string({ nullable: true, resolve: (r) => r.assignedTeacherName }),
    doneSoFar: t.exposeInt("doneSoFar"),
    daysSoFar: t.exposeInt("daysSoFar"),
    status: t.string({ nullable: true, resolve: (r) => r.status }),
    reason: t.string({ nullable: true, resolve: (r) => r.reason }),
    markedByName: t.string({ nullable: true, resolve: (r) => r.markedByName }),
    onBehalf: t.exposeBoolean("onBehalf"),
    markedByMe: t.exposeBoolean("markedByMe"),
  }),
});

type SummaryWithOutcome = ActionSummary & { before?: number | null; after?: number | null };

const SummaryRef = builder.objectRef<SummaryWithOutcome>("ImprovementActionSummary").implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    scope: t.exposeString("scope"),
    subject: t.exposeString("subject"),
    sectionId: t.exposeString("sectionId"),
    classLevel: t.int({ nullable: true, resolve: (r) => r.classLevel }),
    sectionNameBn: t.exposeString("sectionNameBn"),
    studentId: t.string({ nullable: true, resolve: (r) => r.studentId }),
    studentName: t.string({ nullable: true, resolve: (r) => r.studentName }),
    reason: t.string({ nullable: true, resolve: (r) => r.reason }),
    teacherTask: t.string({ nullable: true, resolve: (r) => r.teacherTask }),
    teacherUserId: t.string({ nullable: true, resolve: (r) => r.teacherUserId }),
    teacherName: t.string({ nullable: true, resolve: (r) => r.teacherName }),
    guardianTask: t.string({ nullable: true, resolve: (r) => r.guardianTask }),
    repeat: t.exposeString("repeat"),
    startKey: t.exposeString("startKey"),
    endKey: t.exposeString("endKey"),
    totalDays: t.int({ resolve: (r) => r.dayKeys.length }),
    state: t.exposeString("state"),
    dayNumber: t.exposeInt("dayNumber"),
    createdByName: t.string({ nullable: true, resolve: (r) => r.createdByName }),
    createdAt: t.exposeString("createdAt"),
    stopReason: t.string({ nullable: true, resolve: (r) => r.stopReason }),
    teacherDone: t.exposeInt("teacherDone"),
    teacherOwed: t.exposeInt("teacherOwed"),
    teacherNotMarked: t.exposeInt("teacherNotMarked"),
    guardianDone: t.exposeInt("guardianDone"),
    guardianOwed: t.exposeInt("guardianOwed"),
    alertClassTeacher: t.exposeBoolean("alertClassTeacher"),
    before: t.float({ nullable: true, resolve: (r) => r.before ?? null }),
    after: t.float({ nullable: true, resolve: (r) => r.after ?? null }),
  }),
});

const DayCellRef = builder.objectRef<DayCell>("ImprovementDayCell").implement({
  fields: (t) => ({
    dayKey: t.exposeString("dayKey"),
    status: t.string({ nullable: true, resolve: (r) => r.status }),
    reason: t.string({ nullable: true, resolve: (r) => r.reason }),
    by: t.string({ nullable: true, resolve: (r) => r.by }),
    byName: t.string({ nullable: true, resolve: (r) => r.byName }),
    future: t.exposeBoolean("future"),
  }),
});

const FamilyRef = builder.objectRef<FamilyRow>("ImprovementFamilyRow").implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    done: t.exposeInt("done"),
    owed: t.exposeInt("owed"),
    last3: t.stringList({ nullable: { list: false, items: true }, resolve: (r) => r.last3 }),
  }),
});

const DetailRef = builder.objectRef<ActionDetail & { before: number | null; after: number | null }>("ImprovementActionDetail").implement({
  fields: (t) => ({
    summary: t.field({ type: SummaryRef, resolve: (d) => ({ ...d.summary, before: d.before, after: d.after }) }),
    teacherDays: t.field({ type: [DayCellRef], resolve: (d) => d.teacherDays }),
    guardianDays: t.field({ type: [DayCellRef], resolve: (d) => d.guardianDays }),
    families: t.field({ type: [FamilyRef], resolve: (d) => d.families }),
    todayResponsibleName: t.string({ nullable: true, resolve: (d) => d.todayResponsibleName }),
    todayResponsibleSource: t.string({ nullable: true, resolve: (d) => d.todayResponsibleSource }),
  }),
});

const LeaveTaskRef = builder.objectRef<LeaveTaskRow>("ImprovementLeaveTask").implement({
  fields: (t) => ({
    actionId: t.exposeString("actionId"),
    dayKey: t.exposeString("dayKey"),
    scope: t.exposeString("scope"),
    subject: t.exposeString("subject"),
    classLevel: t.int({ nullable: true, resolve: (r) => r.classLevel }),
    sectionNameBn: t.exposeString("sectionNameBn"),
    studentName: t.string({ nullable: true, resolve: (r) => r.studentName }),
    task: t.exposeString("task"),
    dayNumber: t.exposeInt("dayNumber"),
    totalDays: t.exposeInt("totalDays"),
    responsibleUserId: t.string({ nullable: true, resolve: (r) => r.responsibleUserId }),
    responsibleName: t.string({ nullable: true, resolve: (r) => r.responsibleName }),
    source: t.exposeString("source"),
  }),
});

const StreakDayRef = builder.objectRef<{ dayKey: string; status: ImprovementTickStatus | null }>("ImprovementStreakDay").implement({
  fields: (t) => ({
    dayKey: t.exposeString("dayKey"),
    status: t.string({ nullable: true, resolve: (r) => r.status }),
  }),
});

const CellRef = builder.objectRef<Cell>("ProgressCell").implement({
  fields: (t) => ({
    subject: t.exposeString("subject"),
    avgPercent: t.exposeFloat("avgPercent"),
    tests: t.exposeInt("tests"),
    trend: t.exposeString("trend"),
    falling: t.exposeBoolean("falling"),
    last3: t.floatList({ resolve: (c) => c.last3 }),
    latestWeakness: t.string({ nullable: true, resolve: (c) => c.latestWeakness }),
  }),
});

const SubjectValueRef = builder.objectRef<{ subject: string; value: number | null }>("ProgressSubjectValue").implement({
  fields: (t) => ({
    subject: t.exposeString("subject"),
    value: t.float({ nullable: true, resolve: (r) => r.value }),
  }),
});

const GridStudentRef = builder.objectRef<GridStudent>("ProgressGridStudent").implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    rollNumber: t.string({ nullable: true, resolve: (r) => r.rollNumber }),
    cells: t.field({ type: [CellRef], resolve: (r) => r.cells }),
    overall: t.float({ nullable: true, resolve: (r) => r.overall }),
    atRisk: t.exposeBoolean("atRisk"),
    absent: t.exposeInt("absent"),
    openActions: t.exposeInt("openActions"),
    behindActions: t.exposeInt("behindActions"),
    doneActions: t.exposeInt("doneActions"),
  }),
});

const SectionBoardRef = builder.objectRef<SectionBoard>("ProgressSectionBoard").implement({
  description: "Every active student × subject of one section over a period, with Class highest + Class average rows (SP-1, D-#734).",
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    classLevel: t.int({ nullable: true, resolve: (r) => r.classLevel }),
    sectionNameBn: t.exposeString("sectionNameBn"),
    subjects: t.exposeStringList("subjects"),
    highest: t.field({ type: [SubjectValueRef], resolve: (r) => r.highest }),
    average: t.field({ type: [SubjectValueRef], resolve: (r) => r.average }),
    highestOverall: t.float({ nullable: true, resolve: (r) => r.highestOverall }),
    averageOverall: t.float({ nullable: true, resolve: (r) => r.averageOverall }),
    students: t.field({ type: [GridStudentRef], resolve: (r) => r.students }),
  }),
});

const AttentionRef = builder.objectRef<AttentionRow>("ProgressAttentionRow").implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    sectionId: t.exposeString("sectionId"),
    classLevel: t.int({ nullable: true, resolve: (r) => r.classLevel }),
    sectionNameBn: t.exposeString("sectionNameBn"),
    subject: t.exposeString("subject"),
    why: t.exposeString("why"),
    last3: t.floatList({ resolve: (r) => r.last3 }),
    latest: t.exposeFloat("latest"),
    actionState: t.exposeString("actionState"),
    actionDelta: t.float({ nullable: true, resolve: (r) => r.actionDelta }),
  }),
});

const OverviewRef = builder.objectRef<SchoolOverview>("ProgressSchoolOverview").implement({
  fields: (t) => ({
    schoolAverage: t.float({ nullable: true, resolve: (r) => r.schoolAverage }),
    studentsWithResults: t.exposeInt("studentsWithResults"),
    atRisk: t.exposeInt("atRisk"),
    atRiskNoAction: t.exposeInt("atRiskNoAction"),
    actionsBehind: t.exposeInt("actionsBehind"),
    improved: t.exposeInt("improved"),
    improvedOf: t.exposeInt("improvedOf"),
    attention: t.field({ type: [AttentionRef], resolve: (r) => r.attention }),
  }),
});

const SubjectRowRef = builder.objectRef<StudentSubjectRow>("ProgressStudentSubject").implement({
  fields: (t) => ({
    subject: t.exposeString("subject"),
    avgPercent: t.exposeFloat("avgPercent"),
    tests: t.exposeInt("tests"),
    trend: t.exposeString("trend"),
    falling: t.exposeBoolean("falling"),
    last3: t.floatList({ resolve: (c) => c.last3 }),
    latestWeakness: t.string({ nullable: true, resolve: (c) => c.latestWeakness }),
    classAverage: t.float({ nullable: true, resolve: (c) => c.classAverage }),
  }),
});

const StudentProgressRef = builder.objectRef<StudentProgress>("ProgressStudent").implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    sectionId: t.exposeString("sectionId"),
    classLevel: t.int({ nullable: true, resolve: (r) => r.classLevel }),
    sectionNameBn: t.exposeString("sectionNameBn"),
    overall: t.float({ nullable: true, resolve: (r) => r.overall }),
    classOverall: t.float({ nullable: true, resolve: (r) => r.classOverall }),
    trajectory: t.exposeString("trajectory"),
    atRisk: t.exposeBoolean("atRisk"),
    absent: t.exposeInt("absent"),
    recurringWeaknesses: t.exposeStringList("recurringWeaknesses"),
    subjects: t.field({ type: [SubjectRowRef], resolve: (r) => r.subjects }),
    actions: t.field({ type: [SummaryRef], resolve: (r) => r.actions }),
  }),
});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const CreateInput = builder.inputType("CreateImprovementActionInput", {
  fields: (t) => ({
    scope: t.string({ required: true }),
    sectionId: t.string({ required: true }),
    studentId: t.string(),
    subject: t.string({ required: true }),
    reason: t.string(),
    teacherTask: t.string(),
    teacherUserId: t.string(),
    guardianTask: t.string(),
    startKey: t.string({ required: true }),
    days: t.int({ required: true }),
    repeat: t.string({ required: true }),
    alertClassTeacher: t.boolean(),
  }),
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

builder.queryField("progressSchoolOverview", (t) =>
  t.field({
    type: OverviewRef,
    description: "Whole-school tiles + the needs-attention list over [fromKey, toKey] (SP-1). roster:manage.",
    authScopes: { hasPermission: "roster:manage" },
    args: { fromKey: t.arg.string({ required: true }), toKey: t.arg.string({ required: true }) },
    resolve: async (_r, a) => schoolOverview(a.fromKey, a.toKey),
  }),
);

builder.queryField("progressSectionBoard", (t) =>
  t.field({
    type: SectionBoardRef,
    authScopes: { hasPermission: "roster:manage" },
    args: { sectionId: t.arg.string({ required: true }), fromKey: t.arg.string({ required: true }), toKey: t.arg.string({ required: true }) },
    resolve: async (_r, a) => sectionBoard(a.sectionId, a.fromKey, a.toKey),
  }),
);

builder.queryField("progressStudent", (t) =>
  t.field({
    type: StudentProgressRef,
    authScopes: { hasPermission: "roster:manage" },
    args: { studentId: t.arg.string({ required: true }), fromKey: t.arg.string({ required: true }), toKey: t.arg.string({ required: true }) },
    resolve: async (_r, a) => studentProgress(a.studentId, a.fromKey, a.toKey),
  }),
);

const SuggestionRef = builder.objectRef<{ reason: string; teacherUserId: string | null }>("ImprovementSuggestion").implement({
  fields: (t) => ({
    reason: t.exposeString("reason"),
    teacherUserId: t.string({ nullable: true, resolve: (r) => r.teacherUserId }),
  }),
});

builder.queryField("improvementSuggest", (t) =>
  t.field({
    type: SuggestionRef,
    description: "Prefill for the New action form: a 'why' line from the results, and the routine subject teacher.",
    authScopes: { hasPermission: "roster:manage" },
    args: { sectionId: t.arg.string({ required: true }), subject: t.arg.string({ required: true }), studentId: t.arg.string() },
    resolve: async (_r, a) => ({
      reason: await suggestReason(a.studentId ?? null, a.sectionId, a.subject),
      teacherUserId: await defaultSubjectTeacher(a.sectionId, a.subject),
    }),
  }),
);

builder.queryField("improvementActions", (t) =>
  t.field({
    type: [SummaryRef],
    authScopes: { hasPermission: "roster:manage" },
    args: { studentId: t.arg.string(), sectionId: t.arg.string() },
    resolve: async (_r, a) => listActions({ studentId: a.studentId, sectionId: a.sectionId }),
  }),
);

builder.queryField("improvementAction", (t) =>
  t.field({
    type: DetailRef,
    description: "One action with its day strips (who ticked each day), families for a CLASS action, and before/after (SP-2).",
    authScopes: { hasPermission: "roster:manage" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_r, a) => {
      const d = await actionDetail(a.id);
      const { outcomes } = await import("../services/ProgressBoardService");
      const o = (await outcomes([d.summary])).get(d.summary.id);
      return { ...d, before: o?.before ?? null, after: o?.after ?? null };
    },
  }),
);

builder.queryField("myImprovementTasks", (t) =>
  t.field({
    type: [TaskRef],
    description: "The caller's teacher tasks today — their own, and any they cover for a teacher on leave (SP-2/SP-3).",
    authScopes: { hasAnyPermission: ["tracker:write", "roster:manage"] },
    resolve: async (_r, _a, ctx) => teacherTasks(actor(ctx)),
  }),
);

builder.queryField("improvementDayTasks", (t) =>
  t.field({
    type: [TaskRef],
    description: "Every teacher task of today with who does it and whether it is ticked — the Office 11:00 list (SP-4).",
    authScopes: { hasPermission: "roster:manage" },
    resolve: async (_r, _a, ctx) => officeDayTasks(undefined, actor(ctx)),
  }),
);

builder.queryField("childImprovementTasks", (t) =>
  t.field({
    type: [TaskRef],
    description: "Today's guardian tasks for one linked child (SP-2). guardian:read_child + link check.",
    authScopes: { hasPermission: "guardian:read_child" },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await assertGuardianOfStudent(ctx, a.studentId);
      return guardianTasks(a.studentId, actor(ctx));
    },
  }),
);

builder.queryField("childImprovementStreak", (t) =>
  t.field({
    type: [StreakDayRef],
    authScopes: { hasPermission: "guardian:read_child" },
    args: { actionId: t.arg.string({ required: true }), studentId: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await assertGuardianOfStudent(ctx, a.studentId);
      return guardianStreak(a.actionId, a.studentId);
    },
  }),
);

builder.queryField("leaveImprovementTasks", (t) =>
  t.field({
    type: [LeaveTaskRef],
    description: "The improvement tasks of a teacher's leave days and who does each (SP-3). Office/Principal, or the applicant.",
    authScopes: { hasAnyPermission: ["roster:manage", "leave:manage", "tracker:write"] },
    args: { leaveApplicationId: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      const userId = actor(ctx);
      if (!callerHasPermission(ctx.auth!, "roster:manage") && !callerHasPermission(ctx.auth!, "leave:manage")) {
        const leave = (await StaffLeaveApplication.findById(a.leaveApplicationId).select("staffProfileId").lean()) as { staffProfileId: unknown } | null;
        const mine = await resolveStaffProfileForUser(userId);
        if (!leave || !mine || String(mine._id) !== String(leave.staffProfileId)) throw new ForbiddenError("এই ছুটির আবেদন আপনার নয়");
      }
      return (await leaveTasks(a.leaveApplicationId)).rows;
    },
  }),
);

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

builder.mutationField("createImprovementAction", (t) =>
  t.field({
    type: SummaryRef,
    authScopes: { hasPermission: "roster:manage" },
    args: { input: t.arg({ type: CreateInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      const a = await createAction(
        {
          scope: input.scope as ImprovementScope,
          sectionId: input.sectionId,
          studentId: input.studentId ?? null,
          subject: input.subject,
          reason: input.reason ?? null,
          teacherTask: input.teacherTask ?? null,
          teacherUserId: input.teacherUserId ?? null,
          guardianTask: input.guardianTask ?? null,
          startKey: input.startKey,
          days: input.days,
          repeat: input.repeat as ImprovementRepeat,
          alertClassTeacher: input.alertClassTeacher ?? true,
        },
        actor(ctx),
        ctx.auth?.role,
      );
      return (await summarize([a.toObject()]))[0];
    },
  }),
);

builder.mutationField("stopImprovementAction", (t) =>
  t.field({
    type: SummaryRef,
    authScopes: { hasPermission: "roster:manage" },
    args: { id: t.arg.string({ required: true }), reason: t.arg.string() },
    resolve: async (_r, a, ctx) => (await summarize([(await stopAction(a.id, a.reason, actor(ctx), ctx.auth?.role)).toObject()]))[0],
  }),
);

builder.mutationField("extendImprovementAction", (t) =>
  t.field({
    type: SummaryRef,
    authScopes: { hasPermission: "roster:manage" },
    args: { id: t.arg.string({ required: true }), days: t.arg.int({ required: true }) },
    resolve: async (_r, a, ctx) => (await summarize([(await extendAction(a.id, a.days, actor(ctx), ctx.auth?.role)).toObject()]))[0],
  }),
);

builder.mutationField("setImprovementDayAssignee", (t) =>
  t.boolean({
    description: "Who does an action's teacher task on one day — the leave cover screen (SP-3). null = back to the default.",
    authScopes: { hasPermission: "roster:manage" },
    args: { actionId: t.arg.string({ required: true }), dayKey: t.arg.string({ required: true }), userId: t.arg.string() },
    resolve: async (_r, a, ctx) => setDayAssignee(a.actionId, a.dayKey, a.userId ?? null, actor(ctx), ctx.auth?.role),
  }),
);

builder.mutationField("tickImprovementTask", (t) =>
  t.boolean({
    description:
      "Mark a TEACHER day DONE/COULDNT — by the person responsible today, or by Office/Principal on behalf (any past " +
      "scheduled day, with a reason). The responsibility check is in the service.",
    authScopes: { hasAnyPermission: ["tracker:write", "roster:manage"] },
    args: {
      actionId: t.arg.string({ required: true }),
      dayKey: t.arg.string({ required: true }),
      status: t.arg.string({ required: true }),
      reason: t.arg.string(),
    },
    resolve: async (_r, a, ctx) => {
      await tick(
        { actionId: a.actionId, part: "TEACHER", dayKey: a.dayKey, status: a.status as ImprovementTickStatus, reason: (a.reason ?? null) as ImprovementReason | null },
        { userId: actor(ctx), role: ctx.auth?.role, isAdmin: callerHasPermission(ctx.auth!, "roster:manage") },
      );
      return true;
    },
  }),
);

builder.mutationField("untickImprovementTask", (t) =>
  t.boolean({
    authScopes: { hasAnyPermission: ["tracker:write", "roster:manage"] },
    args: { actionId: t.arg.string({ required: true }), dayKey: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) =>
      untick(
        { actionId: a.actionId, part: "TEACHER" as ImprovementPart, dayKey: a.dayKey },
        { userId: actor(ctx), role: ctx.auth?.role, isAdmin: callerHasPermission(ctx.auth!, "roster:manage") },
      ),
  }),
);

builder.mutationField("tickChildImprovementTask", (t) =>
  t.boolean({
    description: "A guardian marks today's task for their child DONE/COULDNT (SP-2).",
    authScopes: { hasPermission: "guardian:read_child" },
    args: {
      actionId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      dayKey: t.arg.string({ required: true }),
      status: t.arg.string({ required: true }),
      reason: t.arg.string(),
    },
    resolve: async (_r, a, ctx) => {
      await assertGuardianOfStudent(ctx, a.studentId);
      await tick(
        { actionId: a.actionId, part: "GUARDIAN", dayKey: a.dayKey, studentId: a.studentId, status: a.status as ImprovementTickStatus, reason: (a.reason ?? null) as ImprovementReason | null },
        { guardianId: actor(ctx), role: "GUARDIAN", isAdmin: false },
      );
      return true;
    },
  }),
);

builder.mutationField("untickChildImprovementTask", (t) =>
  t.boolean({
    authScopes: { hasPermission: "guardian:read_child" },
    args: { actionId: t.arg.string({ required: true }), studentId: t.arg.string({ required: true }), dayKey: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await assertGuardianOfStudent(ctx, a.studentId);
      return untick({ actionId: a.actionId, part: "GUARDIAN", dayKey: a.dayKey, studentId: a.studentId }, { guardianId: actor(ctx), role: "GUARDIAN", isAdmin: false });
    },
  }),
);
