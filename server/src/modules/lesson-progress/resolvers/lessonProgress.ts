/**
 * Lesson-plan progress LP-2 resolvers (D-#824/#826): the Office overview, a teacher's own rows and
 * one শাখা × subject's tracker. Read-only.
 */
import { builder } from "../../../schema";
import { catchupSuggestion, createCatchup, type CatchupSuggestion } from "../services/LessonCatchupService";
import {
  myProgressRows,
  progressOverview,
  sectionTracker,
  type ProgressRow,
  type CatchupView,
  type SectionTracker,
  type TrackerSession,
} from "../services/LessonProgressService";

const ProgressReasonsRef = builder.objectRef<ProgressRow["reasons"]>("LessonProgressReasons").implement({
  fields: (t) => ({
    revision: t.int({ resolve: (r) => r.REVISION }),
    test: t.int({ resolve: (r) => r.TEST }),
    other: t.int({ resolve: (r) => r.OTHER }),
  }),
});

const ProgressRowRef = builder.objectRef<ProgressRow>("LessonProgressRow").implement({
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    classLevel: t.exposeInt("classLevel"),
    classNameBn: t.exposeString("classNameBn"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    subject: t.exposeString("subject"),
    total: t.exposeInt("total"),
    finished: t.exposeInt("finished"),
    pct: t.exposeInt("pct"),
    finishedLast4Weeks: t.exposeInt("finishedLast4Weeks"),
    pacePerWeek: t.exposeFloat("pacePerWeek"),
    projectedFinishKey: t.string({ nullable: true, resolve: (r) => r.projectedFinishKey }),
    lastFinishedKey: t.string({ nullable: true, resolve: (r) => r.lastFinishedKey }),
    daysSinceLastFinished: t.int({ nullable: true, resolve: (r) => r.daysSinceLastFinished }),
    skipped: t.exposeInt("skipped"),
    reasons: t.field({ type: ProgressReasonsRef, resolve: (r) => r.reasons }),
    unansweredNotes: t.exposeInt("unansweredNotes"),
    lagSessions: t.exposeInt("lagSessions"),
    openCatchups: t.exposeInt("openCatchups"),
  }),
});

const TrackerSessionRef = builder.objectRef<TrackerSession>("LessonTrackerSession").implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    chapter: t.exposeString("chapter"),
    anchorWord: t.exposeString("anchorWord"),
    chapterTitle: t.string({ nullable: true, resolve: (s) => s.chapterTitle }),
    sessionIndex: t.exposeInt("sessionIndex"),
    sessionOf: t.exposeInt("sessionOf"),
    titleBn: t.exposeString("titleBn"),
    artifactId: t.exposeString("artifactId"),
    status: t.exposeString("status"),
    finishedOn: t.exposeStringList("finishedOn"),
    startedOn: t.exposeStringList("startedOn"),
    teacherNames: t.exposeStringList("teacherNames"),
    absentCount: t.exposeInt("absentCount"),
    attendanceComplete: t.exposeBoolean("attendanceComplete"),
  }),
});

const CatchupSnapshotRef = builder.objectRef<CatchupView["snapshot"]>("LessonCatchupSnapshot").implement({
  fields: (t) => ({
    finished: t.exposeInt("finished"),
    total: t.exposeInt("total"),
    lagSessions: t.exposeInt("lagSessions"),
    skipped: t.exposeInt("skipped"),
  }),
});

const CatchupRef = builder.objectRef<CatchupView>("LessonCatchup").implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    taskId: t.exposeString("taskId"),
    titleBn: t.exposeString("titleBn"),
    assigneeName: t.exposeString("assigneeName"),
    dueKey: t.exposeString("dueKey"),
    /** TODO | DOING | DONE | CANCELLED */
    status: t.exposeString("status"),
    blockedReason: t.string({ nullable: true, resolve: (c) => c.blockedReason }),
    createdAt: t.exposeString("createdAt"),
    snapshot: t.field({ type: CatchupSnapshotRef, resolve: (c) => c.snapshot }),
  }),
});

const SectionTrackerRef = builder.objectRef<SectionTracker>("LessonSectionTracker").implement({
  fields: (t) => ({
    row: t.field({ type: ProgressRowRef, resolve: (x) => x.row }),
    sessions: t.field({ type: [TrackerSessionRef], resolve: (x) => x.sessions }),
    catchups: t.field({ type: [CatchupRef], resolve: (x) => x.catchups }),
  }),
});

const AssigneeRef = builder.objectRef<CatchupSuggestion["assignees"][number]>("LessonCatchupAssignee").implement({
  fields: (t) => ({
    userId: t.exposeString("userId"),
    name: t.exposeString("name"),
    /** ROUTINE | CLASS_TEACHER */
    why: t.exposeString("why"),
  }),
});

const SuggestionRef = builder.objectRef<CatchupSuggestion>("LessonCatchupSuggestion").implement({
  fields: (t) => ({
    assignees: t.field({ type: [AssigneeRef], resolve: (x) => x.assignees }),
    titleBn: t.exposeString("titleBn"),
    notes: t.exposeString("notes"),
    dueKey: t.exposeString("dueKey"),
    sessionKeys: t.exposeStringList("sessionKeys"),
  }),
});

const CatchupInputRef = builder.inputType("LessonCatchupInput", {
  fields: (t) => ({
    assigneeUserId: t.string({ required: true }),
    titleBn: t.string({ required: true }),
    notes: t.string({ required: false }),
    dueKey: t.string({ required: true }),
    effortMin: t.int({ required: false }),
    sessionKeys: t.stringList({ required: false }),
  }),
});

builder.queryField("lessonProgressOverview", (t) =>
  t.field({
    type: [ProgressRowRef],
    description: "LP-2 (D-#824): every শাখা × subject with session plans — progress, pace, lag behind the parallel শাখা. Largest lag first.",
    authScopes: { hasPermission: "lesson_progress:view_all" },
    args: { classLevel: t.arg.int({ required: false }), subject: t.arg.string({ required: false }) },
    resolve: (_r, args) => progressOverview({ classLevel: args.classLevel ?? null, subject: args.subject ?? null }),
  }),
);

builder.queryField("myLessonProgress", (t) =>
  t.field({
    type: [ProgressRowRef],
    description: "LP-2: the caller's own শাখা × subjects (routine-held, or every plan subject of a class-teacher শাখা).",
    authScopes: { hasAnyPermission: ["lesson_progress:view", "lesson_progress:view_all"] },
    resolve: (_r, _a, ctx) => myProgressRows(ctx.auth!),
  }),
);

builder.queryField("lessonSectionTracker", (t) =>
  t.field({
    type: SectionTrackerRef,
    description: "LP-2: one শাখা × subject's session plans in book order with finished / started / skipped / not yet.",
    authScopes: { hasAnyPermission: ["lesson_progress:view", "lesson_progress:view_all"] },
    args: { sectionId: t.arg.string({ required: true }), subject: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => sectionTracker(args.sectionId, args.subject, ctx.auth!),
  }),
);

builder.queryField("lessonCatchupSuggestion", (t) =>
  t.field({
    type: SuggestionRef,
    description: "LP-4 (D-#827): the pre-filled catch-up task for a শাখা × subject — its routine teacher(s) and class teacher, a title, notes naming the skipped sessions and those many students missed, due in a week.",
    authScopes: { hasPermission: "lesson_progress:view_all" },
    args: { sectionId: t.arg.string({ required: true }), subject: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => catchupSuggestion(await sectionTracker(args.sectionId, args.subject, ctx.auth!)),
  }),
);

builder.mutationField("createLessonCatchup", (t) =>
  t.field({
    type: CatchupRef,
    description:
      "LP-4 (D-#827): the Office's corrective action — a work-board task for the teacher (createTask: work_board:assign, audit, TASK_ASSIGNED) recorded against the শাখা × subject.",
    authScopes: { hasPermission: "lesson_progress:view_all" },
    args: {
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      input: t.arg({ type: CatchupInputRef, required: true }),
    },
    resolve: async (_r, args, ctx) => createCatchup(await sectionTracker(args.sectionId, args.subject, ctx.auth!), args.input, ctx.auth!),
  }),
);
