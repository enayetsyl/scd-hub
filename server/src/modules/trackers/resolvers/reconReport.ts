/**
 * reconciliationReport resolver — the Principal/Office "who didn't reconcile?"
 * oversight read (D-#290). Homework misses are per (class, day); assignment
 * misses per (section, week) — each tracker's natural confirm cadence. Rows name
 * the accountable confirmer (homework delegate ?? class teacher).
 *
 * Gate: any-of `homework:view_reports` / `assignment:view_reports` (PM; Principal/Office by
 * default, the assertFollowUpAdmin precedent, D-#88) —
 * this is school-wide oversight, not a section-scoped teaching read, and OFFICE
 * holds no tracker:read.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission, type Permission } from "@scd/shared";
import {
  reconciliationReport,
  type ReconReport,
  type HwReconMiss,
  type AsReconMiss,
  type HwNotDeclared,
  type HwNilDeclared,
  type AsNilDeclared,
  type AsNotDeclared,
  type AsNotPrinted,
} from "../services/ReconReportService";

/** One payload serves six Reports-hub leaves (D-#846). Each part opens on its own report switch
 *  (or the combined reconciliation one); the printing desk keeps the print-gap part it uses on the
 *  print screen. Parts the caller was not given come back EMPTY, so a teacher handed one report
 *  never receives the rest. */
const RECON_PART_GATES = {
  hwNotDeclared: ["reports:hw_declare_pending", "reports:reconciliation"],
  hwNilDeclared: ["reports:hw_declare_pending", "reports:reconciliation"],
  hwMisses: ["reports:hw_issue_pending", "reports:reconciliation"],
  asNotDeclared: ["reports:as_declare_pending", "reports:reconciliation"],
  asNilDeclared: ["reports:as_declare_pending", "reports:reconciliation"],
  asMisses: ["reports:as_deliver_pending", "reports:reconciliation"],
  asNotPrinted: ["reports:as_print_pending", "reports:reconciliation", "printing:view_all"],
} as const satisfies Record<string, readonly Permission[]>;
const RECON_ANY: Permission[] = [...new Set(Object.values(RECON_PART_GATES).flat())];

function assertReconReportAdmin(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!RECON_ANY.some((p) => callerHasPermission(ctx.auth!, p))) {
    throw new ForbiddenError("এই রিপোর্ট দেখার অনুমতি নেই");
  }
}

function filterReconParts<T extends Record<keyof typeof RECON_PART_GATES, unknown[]>>(ctx: AppContext, report: T): T {
  const out = { ...report };
  for (const [part, perms] of Object.entries(RECON_PART_GATES) as [keyof typeof RECON_PART_GATES, readonly Permission[]][]) {
    if (!perms.some((p) => callerHasPermission(ctx.auth!, p))) (out as Record<string, unknown[]>)[part] = [];
  }
  return out;
}

const HwReconMissRef = builder.objectRef<HwReconMiss>("HwReconMiss").implement({
  description: "One (class, day) with declared-but-unconfirmed homework — no per-student records exist.",
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    sectionId: t.exposeString("sectionId"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    classLevel: t.exposeInt("classLevel"),
    confirmerName: t.string({ nullable: true, resolve: (r) => r.confirmerName }),
    declaredItems: t.exposeInt("declaredItems"),
    declaredMinutes: t.exposeInt("declaredMinutes"),
  }),
});

const AsReconMissRef = builder.objectRef<AsReconMiss>("AsReconMiss").implement({
  description: "One (section, week) with delivered-but-unconfirmed (DRAFT) assignment items.",
  fields: (t) => ({
    weekNumber: t.exposeInt("weekNumber"),
    deliveryDateKey: t.exposeString("deliveryDateKey"),
    sectionId: t.exposeString("sectionId"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    classLevel: t.exposeInt("classLevel"),
    confirmerName: t.string({ nullable: true, resolve: (r) => r.confirmerName }),
    draftItems: t.exposeInt("draftItems"),
    draftMinutes: t.exposeInt("draftMinutes"),
  }),
});

const HwNotDeclaredRef = builder.objectRef<HwNotDeclared>("HwNotDeclared").implement({
  description:
    "One (class, subject, day) where the subject had routine periods but declared NO homework " +
    "at all (D-#293) — named with the routine's subject teacher, who owes the declaration.",
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    sectionId: t.exposeString("sectionId"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    classLevel: t.exposeInt("classLevel"),
    subject: t.exposeString("subject"),
    teacherName: t.string({ nullable: true, resolve: (r) => r.teacherName }),
  }),
});

const HwNilDeclaredRef = builder.objectRef<HwNilDeclared>("HwNilDeclared").implement({
  description:
    "One explicit 'no homework today' declaration (D-#299) — deliberately none, with the " +
    "teacher's reason; the neutral counterpart of HwNotDeclared.",
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    sectionId: t.exposeString("sectionId"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    classLevel: t.exposeInt("classLevel"),
    subject: t.exposeString("subject"),
    teacherName: t.string({ nullable: true, resolve: (r) => r.teacherName }),
    reason: t.exposeString("reason"),
  }),
});

const AsNotDeclaredRef = builder.objectRef<AsNotDeclared>("AsNotDeclared").implement({
  description:
    "One (section, subject, week) the AssignmentSchedule rotation expected but nobody DECLARED " +
    "(D-#309) — named with the rotation entry's teacher; reports once the week's delivery date passes.",
  fields: (t) => ({
    weekNumber: t.exposeInt("weekNumber"),
    weekStartKey: t.exposeString("weekStartKey"),
    deliveryDateKey: t.string({ nullable: true, resolve: (r) => r.deliveryDateKey }),
    sectionId: t.exposeString("sectionId"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    classLevel: t.exposeInt("classLevel"),
    subject: t.exposeString("subject"),
    teacherName: t.string({ nullable: true, resolve: (r) => r.teacherName }),
  }),
});

const AsNilDeclaredRef = builder.objectRef<AsNilDeclared>("AsNilDeclared").implement({
  description: "One explicit 'no assignment this week' declaration with reason.",
  fields: (t) => ({
    weekNumber: t.exposeInt("weekNumber"),
    weekStartKey: t.exposeString("weekStartKey"),
    deliveryDateKey: t.exposeString("deliveryDateKey"),
    sectionId: t.exposeString("sectionId"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    classLevel: t.exposeInt("classLevel"),
    subject: t.exposeString("subject"),
    teacherName: t.string({ nullable: true, resolve: (r) => r.teacherName }),
    reason: t.exposeString("reason"),
  }),
});

const AsNotPrintedRef = builder.objectRef<AsNotPrinted>("AsNotPrinted").implement({
  description:
    "One (section, subject, week) the AssignmentSchedule rotation expected but with no matching " +
    "ASSIGNMENT print request for that delivery date (D-#459). Only a DECLARED cell owes a print, " +
    "and one request serves every section of its class for that subject (owner ruling 2026-10-01).",
  fields: (t) => ({
    weekNumber: t.exposeInt("weekNumber"),
    weekStartKey: t.exposeString("weekStartKey"),
    deliveryDateKey: t.string({ nullable: true, resolve: (r) => r.deliveryDateKey }),
    sectionId: t.exposeString("sectionId"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    classLevel: t.exposeInt("classLevel"),
    subject: t.exposeString("subject"),
    teacherName: t.string({ nullable: true, resolve: (r) => r.teacherName }),
  }),
});

const ReconReportRef = builder.objectRef<ReconReport>("ReconciliationReport").implement({
  description:
    "Who didn't submit reconciliation (D-#290): homework per day, assignments per week, " +
    "each naming the accountable confirmer — plus homework never declared per class × subject " +
    "(D-#293). Principal/Office only.",
  fields: (t) => ({
    fromKey: t.exposeString("fromKey"),
    toKey: t.exposeString("toKey"),
    hwMisses: t.field({ type: [HwReconMissRef], resolve: (r) => r.hwMisses }),
    asMisses: t.field({ type: [AsReconMissRef], resolve: (r) => r.asMisses }),
    hwNotDeclared: t.field({ type: [HwNotDeclaredRef], resolve: (r) => r.hwNotDeclared }),
    hwNilDeclared: t.field({ type: [HwNilDeclaredRef], resolve: (r) => r.hwNilDeclared }),
    asNilDeclared: t.field({ type: [AsNilDeclaredRef], resolve: (r) => r.asNilDeclared }),
    asNotDeclared: t.field({ type: [AsNotDeclaredRef], resolve: (r) => r.asNotDeclared }),
    asNotPrinted: t.field({ type: [AsNotPrintedRef], resolve: (r) => r.asNotPrinted }),
  }),
});

builder.queryField("reconciliationReport", (t) =>
  t.field({
    type: ReconReportRef,
    description: "Per-day homework + per-week assignment reconciliation misses (Principal/Office).",
    authScopes: { hasAnyPermission: RECON_ANY },
    args: {
      from: t.arg.string({ required: true }),
      to: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      assertReconReportAdmin(ctx);
      return filterReconParts(ctx, await reconciliationReport(args.from, args.to));
    },
  }),
);
