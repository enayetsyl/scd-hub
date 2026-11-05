/**
 * Staff mistake record (D-#936–#939, docs/prd-staff-mistakes.md).
 *
 *   myStaffMistakes        own entries (staff_mistakes:view_own, SELF)
 *   explainStaffMistake    own entry: a reason button + optional text (SELF)
 *   staffMistakes          anyone's entries / one staff file (staff_mistakes:view_all)
 *   staffMistakeQueue      entries waiting for a decision, minus the caller's own (review)
 *   decideStaffMistake     excuse / count / move (review)
 *   staffMistakeMoveTargets  the move picker (review)
 *   MR-2 (D-#940–#942, #1005): myStaffWarning / acknowledgeStaffWarning / myStaffWarnings (SELF),
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
  decideMistake,
  explainMistake,
  listMoveTargets,
  listStaffMistakes,
  type StaffMistakeShape,
} from "../services/StaffMistakeService";
import type { StaffMistakeRung, StaffMistakeSettingsShape } from "@scd/shared";
import { getStaffMistakeSettings, setStaffMistakeSettings } from "../services/StaffMistakeSettingsService";
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

type Row = StaffMistakeShape & { markNote: MarkCorrectionNoteShape | null };

/** Attach each entry's source detail in one batch per kind. */
async function withDetail(rows: StaffMistakeShape[]): Promise<Row[]> {
  const notes = await markCorrectionNotesByIds(
    rows.filter((r) => r.kind === "MARK_CORRECTION").map((r) => r.sourceId),
  );
  return rows.map((r) => ({ ...r, markNote: r.kind === "MARK_CORRECTION" ? (notes.get(r.sourceId) ?? null) : null }));
}

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
    resolve: async (_r, args) => {
      if (args.staffUserId) return withDetail(await listStaffMistakes({ staffUserId: args.staffUserId }));
      if (args.staffProfileId) {
        const target = await resolveUserIdForStaff(args.staffProfileId);
        if (!target) return [];
        return withDetail(await listStaffMistakes({ staffUserId: target }));
      }
      return withDetail(await listStaffMistakes({}));
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
          excludeStaffUserId: ctx.auth!.userId,
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
    resolve: () => listMoveTargets(),
  }),
);

// ---------------------------------------------------------------------------
// MR-2 (D-#940–#942, #1005): the warning ladder, meetings, the summary and the rules
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
    resolve: (_r, args) => listWarnings(args.staffUserId),
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
    resolve: (_r, args, ctx) => scheduleMeeting({ warningId: args.id, actorId: ctx.auth!.userId, at: args.at, place: args.place }),
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
    resolve: (_r, args) => staffMistakeSummary(args.days ?? 30),
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
