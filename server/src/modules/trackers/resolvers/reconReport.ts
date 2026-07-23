/**
 * reconciliationReport resolver — the Principal/Office "who didn't reconcile?"
 * oversight read (D-#290). Homework misses are per (class, day); assignment
 * misses per (section, week) — each tracker's natural confirm cadence. Rows name
 * the accountable confirmer (homework delegate ?? class teacher).
 *
 * Gate: Principal/Office by ROLE (the assertFollowUpAdmin precedent, D-#88) —
 * this is school-wide oversight, not a section-scoped teaching read, and OFFICE
 * holds no tracker:read.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import {
  reconciliationReport,
  type ReconReport,
  type HwReconMiss,
  type AsReconMiss,
  type HwNotDeclared,
  type HwNilDeclared,
  type AsNilDeclared,
  type AsNotDeclared,
} from "../services/ReconReportService";

function assertReconReportAdmin(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role !== "PRINCIPAL" && ctx.auth.role !== "OFFICE") {
    throw new ForbiddenError("রিকনসিলিয়েশন রিপোর্ট শুধুমাত্র অধ্যক্ষ/অফিসের জন্য");
  }
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
  }),
});

builder.queryField("reconciliationReport", (t) =>
  t.field({
    type: ReconReportRef,
    description: "Per-day homework + per-week assignment reconciliation misses (Principal/Office).",
    authScopes: { authenticated: true },
    args: {
      from: t.arg.string({ required: true }),
      to: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      assertReconReportAdmin(ctx);
      return reconciliationReport(args.from, args.to);
    },
  }),
);
