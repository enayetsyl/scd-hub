/**
 * homeworkLifecycleReport + homeworkLifecyclePending resolvers — the Principal/
 * Office homework oversight reads, REDESIGNED teacher-first (D-#350, supersedes
 * the D-#300 five-card layout):
 *   - homeworkLifecycleReport: a filterable (date range + class + subject)
 *     per-teacher lifecycle table + the red checking backlog.
 *   - homeworkLifecyclePending: the drill-down behind a pending number — the
 *     named students stuck at that stage, with guardian phone to chase.
 *
 * Gate: Principal/Office by ROLE (the D-#290 reconciliationReport precedent) —
 * school-wide oversight, not a section-scoped teaching read.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import {
  homeworkLifecycleReport,
  homeworkLifecyclePending,
  isHwPendingStage,
  type HwLifecycleReport,
  type HwTeacherLifecycleRow,
  type HwBacklogRow,
  type HwPendingStudent,
} from "../services/HomeworkLifecycleReportService";

function assertLifecycleReportAdmin(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role !== "PRINCIPAL" && ctx.auth.role !== "OFFICE") {
    throw new ForbiddenError("লাইফসাইকেল রিপোর্ট শুধুমাত্র অধ্যক্ষ/অফিসের জন্য");
  }
}

/** A zeroed row for a teacher with no attributed items in range. */
function emptyRow(teacherId: string, teacherName: string): HwTeacherLifecycleRow {
  return {
    teacherId,
    teacherName,
    declaredItems: 0, issuedItems: 0, given: 0, submitted: 0, checked: 0, returned: 0,
    pendingSubmission: 0, pendingChecking: 0, pendingReturn: 0, chasedPending: 0,
  };
}

const HwTeacherLifecycleRowRef = builder.objectRef<HwTeacherLifecycleRow>("HwTeacherLifecycleRow").implement({
  description: "One teacher's homework lifecycle counts + pending buckets (D-#350).",
  fields: (t) => ({
    teacherId: t.exposeString("teacherId"),
    teacherName: t.exposeString("teacherName"),
    declaredItems: t.exposeInt("declaredItems"),
    issuedItems: t.exposeInt("issuedItems"),
    given: t.exposeInt("given"),
    submitted: t.exposeInt("submitted"),
    checked: t.exposeInt("checked"),
    returned: t.exposeInt("returned"),
    pendingSubmission: t.exposeInt("pendingSubmission"),
    pendingChecking: t.exposeInt("pendingChecking"),
    pendingReturn: t.exposeInt("pendingReturn"),
    chasedPending: t.exposeInt("chasedPending"),
  }),
});

const HwBacklogRowRef = builder.objectRef<HwBacklogRow>("HwBacklogRow").implement({
  description: "Records sitting in SUBMITTED beyond the threshold — the checking backlog (D-#300/#350).",
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

const HwPendingStudentRef = builder.objectRef<HwPendingStudent>("HwPendingStudent").implement({
  description: "A named student stuck at a lifecycle stage — the pending drill-down (D-#350).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    nameBn: t.string({ nullable: true, resolve: (r) => r.nameBn }),
    rollNumber: t.string({ nullable: true, resolve: (r) => r.rollNumber }),
    sectionNameBn: t.string({ nullable: true, resolve: (r) => r.sectionNameBn }),
    classLevel: t.exposeInt("classLevel"),
    subject: t.exposeString("subject"),
    guardianPhone: t.string({ nullable: true, resolve: (r) => r.guardianPhone }),
    state: t.exposeString("state"),
    daysWaiting: t.exposeInt("daysWaiting"),
    chaseCount: t.exposeInt("chaseCount"),
    // Grouping + navigation for the drill sheet (owner ask 2026-08-04).
    hwItemId: t.exposeString("hwItemId"),
    dateGiven: t.exposeString("dateGiven"),
    sectionId: t.exposeString("sectionId"),
    classId: t.exposeString("classId"),
  }),
});

const HwLifecycleReportRef = builder.objectRef<HwLifecycleReport>("HwLifecycleReport").implement({
  description:
    "The homework lifecycle report (D-#350): per-teacher lifecycle table + the checking backlog, " +
    "filterable by date range / class / subject. Principal/Office only.",
  fields: (t) => ({
    fromKey: t.exposeString("fromKey"),
    toKey: t.exposeString("toKey"),
    backlogThresholdDays: t.exposeInt("backlogThresholdDays"),
    teachers: t.field({ type: [HwTeacherLifecycleRowRef], resolve: (r) => r.teachers }),
    backlog: t.field({ type: [HwBacklogRowRef], resolve: (r) => r.backlog }),
  }),
});

builder.queryField("homeworkLifecycleReport", (t) =>
  t.field({
    type: HwLifecycleReportRef,
    description: "Per-teacher homework lifecycle monitoring, filterable (Principal/Office).",
    authScopes: { authenticated: true },
    args: {
      from: t.arg.string({ required: true }),
      to: t.arg.string({ required: true }),
      classLevel: t.arg.int({ required: false }),
      subject: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertLifecycleReportAdmin(ctx);
      return homeworkLifecycleReport(args.from, args.to, {
        classLevel: args.classLevel ?? null,
        subject: args.subject ?? null,
      });
    },
  }),
);

builder.queryField("homeworkLifecyclePending", (t) =>
  t.field({
    type: [HwPendingStudentRef],
    description:
      "The named students stuck at one teacher's pending stage — the drill-down behind a pending number. " +
      "Principal/Office for any teacher; a teacher may drill their OWN pending (teacherId = self, D-#340 SELF pattern).",
    authScopes: { authenticated: true },
    args: {
      from: t.arg.string({ required: true }),
      to: t.arg.string({ required: true }),
      teacherId: t.arg.string({ required: true }),
      stage: t.arg.string({ required: true }),
      classLevel: t.arg.int({ required: false }),
      subject: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      // SELF-scope: a teacher may drill their own pending; anyone else needs admin.
      if (args.teacherId !== ctx.auth.userId) assertLifecycleReportAdmin(ctx);
      if (!isHwPendingStage(args.stage)) {
        throw new ForbiddenError(`অজানা ধাপ: ${args.stage}`);
      }
      return homeworkLifecyclePending(args.from, args.to, args.teacherId, args.stage, {
        classLevel: args.classLevel ?? null,
        subject: args.subject ?? null,
      });
    },
  }),
);

builder.queryField("myHomeworkLifecycle", (t) =>
  t.field({
    type: HwTeacherLifecycleRowRef,
    description:
      "The CALLER's own homework lifecycle row (totals + pending buckets), self-scoped — the teacher-" +
      "dashboard card (owner 2026-07-25). Attribution is the routine subject teacher (D-#351), so a " +
      "Principal's on-behalf entries land in the accountable teacher's own card.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      from: t.arg.string({ required: true }),
      to: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const me = ctx.auth.userId as string;
      const report = await homeworkLifecycleReport(args.from, args.to, {});
      return report.teachers.find((r) => r.teacherId === me) ?? emptyRow(me, me);
    },
  }),
);
