/**
 * Mastery tracker — actions: section trigger → extra class → re-test → close (M-5, §5.5, D-#811).
 *
 *   masteryAction         — mastery:view; an approver, or the routine holder of its section × subject
 *   masteryActionsPage    — mastery:view; school-wide for approvers, one section × subject otherwise
 *   masteryActionCounts   — mastery:approve; the leader dashboard's numbers
 *   decideMasteryAction   — mastery:approve; EXTRA_CLASS / RETEACH / REJECT
 *   recordMasteryExtraClass — mastery:enter_results; the class was held, who came
 *   buildMasteryRetest    — mastery:create; the re-test sheet (unseen questions per student)
 *   closeMasteryAction    — mastery:enter_results; before / after + outcome
 *
 * The approver-or-row rule is in the service (never a role check, D-#799).
 */
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import type { MasteryActionOutcome, MasteryAttendeeSet, MasterySubject } from "@scd/shared";
import {
  actionCounts,
  actionDetail,
  actionsPage,
  buildRetest,
  closeAction,
  decideAction,
  recordHeld,
  type ActionDetail,
  type ActionFilter,
  type ActionStudent,
  type ActionSummary,
} from "../services/MasteryActionService";
import type { Auth } from "../services/MasteryWorkService";
import { MasteryOutcome } from "../models/MasteryOutcome";
import { missedChapter } from "../../lesson-progress/services/StudentLessonService";

function authOf(ctx: { auth: Auth | null }): Auth {
  if (!ctx.auth) throw new Error("লগইন প্রয়োজন।");
  return ctx.auth;
}

const NumbersRef = builder.objectRef<{ weakPct: number | null; meanPct: number | null }>("MasteryActionNumbers");
NumbersRef.implement({
  fields: (t) => ({
    weakPct: t.int({ nullable: true, resolve: (n) => n.weakPct }),
    meanPct: t.int({ nullable: true, resolve: (n) => n.meanPct }),
  }),
});

const TriggerRef = builder.objectRef<ActionDetail["trigger"]>("MasteryActionTrigger");
TriggerRef.implement({
  fields: (t) => ({
    at: t.exposeString("at"),
    weakPct: t.exposeInt("weakPct"),
    weak: t.exposeInt("weak"),
    verdicts: t.exposeInt("verdicts"),
    assessments: t.exposeInt("assessments"),
  }),
});

const PlanRef = builder.objectRef<NonNullable<ActionDetail["plan"]>>("MasteryActionPlan");
PlanRef.implement({
  fields: (t) => ({
    date: t.string({ nullable: true, resolve: (p) => p.date }),
    slotKind: t.string({ nullable: true, resolve: (p) => p.slotKind }),
    periodNumber: t.int({ nullable: true, resolve: (p) => p.periodNumber }),
    teacherName: t.string({ nullable: true, resolve: (p) => p.teacherName }),
    attendees: t.exposeString("attendees"),
    retestDate: t.string({ nullable: true, resolve: (p) => p.retestDate }),
    note: t.string({ nullable: true, resolve: (p) => p.note }),
  }),
});

const StudentRef = builder.objectRef<ActionStudent>("MasteryActionStudent");
StudentRef.implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    rollNumber: t.string({ nullable: true, resolve: (s) => s.rollNumber }),
    stateNow: t.exposeString("stateNow"),
    weakAtTrigger: t.exposeBoolean("weakAtTrigger"),
    inPlan: t.exposeBoolean("inPlan"),
    present: t.boolean({ nullable: true, resolve: (s) => s.present }),
    recentPct: t.int({ nullable: true, resolve: (s) => s.recentPct }),
    retestPct: t.int({ nullable: true, resolve: (s) => s.retestPct }),
  }),
});

const EventRef = builder.objectRef<ActionDetail["events"][number]>("MasteryActionEvent");
EventRef.implement({
  fields: (t) => ({
    at: t.exposeString("at"),
    kind: t.exposeString("kind"),
    byName: t.string({ nullable: true, resolve: (e) => e.byName }),
    note: t.string({ nullable: true, resolve: (e) => e.note }),
  }),
});

const LessonGapRef = builder.objectRef<{ taught: boolean; weakCount: number; missedNames: string[] }>("MasteryLessonGap").implement({
  fields: (t) => ({
    /** False = no class of this chapter has been marked in the শাখা yet. */
    taught: t.exposeBoolean("taught"),
    weakCount: t.exposeInt("weakCount"),
    missedNames: t.exposeStringList("missedNames"),
  }),
});

const DetailRef = builder.objectRef<ActionDetail>("MasteryAction");
DetailRef.implement({
  description: "Issue → action → result for one section × subject × outcome (D-#781 / #811).",
  fields: (t) => ({
    id: t.exposeString("id"),
    sectionId: t.exposeString("sectionId"),
    sectionName: t.exposeString("sectionName"),
    className: t.exposeString("className"),
    subject: t.exposeString("subject"),
    loCode: t.exposeString("loCode"),
    labelBn: t.exposeString("labelBn"),
    kind: t.exposeString("kind"),
    status: t.exposeString("status"),
    trigger: t.field({ type: TriggerRef, resolve: (a) => a.trigger }),
    plan: t.field({ type: PlanRef, nullable: true, resolve: (a) => a.plan }),
    students: t.field({ type: [StudentRef], resolve: (a) => a.students }),
    retestPaperId: t.string({ nullable: true, resolve: (a) => a.retestPaperId }),
    retestConfirmed: t.exposeBoolean("retestConfirmed"),
    before: t.field({ type: NumbersRef, nullable: true, resolve: (a) => a.before }),
    after: t.field({ type: NumbersRef, nullable: true, resolve: (a) => a.after }),
    now: t.field({ type: NumbersRef, resolve: (a) => a.now }),
    suggestedOutcome: t.string({ nullable: true, resolve: (a) => a.suggestedOutcome }),
    outcome: t.string({ nullable: true, resolve: (a) => a.outcome }),
    events: t.field({ type: [EventRef], resolve: (a) => a.events }),
    canApprove: t.exposeBoolean("canApprove"),
    canWork: t.exposeBoolean("canWork"),
    /** LP-3 (D-#825): of the students weak at the trigger, who missed a class where this outcome's chapter
     *  was taught — "missed the lesson" points to catch-up rather than re-teach. Information only. */
    lessonGap: t.field({
      type: LessonGapRef,
      resolve: async (a) => {
        const weak = a.students.filter((s) => s.weakAtTrigger);
        const outcome = await MasteryOutcome.findOne({ code: a.loCode }).select("chapterNumber").lean();
        if (outcome?.chapterNumber == null || weak.length === 0) return { taught: false, weakCount: weak.length, missedNames: [] };
        const r = await missedChapter(weak.map((s) => s.studentId), a.subject, String(outcome.chapterNumber));
        const missed = new Set(r.missed);
        return { taught: r.taught, weakCount: weak.length, missedNames: weak.filter((s) => missed.has(s.studentId)).map((s) => s.name) };
      },
    }),
  }),
});

const SummaryRef = builder.objectRef<ActionSummary>("MasteryActionSummary");
SummaryRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    sectionId: t.exposeString("sectionId"),
    sectionName: t.exposeString("sectionName"),
    className: t.exposeString("className"),
    subject: t.exposeString("subject"),
    loCode: t.exposeString("loCode"),
    labelBn: t.exposeString("labelBn"),
    kind: t.exposeString("kind"),
    status: t.exposeString("status"),
    weakPct: t.exposeInt("weakPct"),
    weak: t.exposeInt("weak"),
    verdicts: t.exposeInt("verdicts"),
    assessments: t.exposeInt("assessments"),
    planDate: t.string({ nullable: true, resolve: (s) => s.planDate }),
    retestDate: t.string({ nullable: true, resolve: (s) => s.retestDate }),
    outcome: t.string({ nullable: true, resolve: (s) => s.outcome }),
    createdAt: t.exposeString("createdAt"),
  }),
});
const SummaryPageRef = pageRef("MasteryActionPage", SummaryRef);

const CountsRef = builder.objectRef<{ proposed: number; running: number; retestThisWeek: number; closed30: number }>("MasteryActionCounts");
CountsRef.implement({
  fields: (t) => ({
    proposed: t.exposeInt("proposed"),
    running: t.exposeInt("running"),
    retestThisWeek: t.exposeInt("retestThisWeek"),
    closed30: t.exposeInt("closed30"),
  }),
});

const AttendanceInput = builder.inputType("MasteryAttendanceInput", {
  fields: (t) => ({ studentId: t.string({ required: true }), present: t.boolean({ required: true }) }),
});

builder.queryFields((t) => ({
  masteryAction: t.field({
    type: DetailRef,
    description: "One action: trigger, plan, students (now / at trigger / attended / re-test %), before / after, events.",
    authScopes: { hasPermission: "mastery:view" },
    args: { actionId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => actionDetail(args.actionId, authOf(ctx)),
  }),

  masteryActionsPage: t.field({
    type: SummaryPageRef,
    description: "Actions, newest first (D-#761). Without sectionId: school-wide, approvers only. filter OPEN | PROPOSED | RUNNING | CLOSED | ALL.",
    authScopes: { hasPermission: "mastery:view" },
    args: {
      filter: t.arg.string({ required: true }),
      sectionId: t.arg.string({ required: false }),
      subject: t.arg.string({ required: false }),
      page: t.arg.int({ required: false }),
      pageSize: t.arg.int({ required: false }),
    },
    resolve: async (_r, args, ctx) =>
      actionsPage(
        args.filter as ActionFilter,
        { sectionId: args.sectionId, subject: (args.subject ?? null) as MasterySubject | null },
        args,
        authOf(ctx),
      ),
  }),

  masteryActionCounts: t.field({
    type: CountsRef,
    description: "The leader dashboard's numbers: proposals waiting, running actions, re-tests within a week, closed in 30 days.",
    authScopes: { hasPermission: "mastery:approve" },
    resolve: async (_r, _a, ctx) => actionCounts(authOf(ctx)),
  }),
}));

builder.mutationFields((t) => ({
  decideMasteryAction: t.field({
    type: DetailRef,
    description: "Approve an extra class (date + period / after school, attendees, re-test date), turn it into a re-teach, or reject it (reason).",
    authScopes: { hasPermission: "mastery:approve" },
    args: {
      actionId: t.arg.string({ required: true }),
      decision: t.arg.string({ required: true }),
      date: t.arg.string({ required: false }),
      slotKind: t.arg.string({ required: false }),
      periodNumber: t.arg.int({ required: false }),
      attendees: t.arg.string({ required: false }),
      retestDate: t.arg.string({ required: false }),
      note: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) =>
      decideAction(
        args.actionId,
        {
          decision: args.decision as "EXTRA_CLASS" | "RETEACH" | "REJECT",
          date: args.date,
          slotKind: args.slotKind as "PERIOD" | "AFTER_SCHOOL" | null,
          periodNumber: args.periodNumber,
          attendees: args.attendees as MasteryAttendeeSet | null,
          retestDate: args.retestDate,
          note: args.note,
        },
        authOf(ctx),
      ),
  }),

  recordMasteryExtraClass: t.field({
    type: DetailRef,
    description: "The extra class was held: who came (only planned students count).",
    authScopes: { hasPermission: "mastery:enter_results" },
    args: { actionId: t.arg.string({ required: true }), attendance: t.arg({ type: [AttendanceInput], required: true }) },
    resolve: async (_r, args, ctx) => recordHeld(args.actionId, args.attendance, authOf(ctx)),
  }),

  buildMasteryRetest: t.field({
    type: DetailRef,
    description: "Build the re-test work sheet: unseen gold questions on the outcome for each student who sits it.",
    authScopes: { hasPermission: "mastery:create" },
    args: { actionId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => buildRetest(args.actionId, authOf(ctx)),
  }),

  closeMasteryAction: t.field({
    type: DetailRef,
    description: "Close with an outcome (SUCCESS / PARTIAL / NOT_RESOLVED); before and after are recorded. A reason is needed without a marked re-test.",
    authScopes: { hasPermission: "mastery:enter_results" },
    args: { actionId: t.arg.string({ required: true }), outcome: t.arg.string({ required: true }), note: t.arg.string({ required: false }) },
    resolve: async (_r, args, ctx) => closeAction(args.actionId, args.outcome as MasteryActionOutcome, args.note, authOf(ctx)),
  }),
}));
