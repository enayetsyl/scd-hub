/**
 * homeworkLifecycleReport resolver (D-#300) — the Principal/Office per-subject ×
 * class lifecycle oversight read, five sections in one query (funnel, checking
 * backlog, chase rate columns, declaration consistency, teacher scorecard).
 *
 * Gate: Principal/Office by ROLE (the D-#290 reconciliationReport precedent) —
 * school-wide oversight, not a section-scoped teaching read.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import {
  homeworkLifecycleReport,
  type HwLifecycleReport,
  type HwFunnelRow,
  type HwBacklogRow,
  type HwConsistencyRow,
  type HwTeacherScoreRow,
} from "../services/HomeworkLifecycleReportService";

function assertLifecycleReportAdmin(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role !== "PRINCIPAL" && ctx.auth.role !== "OFFICE") {
    throw new ForbiddenError("লাইফসাইকেল রিপোর্ট শুধুমাত্র অধ্যক্ষ/অফিসের জন্য");
  }
}

const HwFunnelRowRef = builder.objectRef<HwFunnelRow>("HwFunnelRow").implement({
  description: "One (section × subject) lifecycle funnel row (D-#300).",
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    classLevel: t.exposeInt("classLevel"),
    subject: t.exposeString("subject"),
    declaredItems: t.exposeInt("declaredItems"),
    issuedItems: t.exposeInt("issuedItems"),
    given: t.exposeInt("given"),
    submitted: t.exposeInt("submitted"),
    checked: t.exposeInt("checked"),
    returned: t.exposeInt("returned"),
    onTimePct: t.int({ nullable: true, resolve: (r) => r.onTimePct }),
    stuckSubmitted: t.exposeInt("stuckSubmitted"),
    chasedRecords: t.exposeInt("chasedRecords"),
    chases: t.exposeInt("chases"),
    chaseRatePct: t.int({ nullable: true, resolve: (r) => r.chaseRatePct }),
  }),
});

const HwBacklogRowRef = builder.objectRef<HwBacklogRow>("HwBacklogRow").implement({
  description: "Records sitting in SUBMITTED beyond the threshold — the checking backlog (D-#300).",
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    classLevel: t.exposeInt("classLevel"),
    subject: t.exposeString("subject"),
    teacherName: t.string({ nullable: true, resolve: (r) => r.teacherName }),
    count: t.exposeInt("count"),
    oldestDays: t.exposeInt("oldestDays"),
  }),
});

const HwConsistencyRowRef = builder.objectRef<HwConsistencyRow>("HwConsistencyRow").implement({
  description: "Routine-expected days vs declared + nil days per (section × subject) (D-#300).",
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    classLevel: t.exposeInt("classLevel"),
    subject: t.exposeString("subject"),
    routineDays: t.exposeInt("routineDays"),
    declaredDays: t.exposeInt("declaredDays"),
    nilDays: t.exposeInt("nilDays"),
    missedDays: t.exposeInt("missedDays"),
    respondedPct: t.int({ nullable: true, resolve: (r) => r.respondedPct }),
  }),
});

const HwTeacherScoreRowRef = builder.objectRef<HwTeacherScoreRow>("HwTeacherScoreRow").implement({
  description: "Per-teacher homework health scorecard (D-#300). Worst first.",
  fields: (t) => ({
    teacherId: t.exposeString("teacherId"),
    teacherName: t.exposeString("teacherName"),
    declaredItems: t.exposeInt("declaredItems"),
    nilDays: t.exposeInt("nilDays"),
    missedDeclarations: t.exposeInt("missedDeclarations"),
    onTimePct: t.int({ nullable: true, resolve: (r) => r.onTimePct }),
    avgCheckLatencyDays: t.float({ nullable: true, resolve: (r) => r.avgCheckLatencyDays }),
    avgReturnLatencyDays: t.float({ nullable: true, resolve: (r) => r.avgReturnLatencyDays }),
    chases: t.exposeInt("chases"),
    wrongRatePct: t.int({ nullable: true, resolve: (r) => r.wrongRatePct }),
  }),
});

const HwLifecycleReportRef = builder.objectRef<HwLifecycleReport>("HwLifecycleReport").implement({
  description:
    "The homework lifecycle report (D-#300): funnel + checking backlog + chase columns + " +
    "declaration consistency + teacher scorecard, per subject × class. Principal/Office only.",
  fields: (t) => ({
    fromKey: t.exposeString("fromKey"),
    toKey: t.exposeString("toKey"),
    backlogThresholdDays: t.exposeInt("backlogThresholdDays"),
    funnel: t.field({ type: [HwFunnelRowRef], resolve: (r) => r.funnel }),
    backlog: t.field({ type: [HwBacklogRowRef], resolve: (r) => r.backlog }),
    consistency: t.field({ type: [HwConsistencyRowRef], resolve: (r) => r.consistency }),
    scorecard: t.field({ type: [HwTeacherScoreRowRef], resolve: (r) => r.scorecard }),
  }),
});

builder.queryField("homeworkLifecycleReport", (t) =>
  t.field({
    type: HwLifecycleReportRef,
    description: "Per subject × class homework lifecycle monitoring (Principal/Office).",
    authScopes: { authenticated: true },
    args: {
      from: t.arg.string({ required: true }),
      to: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      assertLifecycleReportAdmin(ctx);
      return homeworkLifecycleReport(args.from, args.to);
    },
  }),
);
