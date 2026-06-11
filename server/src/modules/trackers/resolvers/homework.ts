/**
 * Homework Tracker resolvers — Layer-A declaration, issue, lifecycle (HW-T1).
 *
 * Mutations (all enforce write-scope via assertCanWrite on the section):
 *   declareHomeworkItem    — subject teacher declares one common sheet (handoff §2.1/§4.1)
 *   issueHomeworkItem      — spawn per-student Layer-B records (HW-T2 will gate behind reconcile)
 *   transitionHomeworkRecord — apply one legal lifecycle transition, timestamped (§3)
 *
 * Queries (read-scope via assertCanRead):
 *   homeworkItems          — the day's declarations for a class (handoff §8.1)
 *   homeworkStudentRecords — Layer-B records for an item (chase/checking queues, §8.2)
 *
 * RBAC: rides the existing tracker:read / tracker:write permissions (D-#33 — no
 * new permission). The class-teacher-only reconcile/confirm action-scope is HW-T2.
 */
import { builder } from "../../../schema";
import {
  declareHomeworkItem as declareSvc,
  issueHomeworkItem as issueSvc,
  transitionRecord as transitionSvc,
  listDailyItems,
  listStudentRecords,
} from "../services/HomeworkService";
import {
  tallyDay as tallyDaySvc,
  getTrimCandidates as trimCandidatesSvc,
  applyTrim as applyTrimSvc,
  confirmHomeworkDay as confirmDaySvc,
} from "../services/HomeworkReconciliationService";
import {
  assertCanWrite,
  assertCanRead,
  assertIsClassTeacher,
  ForbiddenError,
} from "../../../middleware/authz";

// ---------------------------------------------------------------------------
// Object shapes for Pothos
// ---------------------------------------------------------------------------

interface HomeworkItemShape {
  id: string;
  hwId: string;
  classLevel: number;
  subject: string;
  dateGiven: string;
  topTags: string[];
  timeDecl: number;
  qCount: number;
  revItem: boolean;
  status: string;
}

const HomeworkItemRef = builder.objectRef<HomeworkItemShape>("HomeworkItem");
HomeworkItemRef.implement({
  description: "Layer-A homework item — one common sheet per class+subject+day (handoff §2.1).",
  fields: (t) => ({
    id: t.exposeString("id"),
    hwId: t.exposeString("hwId"),
    classLevel: t.exposeInt("classLevel"),
    subject: t.exposeString("subject"),
    dateGiven: t.exposeString("dateGiven"),
    topTags: t.field({ type: ["String"], resolve: (r) => r.topTags }),
    timeDecl: t.exposeInt("timeDecl"),
    qCount: t.exposeInt("qCount"),
    revItem: t.exposeBoolean("revItem"),
    status: t.exposeString("status"),
  }),
});

interface StateStampShape {
  state: string;
  at: string;
}

const StateStampRef = builder.objectRef<StateStampShape>("HomeworkStateStamp");
StateStampRef.implement({
  fields: (t) => ({
    state: t.exposeString("state"),
    at: t.exposeString("at"),
  }),
});

interface HomeworkStudentRecordShape {
  id: string;
  hwId: string;
  studentId: string;
  state: string;
  stateDates: StateStampShape[];
  dueDate: string | null;
  chaseCount: number;
  result: string | null;
}

const HomeworkStudentRecordRef = builder.objectRef<HomeworkStudentRecordShape>(
  "HomeworkStudentRecord",
);
HomeworkStudentRecordRef.implement({
  description: "Layer-B per-student lifecycle record (handoff §2.2). Identity-bearing, operational plane.",
  fields: (t) => ({
    id: t.exposeString("id"),
    hwId: t.exposeString("hwId"),
    studentId: t.exposeString("studentId"),
    state: t.exposeString("state"),
    stateDates: t.field({ type: [StateStampRef], resolve: (r) => r.stateDates }),
    dueDate: t.string({ nullable: true, resolve: (r) => r.dueDate }),
    chaseCount: t.exposeInt("chaseCount"),
    result: t.string({ nullable: true, resolve: (r) => r.result }),
  }),
});

interface IssueResultShape {
  itemId: string;
  hwId: string;
  issuedCount: number;
  status: string;
}

const IssueResultRef = builder.objectRef<IssueResultShape>("IssueHomeworkResult");
IssueResultRef.implement({
  fields: (t) => ({
    itemId: t.exposeString("itemId"),
    hwId: t.exposeString("hwId"),
    issuedCount: t.exposeInt("issuedCount"),
    status: t.exposeString("status"),
  }),
});

interface TransitionResultShape {
  recordId: string;
  hwId: string;
  state: string;
  chaseCount: number;
  result: string | null;
  dueDate: string | null;
}

const TransitionResultRef = builder.objectRef<TransitionResultShape>("HomeworkTransitionResult");
TransitionResultRef.implement({
  fields: (t) => ({
    recordId: t.exposeString("recordId"),
    hwId: t.exposeString("hwId"),
    state: t.exposeString("state"),
    chaseCount: t.exposeInt("chaseCount"),
    result: t.string({ nullable: true, resolve: (r) => r.result }),
    dueDate: t.string({ nullable: true, resolve: (r) => r.dueDate }),
  }),
});

const RosterEntryInput = builder.inputType("IssueRosterEntryInput", {
  fields: (t) => ({
    studentId: t.string({ required: true }),
    present: t.boolean({ required: true }),
  }),
});

// ---------------------------------------------------------------------------
// Mutation: declareHomeworkItem (handoff §2.1, §4.1)
// ---------------------------------------------------------------------------

builder.mutationField("declareHomeworkItem", (t) =>
  t.field({
    type: HomeworkItemRef,
    description: "Declare one common homework sheet for a class+subject+day. Write-scope enforced.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      academicYearId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      classLevel: t.arg.int({ required: true }),
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      dateGiven: t.arg.string({ required: true }),
      topTags: t.arg({ type: ["String"], required: true }),
      timeDecl: t.arg.int({ required: false }),
      qCount: t.arg.int({ required: true }),
      poolRef: t.arg.string({ required: false }),
      selectedQids: t.arg({ type: ["String"], required: false }),
      revItem: t.arg.boolean({ required: false }),
      sessionRef: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanWrite(ctx, args.sectionId);
      const res = await declareSvc({
        academicYearId: args.academicYearId,
        classId: args.classId,
        classLevel: args.classLevel,
        sectionId: args.sectionId,
        subject: args.subject,
        dateGiven: args.dateGiven,
        topTags: [...args.topTags],
        timeDecl: args.timeDecl ?? undefined,
        qCount: args.qCount,
        poolRef: args.poolRef ?? undefined,
        selectedQids: args.selectedQids ? [...args.selectedQids] : undefined,
        revItem: args.revItem ?? undefined,
        sessionRef: args.sessionRef ?? undefined,
        actorId: ctx.auth.userId as string,
      });
      return { ...res, id: res.itemId };
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutation: issueHomeworkItem (spawn Layer-B records)
// ---------------------------------------------------------------------------

builder.mutationField("issueHomeworkItem", (t) =>
  t.field({
    type: IssueResultRef,
    description:
      "Issue an item: spawn per-student records (present→GIVEN, absent→ABSENT_REDELIVER). " +
      "Write-scope enforced. HW-T2 will gate this behind the daily 240-min reconciliation.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      sectionId: t.arg.string({ required: true }),
      itemId: t.arg.string({ required: true }),
      roster: t.arg({ type: [RosterEntryInput], required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanWrite(ctx, args.sectionId);
      return issueSvc(
        args.itemId,
        args.roster.map((r) => ({ studentId: r.studentId, present: r.present })),
        ctx.auth.userId as string,
      );
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutation: transitionHomeworkRecord (one legal lifecycle move)
// ---------------------------------------------------------------------------

builder.mutationField("transitionHomeworkRecord", (t) =>
  t.field({
    type: TransitionResultRef,
    description: "Apply one legal lifecycle transition to a per-student record (timestamped, §3). Write-scope enforced.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      sectionId: t.arg.string({ required: true }),
      recordId: t.arg.string({ required: true }),
      toState: t.arg.string({ required: true }),
      result: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanWrite(ctx, args.sectionId);
      return transitionSvc({
        recordId: args.recordId,
        toState: args.toState,
        result: args.result ?? undefined,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: homeworkItems (daily declaration view — handoff §8.1)
// ---------------------------------------------------------------------------

builder.queryField("homeworkItems", (t) =>
  t.field({
    type: [HomeworkItemRef],
    description: "The day's homework declarations for a class. Read-scope enforced.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      classId: t.arg.string({ required: true }),
      sectionId: t.arg.string({ required: true }),
      dateGiven: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanRead(ctx, args.sectionId, args.classId);
      const docs = await listDailyItems(
        args.classId,
        args.dateGiven ? new Date(args.dateGiven) : undefined,
      );
      return docs.map((d) => ({
        id: d._id.toString(),
        hwId: d.hwId,
        classLevel: d.classLevel,
        subject: d.subject,
        dateGiven: (d.dateGiven as unknown as Date).toISOString(),
        topTags: d.topTags,
        timeDecl: d.timeDecl,
        qCount: d.qCount,
        revItem: d.revItem,
        status: d.status,
      }));
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: homeworkStudentRecords (Layer-B for an item — handoff §8.2)
// ---------------------------------------------------------------------------

builder.queryField("homeworkStudentRecords", (t) =>
  t.field({
    type: [HomeworkStudentRecordRef],
    description: "Per-student lifecycle records for an item. Read-scope enforced.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      itemId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanRead(ctx, args.sectionId, args.classId);
      const docs = await listStudentRecords(args.itemId);
      return docs.map((d) => ({
        id: d._id.toString(),
        hwId: d.hwId,
        studentId: (d.studentId as unknown as { toString(): string }).toString(),
        state: d.state,
        stateDates: (d.stateDates ?? []).map((s) => ({
          state: s.state,
          at: (s.at as unknown as Date).toISOString(),
        })),
        dueDate: d.dueDate ? (d.dueDate as unknown as Date).toISOString() : null,
        chaseCount: d.chaseCount,
        result: d.result ?? null,
      }));
    },
  }),
);

// ===========================================================================
// HW-T2 — daily budget reconciliation (handoff §4)
// ===========================================================================

interface DayItemShape {
  itemId: string;
  hwId: string;
  subject: string;
  timeDecl: number;
  qCount: number;
  revItem: boolean;
  status: string;
  bandWarning: boolean;
}

const DayItemRef = builder.objectRef<DayItemShape>("HomeworkDayItem");
DayItemRef.implement({
  fields: (t) => ({
    itemId: t.exposeString("itemId"),
    hwId: t.exposeString("hwId"),
    subject: t.exposeString("subject"),
    timeDecl: t.exposeInt("timeDecl"),
    qCount: t.exposeInt("qCount"),
    revItem: t.exposeBoolean("revItem"),
    status: t.exposeString("status"),
    bandWarning: t.exposeBoolean("bandWarning"),
  }),
});

interface DayTallyShape {
  classId: string;
  dayTotal: number;
  ceiling: number;
  overBy: number;
  withinCeiling: boolean;
  state: string;
  items: DayItemShape[];
  bandWarnings: string[];
}

const DayTallyRef = builder.objectRef<DayTallyShape>("HomeworkDayTally");
DayTallyRef.implement({
  description: "Live daily budget: DAY_TOTAL vs the 240 ceiling + band warnings (handoff §4.2).",
  fields: (t) => ({
    classId: t.exposeString("classId"),
    dayTotal: t.exposeInt("dayTotal"),
    ceiling: t.exposeInt("ceiling"),
    overBy: t.exposeInt("overBy"),
    withinCeiling: t.exposeBoolean("withinCeiling"),
    state: t.exposeString("state"),
    items: t.field({ type: [DayItemRef], resolve: (r) => r.items }),
    bandWarnings: t.field({ type: ["String"], resolve: (r) => r.bandWarnings }),
  }),
});

interface TrimCandidatesShape {
  rankA: DayItemShape[];
  rankB: DayItemShape[];
  rankC: DayItemShape[];
}

const TrimCandidatesRef = builder.objectRef<TrimCandidatesShape>("HomeworkTrimCandidates");
TrimCandidatesRef.implement({
  description: "Trim candidates pre-ranked ক→খ→গ (handoff §4.4).",
  fields: (t) => ({
    rankA: t.field({ type: [DayItemRef], resolve: (r) => r.rankA }),
    rankB: t.field({ type: [DayItemRef], resolve: (r) => r.rankB }),
    rankC: t.field({ type: [DayItemRef], resolve: (r) => r.rankC }),
  }),
});

interface TrimResultShape {
  hwId: string;
  rank: string;
  trimFrom: number;
  trimTo: number;
  trimMin: number;
  tally: DayTallyShape;
}

const TrimResultRef = builder.objectRef<TrimResultShape>("HomeworkTrimResult");
TrimResultRef.implement({
  fields: (t) => ({
    hwId: t.exposeString("hwId"),
    rank: t.exposeString("rank"),
    trimFrom: t.exposeInt("trimFrom"),
    trimTo: t.exposeInt("trimTo"),
    trimMin: t.exposeInt("trimMin"),
    tally: t.field({ type: DayTallyRef, resolve: (r) => r.tally }),
  }),
});

interface ConfirmResultShape {
  classId: string;
  reconDate: string;
  dayTotal: number;
  ceiling: number;
  reconState: string;
  issuedItems: number;
  issuedRecords: number;
}

const ConfirmResultRef = builder.objectRef<ConfirmResultShape>("HomeworkConfirmResult");
ConfirmResultRef.implement({
  fields: (t) => ({
    classId: t.exposeString("classId"),
    reconDate: t.exposeString("reconDate"),
    dayTotal: t.exposeInt("dayTotal"),
    ceiling: t.exposeInt("ceiling"),
    reconState: t.exposeString("reconState"),
    issuedItems: t.exposeInt("issuedItems"),
    issuedRecords: t.exposeInt("issuedRecords"),
  }),
});

// Query: homeworkDayTally (live DAY_TOTAL + trim candidates) ------------------
builder.queryField("homeworkDayTally", (t) =>
  t.field({
    type: DayTallyRef,
    description: "Live daily budget for a class+day (DAY_TOTAL vs 240). Read-scope enforced.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanRead(ctx, args.sectionId, args.classId);
      return tallyDaySvc(args.classId, new Date(args.date));
    },
  }),
);

builder.queryField("homeworkTrimCandidates", (t) =>
  t.field({
    type: TrimCandidatesRef,
    description: "Trim candidates for an over-ceiling day, pre-ranked ক→খ→গ. Read-scope enforced.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanRead(ctx, args.sectionId, args.classId);
      return trimCandidatesSvc(args.classId, new Date(args.date));
    },
  }),
);

// Mutation: trimHomeworkItem (one logged cut, by count not time) -------------
builder.mutationField("trimHomeworkItem", (t) =>
  t.field({
    type: TrimResultRef,
    description: "Trim a homework item's Q_COUNT (time follows proportionally). Logs a trim row. Write-scope enforced.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
      itemId: t.arg.string({ required: true }),
      newQCount: t.arg.int({ required: true }),
      rank: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertIsClassTeacher(ctx, args.sectionId); // class-teacher-only (handoff §9 / D-#42)
      return applyTrimSvc({
        classId: args.classId,
        date: new Date(args.date),
        itemId: args.itemId,
        newQCount: args.newQCount,
        rank: args.rank,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

// Mutation: confirmHomeworkDay (the ceiling gate + issue) --------------------
builder.mutationField("confirmHomeworkDay", (t) =>
  t.field({
    type: ConfirmResultRef,
    description:
      "Reconcile + issue the day: blocked if DAY_TOTAL > 240 (trim first), else spawns per-student " +
      "records for every declared item. CLASS-TEACHER only (handoff §9 / D-#42).",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
      roster: t.arg({ type: [RosterEntryInput], required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertIsClassTeacher(ctx, args.sectionId); // class-teacher-only (handoff §9 / D-#42)
      return confirmDaySvc({
        classId: args.classId,
        date: new Date(args.date),
        roster: args.roster.map((r) => ({ studentId: r.studentId, present: r.present })),
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);
