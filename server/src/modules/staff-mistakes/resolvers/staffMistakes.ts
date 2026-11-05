/**
 * Staff mistake record (D-#936–#939, docs/prd-staff-mistakes.md).
 *
 *   myStaffMistakes        own entries (staff_mistakes:view_own, SELF)
 *   explainStaffMistake    own entry: a reason button + optional text (SELF)
 *   staffMistakes          anyone's entries / one staff file (staff_mistakes:view_all)
 *   staffMistakeQueue      entries waiting for a decision, minus the caller's own (review)
 *   decideStaffMistake     excuse / count / move (review)
 *   staffMistakeMoveTargets  the move picker (review)
 *   MR-2 (D-#940–#943): myStaffWarning / acknowledgeStaffWarning / myStaffWarnings (SELF),
 *   staffWarnings + staffMistakeSummary + staffMistakeSettings (view_all), schedule/record a
 *   warning meeting (meetings), setStaffMistakeSettings (settings)
 *
 * Each entry carries the source's detail: the নম্বর জমায় ভুল note for MARK_CORRECTION.
 */
import { builder } from "../../../schema";
import { resolveUserIdForStaff } from "../../hr/services/staffMatch";
import { NoteRef } from "../../trackers/resolvers/markSubmission";
import { markCorrectionNotesByIds, type MarkCorrectionNoteShape } from "../../trackers/services/MarkCorrectionService";
import {
  attendanceCorrectionNotesByIds,
  type AttendanceCorrectionNoteShape,
} from "../../attendance/services/AttendanceCorrectionService";
import {
  classTestCorrectionNotesByIds,
  type ClassTestCorrectionNoteShape,
} from "../../trackers/services/ClassTestCorrectionService";
import { claimDetailsByIds, revertDetailsByIds, type WorkMistakeDetailShape } from "../../trackers/services/WorkMistakeService";
import { staffMistakeNotesByIds, type StaffMistakeNoteShape } from "../services/StaffMistakeNoteService";
import {
  decideMistake,
  explainMistake,
  listMoveTargets,
  listStaffMistakes,
  type StaffMistakeShape,
} from "../services/StaffMistakeService";
import type { StaffMistakeRung, StaffMistakeSettingsShape } from "@scd/shared";
import { getStaffMistakeSettings, setStaffMistakeSettings } from "../services/StaffMistakeSettingsService";
import { callerHasPermission } from "@scd/shared";
import { hiddenOwnersFor, ownedByPrincipal, PRINCIPAL_REVIEW } from "../services/principalPrivacy";

/** D-#974: may this caller see / decide the Principal's own entries? */
const mayHandlePrincipal = (ctx: { auth?: Parameters<typeof callerHasPermission>[0] | null }): boolean =>
  !!ctx.auth && callerHasPermission(ctx.auth, PRINCIPAL_REVIEW);
import {
  acknowledgeWarning,
  listWarnings,
  myOpenWarning,
  recordMeeting,
  scheduleMeeting,
  staffMistakeSummary,
  type MistakeSummary,
  type MistakeSummaryRow,
  type StaffWarningShape,
  type WarningMistakeLine,
} from "../services/StaffWarningService";

type Row = StaffMistakeShape & {
  markNote: MarkCorrectionNoteShape | null;
  attendanceNote: AttendanceCorrectionNoteShape | null;
  classTestNote: ClassTestCorrectionNoteShape | null;
  workNote: WorkMistakeDetailShape | null;
  genericNote: StaffMistakeNoteShape | null;
};

/** Kinds with a source model of their own; every other kind is a generic StaffMistakeNote (D-#954). */
const SPECIFIC_KINDS = new Set(["MARK_CORRECTION", "ATTENDANCE_CORRECTION", "CLASS_TEST_MARKS", "CLASS_TEST_SCRIPTS", "WORK_CLAIM_ACCEPTED", "WORK_REVERT"]);
const isGeneric = (kind: string): boolean => !SPECIFIC_KINDS.has(kind);

const idsOf = (rows: StaffMistakeShape[], kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.sourceId);

/** Attach each entry's source detail in one batch per kind. */
async function withDetail(rows: StaffMistakeShape[]): Promise<Row[]> {
  const [marks, attendance, classTests, claims, reverts, generic] = await Promise.all([
    markCorrectionNotesByIds(idsOf(rows, "MARK_CORRECTION")),
    attendanceCorrectionNotesByIds(idsOf(rows, "ATTENDANCE_CORRECTION")),
    classTestCorrectionNotesByIds([...idsOf(rows, "CLASS_TEST_MARKS"), ...idsOf(rows, "CLASS_TEST_SCRIPTS")]),
    claimDetailsByIds(idsOf(rows, "WORK_CLAIM_ACCEPTED")),
    revertDetailsByIds(idsOf(rows, "WORK_REVERT")),
    staffMistakeNotesByIds(rows.filter((r) => isGeneric(r.kind)).map((r) => r.sourceId)),
  ]);
  return rows.map((r) => ({
    ...r,
    markNote: r.kind === "MARK_CORRECTION" ? (marks.get(r.sourceId) ?? null) : null,
    attendanceNote: r.kind === "ATTENDANCE_CORRECTION" ? (attendance.get(r.sourceId) ?? null) : null,
    classTestNote: r.kind === "CLASS_TEST_MARKS" || r.kind === "CLASS_TEST_SCRIPTS" ? (classTests.get(r.sourceId) ?? null) : null,
    workNote:
      r.kind === "WORK_CLAIM_ACCEPTED" ? (claims.get(r.sourceId) ?? null) : r.kind === "WORK_REVERT" ? (reverts.get(r.sourceId) ?? null) : null,
    genericNote: isGeneric(r.kind) ? (generic.get(r.sourceId) ?? null) : null,
  }));
}

const AttendanceChangeRef = builder
  .objectRef<AttendanceCorrectionNoteShape["changes"][number]>("AttendanceCorrectionChange")
  .implement({
    fields: (t) => ({
      studentId: t.exposeString("studentId"),
      studentName: t.exposeString("studentName"),
      from: t.exposeString("from"),
      to: t.exposeString("to"),
      at: t.string({ resolve: (c) => new Date(c.at).toISOString() }),
      byName: t.exposeString("byName"),
    }),
  });

const ClassTestChangeRef = builder
  .objectRef<ClassTestCorrectionNoteShape["changes"][number]>("ClassTestCorrectionChange")
  .implement({
    fields: (t) => ({
      studentName: t.exposeString("studentName"),
      fromMarks: t.float({ nullable: true, resolve: (c) => c.fromMarks }),
      toMarks: t.float({ nullable: true, resolve: (c) => c.toMarks }),
      fromStatus: t.string({ nullable: true, resolve: (c) => c.fromStatus }),
      toStatus: t.string({ nullable: true, resolve: (c) => c.toStatus }),
      at: t.string({ resolve: (c) => new Date(c.at).toISOString() }),
      byName: t.exposeString("byName"),
    }),
  });

const ClassTestNoteRef = builder.objectRef<ClassTestCorrectionNoteShape>("ClassTestCorrectionNote").implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    kind: t.exposeString("kind"),
    ctId: t.exposeString("ctId"),
    subject: t.exposeString("subject"),
    testNumber: t.exposeInt("testNumber"),
    totalMarks: t.exposeFloat("totalMarks"),
    changes: t.field({ type: [ClassTestChangeRef], resolve: (n) => n.changes }),
  }),
});

const GenericLineRef = builder.objectRef<StaffMistakeNoteShape["lines"][number]>("StaffMistakeNoteLine").implement({
  fields: (t) => ({
    text: t.exposeString("text"),
    at: t.string({ resolve: (l) => new Date(l.at).toISOString() }),
    byName: t.exposeString("byName"),
  }),
});

const GenericNoteRef = builder.objectRef<StaffMistakeNoteShape>("StaffMistakeNote").implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    lines: t.field({ type: [GenericLineRef], resolve: (n) => n.lines }),
  }),
});

const WorkStateRef = builder.objectRef<{ state: string; at: Date }>("WorkMistakeState").implement({
  fields: (t) => ({
    state: t.exposeString("state"),
    at: t.string({ resolve: (s) => new Date(s.at).toISOString() }),
  }),
});

const WorkNoteRef = builder.objectRef<WorkMistakeDetailShape>("WorkMistakeDetail").implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    tracker: t.exposeString("tracker"),
    itemCode: t.exposeString("itemCode"),
    subject: t.string({ nullable: true, resolve: (n) => n.subject }),
    studentName: t.exposeString("studentName"),
    claimedAt: t.string({ nullable: true, resolve: (n) => iso(n.claimedAt) }),
    claimNote: t.string({ nullable: true, resolve: (n) => n.claimNote }),
    states: t.field({ type: [WorkStateRef], resolve: (n) => n.states }),
    byName: t.exposeString("byName"),
  }),
});

const AttendanceNoteRef = builder.objectRef<AttendanceCorrectionNoteShape>("AttendanceCorrectionNote").implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    unitLabel: t.exposeString("unitLabel"),
    dateKey: t.exposeString("dateKey"),
    changes: t.field({ type: [AttendanceChangeRef], resolve: (n) => n.changes }),
  }),
});

const iso = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);

const StaffMistakeRef = builder.objectRef<Row>("StaffMistake").implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    staffUserId: t.exposeString("staffUserId"),
    staffName: t.exposeString("staffName"),
    kind: t.exposeString("kind"),
    tier: t.exposeInt("tier"),
    dateKey: t.exposeString("dateKey"),
    status: t.exposeString("status"),
    reasonCode: t.string({ nullable: true, resolve: (r) => r.reasonCode }),
    reasonText: t.string({ nullable: true, resolve: (r) => r.reasonText }),
    explainedAt: t.string({ nullable: true, resolve: (r) => iso(r.explainedAt) }),
    explainDueAt: t.string({ resolve: (r) => new Date(r.explainDueAt).toISOString() }),
    autoCounted: t.exposeBoolean("autoCounted"),
    decidedByName: t.string({ nullable: true, resolve: (r) => r.decidedByName }),
    decidedAt: t.string({ nullable: true, resolve: (r) => iso(r.decidedAt) }),
    decisionNote: t.string({ nullable: true, resolve: (r) => r.decisionNote }),
    movedFromName: t.string({ nullable: true, resolve: (r) => r.movedFromName }),
    movedToName: t.string({ nullable: true, resolve: (r) => r.movedToName }),
    createdAt: t.string({ resolve: (r) => new Date(r.createdAt).toISOString() }),
    markNote: t.field({ type: NoteRef, nullable: true, resolve: (r) => r.markNote }),
    attendanceNote: t.field({ type: AttendanceNoteRef, nullable: true, resolve: (r) => r.attendanceNote }),
    classTestNote: t.field({ type: ClassTestNoteRef, nullable: true, resolve: (r) => r.classTestNote }),
    workNote: t.field({ type: WorkNoteRef, nullable: true, resolve: (r) => r.workNote }),
    genericNote: t.field({ type: GenericNoteRef, nullable: true, resolve: (r) => r.genericNote }),
  }),
});

const MoveTargetRef = builder.objectRef<{ userId: string; name: string }>("StaffMistakeMoveTarget").implement({
  fields: (t) => ({
    userId: t.exposeString("userId"),
    name: t.exposeString("name"),
  }),
});

builder.queryField("myStaffMistakes", (t) =>
  t.field({
    type: [StaffMistakeRef],
    authScopes: { hasPermission: "staff_mistakes:view_own" },
    resolve: async (_r, _a, ctx) => withDetail(await listStaffMistakes({ staffUserId: ctx.auth!.userId })),
  }),
);

builder.mutationField("explainStaffMistake", (t) =>
  t.field({
    type: StaffMistakeRef,
    authScopes: { hasPermission: "staff_mistakes:view_own" },
    args: {
      id: t.arg.string({ required: true }),
      reasonCode: t.arg.string({ required: true }),
      reasonText: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      const self = ctx.auth!.userId;
      await explainMistake({ mistakeId: args.id, actorId: self, reasonCode: args.reasonCode, reasonText: args.reasonText ?? "" });
      const rows = await listStaffMistakes({ staffUserId: self });
      const row = rows.find((r) => r.id === args.id);
      if (!row) throw new Error("এন্ট্রিটি পাওয়া যায়নি।");
      return (await withDetail([row]))[0]!;
    },
  }),
);

builder.queryField("staffMistakes", (t) =>
  t.field({
    type: [StaffMistakeRef],
    // One staff file (staffProfileId) or the whole school.
    authScopes: { hasPermission: "staff_mistakes:view_all" },
    args: { staffProfileId: t.arg.string({ required: false }), staffUserId: t.arg.string({ required: false }) },
    resolve: async (_r, args, ctx) => {
      const hideStaffUserIds = await hiddenOwnersFor(mayHandlePrincipal(ctx));
      if (args.staffUserId) return withDetail(await listStaffMistakes({ staffUserId: args.staffUserId, hideStaffUserIds }));
      if (args.staffProfileId) {
        const target = await resolveUserIdForStaff(args.staffProfileId);
        if (!target) return [];
        return withDetail(await listStaffMistakes({ staffUserId: target, hideStaffUserIds }));
      }
      return withDetail(await listStaffMistakes({ hideStaffUserIds }));
    },
  }),
);

builder.queryField("staffMistakeQueue", (t) =>
  t.field({
    type: [StaffMistakeRef],
    authScopes: { hasPermission: "staff_mistakes:review" },
    resolve: async (_r, _a, ctx) =>
      withDetail(
        await listStaffMistakes({
          statuses: ["PENDING_REVIEW", "EXPLANATION_DUE"],
          // A Principal reviews their own entries too (D-#974); Office never sees a Principal's.
          excludeStaffUserId: mayHandlePrincipal(ctx) && (await ownedByPrincipal(ctx.auth!.userId)) ? null : ctx.auth!.userId,
          hideStaffUserIds: await hiddenOwnersFor(mayHandlePrincipal(ctx)),
        }),
      ),
  }),
);

builder.mutationField("decideStaffMistake", (t) =>
  t.field({
    type: StaffMistakeRef,
    authScopes: { hasPermission: "staff_mistakes:review" },
    args: {
      id: t.arg.string({ required: true }),
      decision: t.arg.string({ required: true }),
      note: t.arg.string({ required: false }),
      moveToUserId: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      const row = await decideMistake({
        mistakeId: args.id,
        actorId: ctx.auth!.userId,
        actorRole: ctx.auth!.role,
        mayHandlePrincipal: mayHandlePrincipal(ctx),
        decision: args.decision,
        note: args.note,
        moveToUserId: args.moveToUserId,
      });
      const rows = await listStaffMistakes({ staffUserId: row.staffUserId.toString() });
      const shaped = rows.find((r) => r.id === args.id);
      if (!shaped) throw new Error("এন্ট্রিটি পাওয়া যায়নি।");
      return (await withDetail([shaped]))[0]!;
    },
  }),
);

builder.queryField("staffMistakeMoveTargets", (t) =>
  t.field({
    type: [MoveTargetRef],
    authScopes: { hasPermission: "staff_mistakes:review" },
    resolve: (_r, _a, ctx) => listMoveTargets(mayHandlePrincipal(ctx)),
  }),
);

// ---------------------------------------------------------------------------
// MR-2 (D-#940–#943): the warning ladder, meetings, the summary and the rules
// ---------------------------------------------------------------------------

const WarningMistakeRef = builder.objectRef<WarningMistakeLine>("StaffWarningMistake").implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    kind: t.exposeString("kind"),
    tier: t.exposeInt("tier"),
  }),
});

const StaffWarningRef = builder.objectRef<StaffWarningShape>("StaffWarning").implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    staffUserId: t.exposeString("staffUserId"),
    staffName: t.exposeString("staffName"),
    step: t.exposeString("step"),
    threshold: t.exposeInt("threshold"),
    windowDays: t.exposeInt("windowDays"),
    weightedCount: t.exposeFloat("weightedCount"),
    mistakes: t.field({ type: [WarningMistakeRef], resolve: (w) => w.mistakes }),
    acknowledgedAt: t.string({ nullable: true, resolve: (w) => iso(w.acknowledgedAt) }),
    otherTimeAskedAt: t.string({ nullable: true, resolve: (w) => iso(w.otherTimeAskedAt) }),
    meetingAt: t.string({ nullable: true, resolve: (w) => iso(w.meetingAt) }),
    meetingPlace: t.string({ nullable: true, resolve: (w) => w.meetingPlace }),
    meetingSetByName: t.string({ nullable: true, resolve: (w) => w.meetingSetByName }),
    meetingHeldAt: t.string({ nullable: true, resolve: (w) => iso(w.meetingHeldAt) }),
    meetingRecordedByName: t.string({ nullable: true, resolve: (w) => w.meetingRecordedByName }),
    meetingWho: t.string({ nullable: true, resolve: (w) => w.meetingWho }),
    meetingDiscussion: t.string({ nullable: true, resolve: (w) => w.meetingDiscussion }),
    meetingActions: t.string({ nullable: true, resolve: (w) => w.meetingActions }),
    followUpDateKey: t.string({ nullable: true, resolve: (w) => w.followUpDateKey }),
    createdAt: t.string({ resolve: (w) => new Date(w.createdAt).toISOString() }),
  }),
});

const SummaryRowRef = builder.objectRef<MistakeSummaryRow>("StaffMistakeSummaryRow").implement({
  fields: (t) => ({
    staffUserId: t.exposeString("staffUserId"),
    staffName: t.exposeString("staffName"),
    counted: t.exposeInt("counted"),
    weighted: t.exposeFloat("weighted"),
    pending: t.exposeInt("pending"),
    excused: t.exposeInt("excused"),
    topKind: t.string({ nullable: true, resolve: (r) => r.topKind }),
    warningStep: t.string({ nullable: true, resolve: (r) => r.warningStep }),
    meetingAt: t.string({ nullable: true, resolve: (r) => iso(r.meetingAt) }),
    nextThreshold: t.exposeInt("nextThreshold"),
  }),
});

const KindCountRef = builder.objectRef<{ kind: string; counted: number }>("StaffMistakeKindCount").implement({
  fields: (t) => ({ kind: t.exposeString("kind"), counted: t.exposeInt("counted") }),
});

const SummaryTotalsRef = builder.objectRef<MistakeSummary["totals"]>("StaffMistakeSummaryTotals").implement({
  fields: (t) => ({
    counted: t.exposeInt("counted"),
    pending: t.exposeInt("pending"),
    excused: t.exposeInt("excused"),
    warnings: t.exposeInt("warnings"),
  }),
});

const SummaryRef = builder.objectRef<MistakeSummary>("StaffMistakeSummary").implement({
  fields: (t) => ({
    days: t.exposeInt("days"),
    rows: t.field({ type: [SummaryRowRef], resolve: (s) => s.rows }),
    byKind: t.field({ type: [KindCountRef], resolve: (s) => s.byKind }),
    totals: t.field({ type: SummaryTotalsRef, resolve: (s) => s.totals }),
  }),
});

const RungRef = builder.objectRef<StaffMistakeRung>("StaffMistakeRung").implement({
  fields: (t) => ({
    step: t.exposeString("step"),
    count: t.exposeInt("count"),
    windowDays: t.exposeInt("windowDays"),
  }),
});

const SettingsRef = builder.objectRef<StaffMistakeSettingsShape>("StaffMistakeSettings").implement({
  fields: (t) => ({
    rungs: t.field({ type: [RungRef], resolve: (s) => s.rungs }),
    tier1Weight: t.float({ resolve: (s) => s.tierWeights[1] }),
    tier2Weight: t.float({ resolve: (s) => s.tierWeights[2] }),
    tier3Weight: t.float({ resolve: (s) => s.tierWeights[3] }),
    deadline: t.exposeString("deadline"),
    disabledKinds: t.exposeStringList("disabledKinds"),
  }),
});

const RungInput = builder.inputType("StaffMistakeRungInput", {
  fields: (t) => ({
    step: t.string({ required: true }),
    count: t.int({ required: true }),
    windowDays: t.int({ required: true }),
  }),
});

builder.queryField("myStaffWarning", (t) =>
  t.field({
    type: StaffWarningRef,
    nullable: true,
    authScopes: { hasPermission: "staff_mistakes:view_own" },
    resolve: (_r, _a, ctx) => myOpenWarning(ctx.auth!.userId),
  }),
);

builder.mutationField("acknowledgeStaffWarning", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "staff_mistakes:view_own" },
    args: { id: t.arg.string({ required: true }), otherTime: t.arg.boolean({ required: false }) },
    resolve: (_r, args, ctx) => acknowledgeWarning({ warningId: args.id, userId: ctx.auth!.userId, otherTime: !!args.otherTime }),
  }),
);

builder.queryField("myStaffWarnings", (t) =>
  t.field({
    type: [StaffWarningRef],
    authScopes: { hasPermission: "staff_mistakes:view_own" },
    resolve: (_r, _a, ctx) => listWarnings(ctx.auth!.userId),
  }),
);

builder.queryField("staffWarnings", (t) =>
  t.field({
    type: [StaffWarningRef],
    authScopes: { hasPermission: "staff_mistakes:view_all" },
    args: { staffUserId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) =>
      (await hiddenOwnersFor(mayHandlePrincipal(ctx))).includes(args.staffUserId) ? [] : listWarnings(args.staffUserId),
  }),
);

builder.mutationField("scheduleStaffWarningMeeting", (t) =>
  t.field({
    type: StaffWarningRef,
    authScopes: { hasPermission: "staff_mistakes:meetings" },
    args: {
      id: t.arg.string({ required: true }),
      at: t.arg.string({ required: true }),
      place: t.arg.string({ required: true }),
    },
    resolve: (_r, args, ctx) => scheduleMeeting({ warningId: args.id, actorId: ctx.auth!.userId, mayHandlePrincipal: mayHandlePrincipal(ctx), at: args.at, place: args.place }),
  }),
);

builder.mutationField("recordStaffWarningMeeting", (t) =>
  t.field({
    type: StaffWarningRef,
    authScopes: { hasPermission: "staff_mistakes:meetings" },
    args: {
      id: t.arg.string({ required: true }),
      who: t.arg.string({ required: false }),
      discussion: t.arg.string({ required: true }),
      actions: t.arg.string({ required: false }),
      followUpDateKey: t.arg.string({ required: false }),
      sendSummary: t.arg.boolean({ required: false }),
    },
    resolve: (_r, args, ctx) =>
      recordMeeting({
        warningId: args.id,
        actorId: ctx.auth!.userId,
        mayHandlePrincipal: mayHandlePrincipal(ctx),
        who: args.who ?? "",
        discussion: args.discussion,
        actions: args.actions ?? "",
        followUpDateKey: args.followUpDateKey,
        sendSummary: !!args.sendSummary,
      }),
  }),
);

builder.queryField("staffMistakeSummary", (t) =>
  t.field({
    type: SummaryRef,
    authScopes: { hasPermission: "staff_mistakes:view_all" },
    args: { days: t.arg.int({ required: false }) },
    resolve: async (_r, args, ctx) => staffMistakeSummary(args.days ?? 30, new Date(), await hiddenOwnersFor(mayHandlePrincipal(ctx))),
  }),
);

builder.queryField("staffMistakeSettings", (t) =>
  t.field({
    type: SettingsRef,
    // Reviewers read the rules they work under; only `settings` writes them.
    authScopes: { hasPermission: "staff_mistakes:view_all" },
    resolve: () => getStaffMistakeSettings(),
  }),
);

builder.mutationField("setStaffMistakeSettings", (t) =>
  t.field({
    type: SettingsRef,
    authScopes: { hasPermission: "staff_mistakes:settings" },
    args: {
      rungs: t.arg({ type: [RungInput], required: true }),
      tier1Weight: t.arg.float({ required: true }),
      tier2Weight: t.arg.float({ required: true }),
      tier3Weight: t.arg.float({ required: true }),
      deadline: t.arg.string({ required: true }),
      disabledKinds: t.arg.stringList({ required: true }),
    },
    resolve: (_r, args, ctx) =>
      setStaffMistakeSettings(
        {
          rungs: args.rungs.map((r) => ({ step: r.step as StaffMistakeRung["step"], count: r.count, windowDays: r.windowDays })),
          tierWeights: { 1: args.tier1Weight, 2: args.tier2Weight, 3: args.tier3Weight },
          deadline: args.deadline as StaffMistakeSettingsShape["deadline"],
          disabledKinds: args.disabledKinds,
        },
        ctx.auth!.userId,
      ),
  }),
);
