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
import { LIFECYCLE_STATES } from "@scd/shared";
import type { LifecycleState } from "@scd/shared";
import { builder } from "../../../schema";
import {
  declareHomeworkItem as declareSvc,
  issueHomeworkItem as issueSvc,
  transitionRecord as transitionSvc,
  listDailyItems,
  listStudentRecords,
  listOpenRecords,
  listHomeworkTopics,
  type OpenRecordDTO,
} from "../services/HomeworkService";
import {
  tallyDay as tallyDaySvc,
  getTrimCandidates as trimCandidatesSvc,
  applyTrim as applyTrimSvc,
  confirmHomeworkDay as confirmDaySvc,
} from "../services/HomeworkReconciliationService";
import {
  checkRecord as checkRecordSvc,
  getStudentDayLoad as studentDayLoadSvc,
} from "../services/HomeworkResubmissionService";
import {
  homeworkSummary as homeworkSummarySvc,
  homeworkClassOverview as classOverviewSvc,
  resubmissionWatchList as watchListSvc,
  trimPatternFlags as trimPatternSvc,
  questionUsageFeed as usageFeedSvc,
  type ClassOverviewResult,
} from "../services/HomeworkSummaryService";
import {
  assertCanWrite,
  assertCanRead,
  assertCanConfirmHomework,
  ForbiddenError,
} from "../../../middleware/authz";
import { Subject } from "../../foundation/models/Subject";
import { HomeworkItem } from "../models/HomeworkItem";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";

async function resolveSubjectId(subject: string): Promise<string> {
  const doc = await Subject.findOne({ code: subject }).select("_id").lean();
  if (!doc) throw new Error(`Subject not found: ${subject}`);
  return doc._id.toString();
}

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
  /** StoredFile id of the attached question file (GP-A) — null when none. */
  questionFileId?: string | null;
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
    questionFileId: t.string({ nullable: true, resolve: (r) => r.questionFileId ?? null }),
  }),
});

interface HomeworkTopicChapterShape {
  num: number;
  titleBn: string;
}
interface HomeworkTopicShape {
  id: string;
  code: string;
  labelBn: string;
  classLevel: number;
  subject: string;
  chapters: HomeworkTopicChapterShape[];
  order: number;
}

const HomeworkTopicChapterRef = builder.objectRef<HomeworkTopicChapterShape>("HomeworkTopicChapter");
HomeworkTopicChapterRef.implement({
  fields: (t) => ({
    num: t.exposeInt("num"),
    titleBn: t.exposeString("titleBn"),
  }),
});

const HomeworkTopicRef = builder.objectRef<HomeworkTopicShape>("HomeworkTopic");
HomeworkTopicRef.implement({
  description: "A pickable homework topic for one (subject, class) — groups curriculum chapters under one tag.",
  fields: (t) => ({
    id: t.exposeString("id"),
    code: t.exposeString("code"),
    labelBn: t.exposeString("labelBn"),
    classLevel: t.exposeInt("classLevel"),
    subject: t.exposeString("subject"),
    chapters: t.field({ type: [HomeworkTopicChapterRef], resolve: (r) => r.chapters }),
    order: t.exposeInt("order"),
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
  /** StoredFile id of the attached checked-answer file (GP-A) — null when none. */
  answerFileId?: string | null;
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
    answerFileId: t.string({ nullable: true, resolve: (r) => r.answerFileId ?? null }),
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
      await assertCanWrite(ctx, args.sectionId, await resolveSubjectId(args.subject));
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
      "Write-scope enforced. HW-T2 will gate this behind the daily 120-min reconciliation.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      sectionId: t.arg.string({ required: true }),
      itemId: t.arg.string({ required: true }),
      roster: t.arg({ type: [RosterEntryInput], required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const item = await HomeworkItem.findById(args.itemId).select("subject").lean();
      await assertCanWrite(ctx, args.sectionId, item?.subject ? await resolveSubjectId(item.subject) : undefined);
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
      const record = await HomeworkStudentRecord.findById(args.recordId).select("hwItemId").lean();
      const item = record ? await HomeworkItem.findById(record.hwItemId).select("subject").lean() : null;
      await assertCanWrite(ctx, args.sectionId, item?.subject ? await resolveSubjectId(item.subject) : undefined);
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
        questionFileId: d.questionFileId ? d.questionFileId.toString() : null,
      }));
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: homeworkTopics (the per-subject+class topic picker for declaration)
// ---------------------------------------------------------------------------

builder.queryField("homeworkTopics", (t) =>
  t.field({
    type: [HomeworkTopicRef],
    description: "Pickable topics for a (subject, class) — the catalog a teacher chooses topTags from.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      subject: t.arg.string({ required: true }),
      classLevel: t.arg.int({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return listHomeworkTopics(args.subject, args.classLevel);
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
        answerFileId: d.answerFileId ? d.answerFileId.toString() : null,
      }));
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: homeworkOpenRecords (auto-listed pending work, grouped by date client-side)
// ---------------------------------------------------------------------------

const OpenRecordRef = builder.objectRef<OpenRecordDTO>("HomeworkOpenRecord");
OpenRecordRef.implement({
  description:
    "A section's open lifecycle record across all dates, enriched with the item's subject + given-date " +
    "and the student's name — the row the date-grouped Checking queue / Records screens render.",
  fields: (t) => ({
    id: t.exposeString("id"),
    hwId: t.exposeString("hwId"),
    subject: t.exposeString("subject"),
    topicLabelBn: t.exposeString("topicLabelBn"),
    dateGiven: t.exposeString("dateGiven"),
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    state: t.exposeString("state"),
    chaseCount: t.exposeInt("chaseCount"),
    hasAnswerFile: t.exposeBoolean("hasAnswerFile"),
    dueDate: t.string({ nullable: true, resolve: (r) => r.dueDate }),
  }),
});

builder.queryField("homeworkOpenRecords", (t) =>
  t.field({
    type: [OpenRecordRef],
    description:
      "All of a section's lifecycle records in the given states, across all dates (newest given-date first), " +
      "for the auto-listed date-grouped Checking queue (states [SUBMITTED]) / Records screens. Read-scope enforced.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      states: t.arg.stringList({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanRead(ctx, args.sectionId, args.classId);
      const states = args.states.filter((s): s is LifecycleState =>
        (LIFECYCLE_STATES as readonly string[]).includes(s),
      );
      return listOpenRecords(args.sectionId, states);
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
  topicLabelBn: string;
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
    topicLabelBn: t.exposeString("topicLabelBn"),
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
  description: "Live daily budget: DAY_TOTAL vs the 120 ceiling + band warnings (handoff §4.2).",
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
// Read access for the reconcile screen: anyone authorized to CONFIRM the day (class
// teacher, per-section delegate, school-wide supervisor, Principal) may also view it —
// they don't necessarily hold ordinary teaching read-scope for that section. Falls back
// to normal read-scope for everyone else (subject teachers viewing their own class).
async function assertCanViewHomeworkDay(
  ctx: Parameters<typeof assertCanConfirmHomework>[0],
  sectionId: string,
  classId: string,
): Promise<void> {
  try {
    await assertCanConfirmHomework(ctx, sectionId);
    return;
  } catch {
    /* not a confirmer — fall back to ordinary read scope below */
  }
  await assertCanRead(ctx, sectionId, classId);
}

builder.queryField("homeworkDayTally", (t) =>
  t.field({
    type: DayTallyRef,
    description: "Live daily budget for a class+day (DAY_TOTAL vs 120). Read- or confirm-scope enforced.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanViewHomeworkDay(ctx, args.sectionId, args.classId);
      return tallyDaySvc(args.classId, new Date(args.date));
    },
  }),
);

builder.queryField("homeworkTrimCandidates", (t) =>
  t.field({
    type: TrimCandidatesRef,
    description: "Trim candidates for an over-ceiling day, pre-ranked ক→খ→গ. Read- or confirm-scope enforced.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanViewHomeworkDay(ctx, args.sectionId, args.classId);
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
      await assertCanConfirmHomework(ctx, args.sectionId); // class teacher, delegate, or Principal
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
      "Reconcile + issue the day: blocked if DAY_TOTAL > 120 (trim first), else spawns per-student " +
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
      await assertCanConfirmHomework(ctx, args.sectionId); // class teacher, delegate, or Principal
      return confirmDaySvc({
        classId: args.classId,
        date: new Date(args.date),
        roster: args.roster.map((r) => ({ studentId: r.studentId, present: r.present })),
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

// ===========================================================================
// HW-T3 — checking, resubmission spawn + Pool top-up (handoff §5)
// ===========================================================================

interface ResubSpawnShape {
  recordId: string;
  hwId: string;
  state: string;
  topupFlag: boolean;
  topupQids: string[];
  topupTime: number | null;
  dueDate: string | null;
}

const ResubSpawnRef = builder.objectRef<ResubSpawnShape>("HomeworkResubmission");
ResubSpawnRef.implement({
  description: "A spawned resubmission record — same HW_ID, its own 1→6 pass (handoff §5.4).",
  fields: (t) => ({
    recordId: t.exposeString("recordId"),
    hwId: t.exposeString("hwId"),
    state: t.exposeString("state"),
    topupFlag: t.exposeBoolean("topupFlag"),
    topupQids: t.field({ type: ["String"], resolve: (r) => r.topupQids }),
    topupTime: t.int({ nullable: true, resolve: (r) => r.topupTime }),
    dueDate: t.string({ nullable: true, resolve: (r) => r.dueDate }),
  }),
});

interface CheckResultShape {
  recordId: string;
  hwId: string;
  state: string;
  result: string;
  resubmission: ResubSpawnShape | null;
}

const CheckResultRef = builder.objectRef<CheckResultShape>("HomeworkCheckResult");
CheckResultRef.implement({
  fields: (t) => ({
    recordId: t.exposeString("recordId"),
    hwId: t.exposeString("hwId"),
    state: t.exposeString("state"),
    result: t.exposeString("result"),
    resubmission: t.field({ type: ResubSpawnRef, nullable: true, resolve: (r) => r.resubmission }),
  }),
});

interface StudentDayLoadShape {
  studentId: string;
  classId: string;
  baseMinutes: number;
  topupMinutes: number;
  totalMinutes: number;
  ceiling: number;
  overCeiling: boolean;
}

const StudentDayLoadRef = builder.objectRef<StudentDayLoadShape>("StudentDayLoad");
StudentDayLoadRef.implement({
  description: "A child's personal day-load incl. TOPUP_TIME (handoff §5.3) — a top-up may push them over.",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    classId: t.exposeString("classId"),
    baseMinutes: t.exposeInt("baseMinutes"),
    topupMinutes: t.exposeInt("topupMinutes"),
    totalMinutes: t.exposeInt("totalMinutes"),
    ceiling: t.exposeInt("ceiling"),
    overCeiling: t.exposeBoolean("overCeiling"),
  }),
});

// Mutation: checkHomeworkRecord (record RESULT; WRONG auto-spawns a resubmission) --
builder.mutationField("checkHomeworkRecord", (t) =>
  t.field({
    type: CheckResultRef,
    description:
      "Check a submitted record: record RESULT (CORRECT/PARTIAL/WRONG). WRONG auto-spawns a same-HW_ID " +
      "resubmission; PARTIAL spawns only if resubmit=true. Optional Pool top-up (reactive only). " +
      "Subject-teacher write-scope (handoff §9).",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      sectionId: t.arg.string({ required: true }),
      recordId: t.arg.string({ required: true }),
      result: t.arg.string({ required: true }),
      resubmit: t.arg.boolean({ required: false }),
      topupQids: t.arg({ type: ["String"], required: false }),
      topupTime: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const record = await HomeworkStudentRecord.findById(args.recordId).select("hwItemId").lean();
      const item = record ? await HomeworkItem.findById(record.hwItemId).select("subject").lean() : null;
      await assertCanWrite(ctx, args.sectionId, item?.subject ? await resolveSubjectId(item.subject) : undefined);
      const topup =
        args.topupQids && args.topupQids.length > 0
          ? { qids: [...args.topupQids], time: args.topupTime ?? 0 }
          : undefined;
      return checkRecordSvc({
        recordId: args.recordId,
        result: args.result,
        resubmit: args.resubmit ?? undefined,
        topup,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

// Query: studentDayLoad (the child's personal load incl. top-ups, §5.3 / T3.4) ----
builder.queryField("studentDayLoad", (t) =>
  t.field({
    type: StudentDayLoadRef,
    description: "A student's personal homework day-load including top-up minutes. Read-scope enforced.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanRead(ctx, args.sectionId, args.classId);
      return studentDayLoadSvc(args.classId, args.studentId, new Date(args.date));
    },
  }),
);

// ===========================================================================
// HW-T4 — roll-ups + thresholds + question-usage feed (handoff §7/§8)
// ===========================================================================

interface ChaseEntryShape {
  recordId: string;
  hwId: string;
  studentId: string;
  chaseCount: number;
  attention: boolean;
  commsPrompt: boolean;
}
const ChaseEntryRef = builder.objectRef<ChaseEntryShape>("HomeworkChaseEntry");
ChaseEntryRef.implement({
  fields: (t) => ({
    recordId: t.exposeString("recordId"),
    hwId: t.exposeString("hwId"),
    studentId: t.exposeString("studentId"),
    chaseCount: t.exposeInt("chaseCount"),
    attention: t.exposeBoolean("attention"),
    commsPrompt: t.exposeBoolean("commsPrompt"),
  }),
});

interface TopicTouchShape {
  topTag: string;
  count: number;
}
const TopicTouchRef = builder.objectRef<TopicTouchShape>("HomeworkTopicTouch");
TopicTouchRef.implement({
  fields: (t) => ({
    topTag: t.exposeString("topTag"),
    count: t.exposeInt("count"),
  }),
});

interface HomeworkSummaryShape {
  classId: string;
  chaseList: ChaseEntryShape[];
  attentionCount: number;
  commsPromptCount: number;
  openResubmissions: number;
  pendingChecking: number;
  submittedOnTimePct: number | null;
  chaseVolume: number;
  avgReturnLatencyDays: number | null;
  topicTouches: TopicTouchShape[];
}
const HomeworkSummaryRef = builder.objectRef<HomeworkSummaryShape>("HomeworkSummary");
HomeworkSummaryRef.implement({
  description: "Roll-up for the Master/principal dashboard (handoff §8.1/§8.3).",
  fields: (t) => ({
    classId: t.exposeString("classId"),
    chaseList: t.field({ type: [ChaseEntryRef], resolve: (r) => r.chaseList }),
    attentionCount: t.exposeInt("attentionCount"),
    commsPromptCount: t.exposeInt("commsPromptCount"),
    openResubmissions: t.exposeInt("openResubmissions"),
    pendingChecking: t.exposeInt("pendingChecking"),
    submittedOnTimePct: t.int({ nullable: true, resolve: (r) => r.submittedOnTimePct }),
    chaseVolume: t.exposeInt("chaseVolume"),
    avgReturnLatencyDays: t.float({ nullable: true, resolve: (r) => r.avgReturnLatencyDays }),
    topicTouches: t.field({ type: [TopicTouchRef], resolve: (r) => r.topicTouches }),
  }),
});

interface WatchEntryShape {
  studentId: string;
  resubmissionCount: number;
}
const WatchEntryRef = builder.objectRef<WatchEntryShape>("HomeworkWatchEntry");
WatchEntryRef.implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    resubmissionCount: t.exposeInt("resubmissionCount"),
  }),
});

interface WatchListShape {
  classId: string;
  threshold: number;
  windowDays: number;
  watchList: WatchEntryShape[];
}
const WatchListRef = builder.objectRef<WatchListShape>("HomeworkWatchList");
WatchListRef.implement({
  description: "Students with ≥3 open/recent resubmissions in a rolling 2-week window (§7.3).",
  fields: (t) => ({
    classId: t.exposeString("classId"),
    threshold: t.exposeInt("threshold"),
    windowDays: t.exposeInt("windowDays"),
    watchList: t.field({ type: [WatchEntryRef], resolve: (r) => r.watchList }),
  }),
});

interface TrimFlagShape {
  subject: string;
  trimmedDays: number;
  schoolDays: number;
  ratio: number;
  flagged: boolean;
}
const TrimFlagRef = builder.objectRef<TrimFlagShape>("HomeworkTrimFlag");
TrimFlagRef.implement({
  fields: (t) => ({
    subject: t.exposeString("subject"),
    trimmedDays: t.exposeInt("trimmedDays"),
    schoolDays: t.exposeInt("schoolDays"),
    ratio: t.exposeFloat("ratio"),
    flagged: t.exposeBoolean("flagged"),
  }),
});

interface TrimPatternShape {
  classId: string;
  schoolDays: number;
  threshold: number;
  flags: TrimFlagShape[];
}
const TrimPatternRef = builder.objectRef<TrimPatternShape>("HomeworkTrimPattern");
TrimPatternRef.implement({
  description: "Per-subject trim-pattern flags for a month (>30% of school days → flagged, §7.4).",
  fields: (t) => ({
    classId: t.exposeString("classId"),
    schoolDays: t.exposeInt("schoolDays"),
    threshold: t.exposeFloat("threshold"),
    flags: t.field({ type: [TrimFlagRef], resolve: (r) => r.flags }),
  }),
});

interface UsageEntryShape {
  qid: string;
  count: number;
}
const UsageEntryRef = builder.objectRef<UsageEntryShape>("QuestionUsageEntry");
UsageEntryRef.implement({
  fields: (t) => ({
    qid: t.exposeString("qid"),
    count: t.exposeInt("count"),
  }),
});

interface QuestionUsageShape {
  classId: string;
  feed: UsageEntryShape[];
}
const QuestionUsageRef = builder.objectRef<QuestionUsageShape>("QuestionUsageFeed");
QuestionUsageRef.implement({
  description: "De-identified per-question Pool usage counts (§8.4) — no student identity (ADR-005).",
  fields: (t) => ({
    classId: t.exposeString("classId"),
    feed: t.field({ type: [UsageEntryRef], resolve: (r) => r.feed }),
  }),
});

// Query: homeworkSummary (the trackerSummary roll-up) ------------------------
builder.queryField("homeworkSummary", (t) =>
  t.field({
    type: HomeworkSummaryRef,
    description: "Homework roll-up for a class: chase list + thresholds, open resubmissions, completion health, topic touches. Read-scope enforced.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanViewHomeworkDay(ctx, args.sectionId, args.classId);
      return homeworkSummarySvc(args.classId);
    },
  }),
);

// Query: homeworkClassOverview (per-class cumulative dashboard badges) -------
const HomeworkClassRefInput = builder.inputType("HomeworkClassRefInput", {
  fields: (t) => ({
    classId: t.string({ required: true }),
    sectionId: t.string({ required: true }),
  }),
});

const ClassOverviewRef = builder.objectRef<ClassOverviewResult>("HomeworkClassOverview");
ClassOverviewRef.implement({
  description: "Per-class cumulative homework counts for the dashboard badges (pending checking / chases / resubmissions / on-time% / over-ceiling days this week).",
  fields: (t) => ({
    classId: t.exposeString("classId"),
    pendingChecking: t.exposeInt("pendingChecking"),
    openResubmissions: t.exposeInt("openResubmissions"),
    activeChases: t.exposeInt("activeChases"),
    onTimePct: t.int({ nullable: true, resolve: (r) => r.onTimePct }),
    overCeilingDaysThisWeek: t.exposeInt("overCeilingDaysThisWeek"),
  }),
});

builder.queryField("homeworkClassOverview", (t) =>
  t.field({
    type: [ClassOverviewRef],
    description:
      "Per-class cumulative homework counts for the dashboard. Each (classId, sectionId) ref is " +
      "authorized via read-scope; refs the caller cannot read are silently skipped. Requires tracker:read.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      refs: t.arg({ type: [HomeworkClassRefInput], required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const authorized: string[] = [];
      for (const ref of args.refs) {
        try {
          await assertCanViewHomeworkDay(ctx, ref.sectionId, ref.classId);
          authorized.push(ref.classId);
        } catch {
          // A stale/over-broad ref must not break the whole dashboard — skip it.
        }
      }
      return classOverviewSvc(authorized, Date.now());
    },
  }),
);

// Query: homeworkWatchList (resubmission watch-list, §7.3) -------------------
builder.queryField("homeworkWatchList", (t) =>
  t.field({
    type: WatchListRef,
    description: "Students with ≥3 open/recent resubmissions in a rolling 2-week window (§7.3). Read-scope enforced.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanRead(ctx, args.sectionId, args.classId);
      return watchListSvc(args.classId, Date.now());
    },
  }),
);

// Query: homeworkTrimPattern (trim-pattern flags for a month, §7.4) ----------
builder.queryField("homeworkTrimPattern", (t) =>
  t.field({
    type: TrimPatternRef,
    description: "Per-subject trim-pattern flags over a date range (month). Read-scope enforced.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      from: t.arg.string({ required: true }),
      to: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanRead(ctx, args.sectionId, args.classId);
      return trimPatternSvc(args.classId, new Date(args.from).getTime(), new Date(args.to).getTime());
    },
  }),
);

// Query: questionUsageFeed (de-identified Pool usage, §8.4) ------------------
builder.queryField("questionUsageFeed", (t) =>
  t.field({
    type: QuestionUsageRef,
    description: "De-identified per-question Pool usage counts for a class (§8.4). Read-scope enforced.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanRead(ctx, args.sectionId, args.classId);
      return usageFeedSvc(args.classId);
    },
  }),
);
