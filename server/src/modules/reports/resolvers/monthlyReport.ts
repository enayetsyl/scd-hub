/**
 * Monthly-report resolvers (MR-5/MR-6, prd-monthly-report §4/§7).
 *
 * THE GATE, in one place:
 *
 *   staff read   assertReportRead(ctx, sectionId) — Principal/Office unscoped, a
 *                teacher needs read scope on the child's own section — then the SP-1
 *                subject narrowing. A narrowed caller gets a NARROWED VIEW: other
 *                subjects' rows are stripped, the fee block is removed, and the AI
 *                paragraph is not returned at all (§4). A cross-subject paragraph
 *                written from subjects the reader may not see is worse than none.
 *   release      `report:release` (Principal + Office). The three overrides —
 *                coverage block, revoke, hard-lock reopen — are PRINCIPAL-ONLY BY
 *                ROLE (D-#397), so AC-1 can hand the Office release without the
 *                overrides.
 *   guardian     RELEASED revisions of their OWN child only, over the existing
 *                guardian link gate. No staff field is reachable from that path.
 *
 * The frozen snapshot travels as JSON (the `payloadJson` precedent): it is a versioned
 * DOCUMENT, and typing it in the schema would freeze its shape a second time.
 */
import type { Types } from "mongoose";
import { callerHasPermission, type Role } from "@scd/shared";
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import {
  ForbiddenError,
  allowedSubjectCodesForSection,
  assertGuardianOfStudent,
} from "../../../middleware/authz";
import { assertReportRead } from "../../trackers/resolvers/classTestSummary";
import { Section } from "../../foundation/models/Section";
import { Student } from "../../foundation/models/Student";
import { MonthlyReport, type IMonthlyReport } from "../models/MonthlyReport";
import {
  bulkReleaseMonthlyReports,
  buildSectionMonthlyReports,
  draftMonthlyComment,
  draftMonthlyCommentsSequentially,
  releaseMonthlyReport,
  releaseVerdictOf,
  lockStateOf,
  reviewMonthlyReport,
  revokeMonthlyReport,
  revokeReleaseBatch,
  monthlyClassRollup,
  type ClassRollup,
} from "../services/MonthlyReportService";
import {
  monthlyPendingWork,
  monthlyTeacherChase,
  type TeacherChase,
  type MonthlyPendingWork,
  type PendingClassTest,
  type PendingGroup,
  type PendingRow,
} from "../services/MonthlyPendingWorkService";
import {
  readMonthlyReportConfig,
  setMonthlyReportConfig,
  type MonthlyReportConfigShape,
} from "../services/MonthlyReportConfigService";

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

function assertRelease(ctx: AppContext): { isPrincipal: boolean; actorId: string } {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const role = ctx.auth.role as Role;
  if (!callerHasPermission(ctx.auth, "report:release") || (role !== "PRINCIPAL" && role !== "OFFICE")) {
    throw new ForbiddenError("মাসিক রিপোর্ট প্রকাশ অফিস/অধ্যক্ষের কাজ");
  }
  return { isPrincipal: role === "PRINCIPAL", actorId: ctx.auth.userId as string };
}

/** The Principal-only powers (D-#397): override, revoke, reopen. */
function assertPrincipal(ctx: AppContext, what: string): string {
  const { isPrincipal, actorId } = assertRelease(ctx);
  if (!isPrincipal) throw new ForbiddenError(`${what} শুধু অধ্যক্ষ করতে পারেন`);
  return actorId;
}

/** Staff read + the SP-1 narrowing, resolved from the report's own student. */
async function assertStaffReportRead(
  ctx: AppContext,
  report: Pick<IMonthlyReport, "sectionId" | "classId">,
): Promise<{ subjects: string[] | null; isTeacher: boolean }> {
  await assertReportRead(ctx, report.sectionId.toString());
  const allowed = await allowedSubjectCodesForSection(
    ctx,
    report.sectionId.toString(),
    report.classId.toString(),
    { classTeacherOversight: true },
  );
  return {
    subjects: allowed === null ? null : [...allowed],
    isTeacher: (ctx.auth?.role as Role) === "TEACHER",
  };
}

// ---------------------------------------------------------------------------
// The narrowed view (§4)
// ---------------------------------------------------------------------------

export interface ReportView {
  report: IMonthlyReport;
  /** The child, so a reviewer reads a name rather than an id fragment. */
  studentName: string;
  rollNumber: string | null;
  fullView: boolean;
  subjectFilter: string[];
  /** Suppressed entirely on a narrowed view, and on the guardian path until released. */
  comment: string | null;
  commentDraft: string | null;
  snapshotJson: string;
  lockState: string;
  releasable: boolean;
  blockedReason: string | null;
  requiresPrincipal: boolean;
}

/**
 * PURE. Strip a frozen snapshot down to what this caller may see.
 *
 * Three removals, each with a reason:
 *   - per-subject rows outside the caller's own subjects (§4);
 *   - the fee block, which teachers never see (D-#401);
 *   - the cohort's `best` figures are left alone — they are already anonymous
 *     numbers, suppressed at compute time in a small section (D-#396).
 */
export function narrowSnapshot(
  snapshot: Record<string, unknown>,
  subjects: string[] | null,
  opts: { hideFees: boolean },
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(snapshot ?? {})) as Record<string, unknown>;
  const metrics = clone.metrics as Record<string, unknown> | undefined;
  if (!metrics) return clone;

  if (opts.hideFees) delete metrics.fees;

  if (subjects) {
    const keep = new Set(subjects);
    for (const stream of ["homework", "assignment", "classTest"]) {
      const block = metrics[stream] as { bySubject?: Array<{ subject: string }> } | undefined;
      if (block?.bySubject) block.bySubject = block.bySubject.filter((r) => keep.has(r.subject));
    }
    // The previous month's block feeds the trend chips, which are cross-subject by
    // nature; a narrowed caller keeps the chips but not the other subjects' rows.
    const prev = clone.previous as Record<string, unknown> | undefined;
    if (prev) {
      for (const stream of ["homework", "assignment", "classTest"]) {
        const block = prev[stream] as { bySubject?: Array<{ subject: string }> } | undefined;
        if (block?.bySubject) block.bySubject = block.bySubject.filter((r) => keep.has(r.subject));
      }
    }
  }
  return clone;
}

async function viewOf(
  report: IMonthlyReport,
  subjects: string[] | null,
  isTeacher: boolean,
  isPrincipal: boolean,
  student?: { name: string; nameBn?: string; rollNumber?: string } | null,
): Promise<ReportView> {
  const cfg = await readMonthlyReportConfig();
  // Loaded by the caller for a list (one query for the section, not one per row);
  // fetched here for a single report.
  const child =
    student ??
    ((await Student.findById(report.studentId).select("name nameBn rollNumber").lean()) as unknown as
      | { name: string; nameBn?: string; rollNumber?: string }
      | null);
  const lock = lockStateOf(report.periodKey, new Date(), cfg);
  const verdict = releaseVerdictOf(report, lock, isPrincipal);
  const fullView = subjects === null;
  return {
    report,
    studentName: child?.nameBn || child?.name || "",
    rollNumber: child?.rollNumber ?? null,
    fullView,
    subjectFilter: subjects ?? [],
    // §4: no AI paragraph on a narrowed view.
    comment: fullView ? report.commentFinal ?? null : null,
    commentDraft: fullView ? report.commentDraft?.text ?? null : null,
    snapshotJson: JSON.stringify(
      narrowSnapshot(report.snapshot, subjects, { hideFees: isTeacher }),
    ),
    lockState: lock,
    releasable: verdict.allowed,
    blockedReason: verdict.reason,
    requiresPrincipal: verdict.requiresPrincipal,
  };
}

// ---------------------------------------------------------------------------
// GraphQL types
// ---------------------------------------------------------------------------

const ReportRef = builder.objectRef<ReportView>("MonthlyReport").implement({
  description:
    "ONE REVISION of one child's month. A released revision is immutable — later data becomes " +
    "revision N+1, and the family keeps seeing this one until someone releases that (D-#393).",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.report._id.toString() }),
    studentId: t.string({ resolve: (v) => v.report.studentId.toString() }),
    studentName: t.exposeString("studentName"),
    rollNumber: t.string({ nullable: true, resolve: (v) => v.rollNumber }),
    sectionId: t.string({ resolve: (v) => v.report.sectionId.toString() }),
    periodKey: t.string({ resolve: (v) => v.report.periodKey }),
    revision: t.int({ resolve: (v) => v.report.revision }),
    status: t.string({ resolve: (v) => v.report.status }),
    provisional: t.boolean({ resolve: (v) => v.report.provisional }),
    dataAsOf: t.string({ resolve: (v) => v.report.dataAsOf.toISOString() }),
    coverageHomework: t.float({ nullable: true, resolve: (v) => v.report.coveragePct?.homework ?? null }),
    coverageAssignment: t.float({ nullable: true, resolve: (v) => v.report.coveragePct?.assignment ?? null }),
    coverageClassTest: t.float({ nullable: true, resolve: (v) => v.report.coveragePct?.classTest ?? null }),
    comment: t.string({ nullable: true, resolve: (v) => v.comment }),
    commentDraft: t.string({ nullable: true, resolve: (v) => v.commentDraft }),
    commentIsFallback: t.boolean({ resolve: (v) => !!v.report.commentDraft?.fallback }),
    commentFallbackReason: t.string({ nullable: true, resolve: (v) => v.report.commentDraft?.fallbackReason ?? null }),
    commentModel: t.string({ nullable: true, resolve: (v) => v.report.commentDraft?.model ?? null }),
    reviewedAt: t.string({ nullable: true, resolve: (v) => v.report.reviewedAt?.toISOString() ?? null }),
    releasedAt: t.string({ nullable: true, resolve: (v) => v.report.releasedAt?.toISOString() ?? null }),
    releaseBatchId: t.string({ nullable: true, resolve: (v) => v.report.releaseBatchId ?? null }),
    isRerelease: t.boolean({ resolve: (v) => v.report.isRerelease }),
    changeLog: t.stringList({
      description: "What moved since the previous revision — why a re-release is being asked for.",
      resolve: (v) => v.report.changeLog.map((c) => `${c.field}: ${c.before ?? "—"} → ${c.after ?? "—"}`),
    }),
    fullView: t.boolean({ resolve: (v) => v.fullView }),
    subjectFilter: t.stringList({ resolve: (v) => v.subjectFilter }),
    lockState: t.string({ resolve: (v) => v.lockState }),
    releasable: t.boolean({ resolve: (v) => v.releasable }),
    blockedReason: t.string({ nullable: true, resolve: (v) => v.blockedReason }),
    requiresPrincipal: t.boolean({ resolve: (v) => v.requiresPrincipal }),
    snapshotJson: t.string({ resolve: (v) => v.snapshotJson }),
  }),
});

const BulkOutcomeRef = builder
  .objectRef<{ reportId: string; released: boolean; error: string | null }>("MonthlyReportReleaseOutcome")
  .implement({
    fields: (t) => ({
      reportId: t.exposeString("reportId"),
      released: t.exposeBoolean("released"),
      error: t.string({ nullable: true, resolve: (o) => o.error }),
    }),
  });

const ConfigRef = builder.objectRef<MonthlyReportConfigShape>("MonthlyReportConfig").implement({
  description: "The Principal-tunable thresholds, gate and calendar (D-#395). Read-time defaults.",
  fields: (t) => ({
    attendanceThresholdPp: t.exposeFloat("attendanceThresholdPp"),
    attendanceMinDays: t.exposeInt("attendanceMinDays"),
    homeworkThresholdPp: t.exposeFloat("homeworkThresholdPp"),
    homeworkMinSheets: t.exposeInt("homeworkMinSheets"),
    assignmentThresholdPp: t.exposeFloat("assignmentThresholdPp"),
    assignmentMinItems: t.exposeInt("assignmentMinItems"),
    qualityThresholdPp: t.exposeFloat("qualityThresholdPp"),
    qualityMinChecked: t.exposeInt("qualityMinChecked"),
    classTestThresholdPp: t.exposeFloat("classTestThresholdPp"),
    classTestMinTests: t.exposeInt("classTestMinTests"),
    concernThreshold: t.exposeInt("concernThreshold"),
    resubmissionThreshold: t.exposeInt("resubmissionThreshold"),
    resubmissionMinIssued: t.exposeInt("resubmissionMinIssued"),
    absentStreakFlag: t.exposeInt("absentStreakFlag"),
    absentUncoveredFlag: t.exposeInt("absentUncoveredFlag"),
    coverageGatePct: t.exposeFloat("coverageGatePct"),
    minSectionSizeForClassBest: t.exposeInt("minSectionSizeForClassBest"),
    showClassBest: t.exposeBoolean("showClassBest"),
    showFees: t.exposeBoolean("showFees"),
    draftDay: t.exposeInt("draftDay"),
    revisionWindowDays: t.exposeInt("revisionWindowDays"),
    hardLockDays: t.exposeInt("hardLockDays"),
  }),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("monthlyReportsForSection", (t) =>
  t.field({
    type: [ReportRef],
    description:
      "The release console: the NEWEST revision per child in a section for one month, plus the " +
      "released one where a newer draft exists.",
    authScopes: { authenticated: true },
    args: {
      sectionId: t.arg.string({ required: true }),
      periodKey: t.arg.string({ required: true, description: "YYYY-MM" }),
    },
    resolve: async (_root, args, ctx) => {
      await assertReportRead(ctx, args.sectionId);
      const rows = await MonthlyReport.find({ sectionId: args.sectionId, periodKey: args.periodKey })
        .sort({ revision: -1 })
        .exec();
      if (rows.length === 0) return [];
      const { subjects, isTeacher } = await assertStaffReportRead(ctx, rows[0]);
      const isPrincipal = (ctx.auth?.role as Role) === "PRINCIPAL";
      // Newest revision per child, plus whatever the family is currently seeing.
      const newest = new Map<string, IMonthlyReport>();
      const released: IMonthlyReport[] = [];
      for (const r of rows) {
        const key = r.studentId.toString();
        if (!newest.has(key)) newest.set(key, r);
        else if (r.status === "RELEASED") released.push(r);
      }
      const students = (await Student.find({
        _id: { $in: [...new Set(rows.map((r) => r.studentId.toString()))] },
      })
        .select("name nameBn rollNumber")
        .lean()) as unknown as Array<{ _id: { toString(): string }; name: string; nameBn?: string; rollNumber?: string }>;
      const byId = new Map(students.map((s) => [s._id.toString(), s]));

      const views = await Promise.all(
        [...newest.values(), ...released].map((r) =>
          viewOf(r, subjects, isTeacher, isPrincipal, byId.get(r.studentId.toString())),
        ),
      );
      // Alphabetical by the name the reviewer actually reads — an id-ordered list is
      // unreviewable when you are working through twenty children.
      return views.sort((a, b) => a.studentName.localeCompare(b.studentName, "bn"));
    },
  }),
);

builder.queryField("monthlyReport", (t) =>
  t.field({
    type: ReportRef,
    authScopes: { authenticated: true },
    args: { reportId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const report = await MonthlyReport.findById(args.reportId);
      if (!report) throw new ForbiddenError("রিপোর্ট পাওয়া যায়নি");
      const { subjects, isTeacher } = await assertStaffReportRead(ctx, report);
      return viewOf(report, subjects, isTeacher, (ctx.auth?.role as Role) === "PRINCIPAL");
    },
  }),
);

const RollupRef = builder.objectRef<ClassRollup>("MonthlyClassRollup").implement({
  description:
    "One section's month in a line: how many are released, how many still need a comment reviewed, " +
    "how many are held back by incomplete data, and where the flags are. Rolled up from the STORED " +
    "revisions — the same arithmetic the families were sent, never a second computation.",
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    periodKey: t.exposeString("periodKey"),
    students: t.exposeInt("students"),
    released: t.exposeInt("released"),
    awaitingReview: t.exposeInt("awaitingReview"),
    provisional: t.exposeInt("provisional"),
    avgAttendancePct: t.float({ nullable: true, resolve: (r) => r.avgAttendancePct }),
    avgHomeworkSubmissionPct: t.float({ nullable: true, resolve: (r) => r.avgHomeworkSubmissionPct }),
    avgClassTestPct: t.float({ nullable: true, resolve: (r) => r.avgClassTestPct }),
    attendanceDeclining: t.exposeInt("attendanceDeclining"),
    flagCounts: t.stringList({ resolve: (r) => r.flagCounts.map((f) => `${f.flag}:${f.students}`) }),
  }),
});

builder.queryField("monthlyClassRollups", (t) =>
  t.field({
    type: [RollupRef],
    description:
      "The Principal/Office view: every section's month at once, so a struggling class or an " +
      "unreviewed pile is visible without opening each console in turn.",
    authScopes: { authenticated: true },
    args: { periodKey: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      // Whole-school by definition, so it rides the release gate rather than a
      // per-section read: a teacher has no business with other classes' totals.
      assertRelease(ctx);
      const sections = (await Section.find({ active: { $ne: false } })
        .select("_id")
        .lean()) as unknown as Array<{ _id: { toString(): string } }>;
      const out: ClassRollup[] = [];
      for (const s of sections) out.push(await monthlyClassRollup(s._id.toString(), args.periodKey));
      // A section with no reports built yet is dropped — an empty row reads as
      // "this class had no month", which is a different and false claim.
      return out.filter((r) => r.students > 0);
    },
  }),
);

const PendingGroupRef = builder.objectRef<PendingGroup>("MonthlyPendingGroup").implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    items: t.exposeInt("items"),
    toCheck: t.exposeInt("toCheck"),
    notIn: t.exposeInt("notIn"),
  }),
});

const PendingRowRef = builder.objectRef<PendingRow>("MonthlyPendingRow").implement({
  fields: (t) => ({
    kind: t.exposeString("kind"),
    teacherName: t.exposeString("teacherName"),
    sectionLabel: t.exposeString("sectionLabel"),
    subject: t.exposeString("subject"),
    dateKey: t.exposeString("dateKey"),
    ref: t.exposeString("ref"),
    toCheck: t.exposeInt("toCheck"),
    notIn: t.exposeInt("notIn"),
  }),
});

const PendingClassTestRef = builder.objectRef<PendingClassTest>("MonthlyPendingClassTest").implement({
  fields: (t) => ({
    ctId: t.exposeString("ctId"),
    sectionLabel: t.exposeString("sectionLabel"),
    subject: t.exposeString("subject"),
    dateKey: t.exposeString("dateKey"),
    status: t.exposeString("status"),
    teacherName: t.exposeString("teacherName"),
    results: t.exposeInt("results"),
    unmarked: t.exposeInt("unmarked"),
  }),
});

const PendingWorkRef = builder.objectRef<MonthlyPendingWork>("MonthlyPendingWork").implement({
  description:
    "What is still unsettled for a month — the work that keeps reports below the coverage gate. " +
    "Uses the SAME unsettled predicate as the coverage percentage, so the two cannot disagree.",
  fields: (t) => ({
    periodKey: t.exposeString("periodKey"),
    homeworkItems: t.int({ resolve: (p) => p.totals.homeworkItems }),
    homeworkToCheck: t.int({ resolve: (p) => p.totals.homeworkToCheck }),
    homeworkNotIn: t.int({ resolve: (p) => p.totals.homeworkNotIn }),
    assignmentItems: t.int({ resolve: (p) => p.totals.assignmentItems }),
    assignmentToCheck: t.int({ resolve: (p) => p.totals.assignmentToCheck }),
    assignmentNotIn: t.int({ resolve: (p) => p.totals.assignmentNotIn }),
    classTestsNoResults: t.int({ resolve: (p) => p.totals.classTestsNoResults }),
    classTestsUnmarked: t.int({ resolve: (p) => p.totals.classTestsUnmarked }),
    byTeacher: t.field({ type: [PendingGroupRef], resolve: (p) => p.byTeacher }),
    bySection: t.field({ type: [PendingGroupRef], resolve: (p) => p.bySection }),
    classTests: t.field({ type: [PendingClassTestRef], resolve: (p) => p.classTests }),
    rows: t.field({ type: [PendingRowRef], resolve: (p) => p.rows }),
  }),
});

builder.queryField("monthlyPendingWork", (t) =>
  t.field({
    type: PendingWorkRef,
    description:
      "Whole-school by definition — it names other teachers' outstanding work — so it rides the " +
      "release gate rather than a per-section read.",
    authScopes: { authenticated: true },
    args: { periodKey: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertRelease(ctx);
      return monthlyPendingWork(args.periodKey);
    },
  }),
);

const TeacherChaseRef = builder.objectRef<TeacherChase>("MonthlyTeacherChase").implement({
  description:
    "One ready-to-send nudge per teacher with outstanding work. NOTHING is sent from here — " +
    "the body is rendered and a wa.me link offered; a person presses it (ADR-003).",
  fields: (t) => ({
    teacherId: t.exposeString("teacherId"),
    teacherName: t.exposeString("teacherName"),
    phone: t.string({ nullable: true, resolve: (c) => c.phone }),
    messageBn: t.exposeString("messageBn"),
    waLink: t.string({ nullable: true, resolve: (c) => c.waLink }),
    /** No phone on file — named, never silently dropped. */
    unreachable: t.exposeBoolean("unreachable"),
    classTests: t.exposeInt("classTests"),
    homeworkItems: t.exposeInt("homeworkItems"),
    assignmentItems: t.exposeInt("assignmentItems"),
    toCheck: t.exposeInt("toCheck"),
    notIn: t.exposeInt("notIn"),
  }),
});

builder.queryField("monthlyTeacherChase", (t) =>
  t.field({
    type: [TeacherChaseRef],
    description: "Per-teacher pending-work messages for a month, heaviest first.",
    authScopes: { authenticated: true },
    args: { periodKey: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertRelease(ctx);
      return monthlyTeacherChase(args.periodKey);
    },
  }),
);

builder.queryField("monthlyReportConfig", (t) =>
  t.field({
    type: ConfigRef,
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      assertRelease(ctx);
      return readMonthlyReportConfig();
    },
  }),
);

builder.queryField("childMonthlyReports", (t) =>
  t.field({
    type: [ReportRef],
    description:
      "GUARDIAN PATH — RELEASED revisions of one linked child, newest first. A draft, a superseded " +
      "revision and every staff-only field are unreachable here (§4).",
    authScopes: { authenticated: true },
    args: {
      studentId: t.arg.string({ required: true }),
      limit: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      const rows = await MonthlyReport.find({
        studentId: args.studentId,
        status: "RELEASED",
      })
        .sort({ periodKey: -1 })
        .limit(Math.min(Math.max(args.limit ?? 12, 1), 24))
        .exec();
      // A guardian is never "narrowed" — they see the whole child — but they are not
      // staff either: `isTeacher` false keeps fees on, `subjects` null keeps the
      // reviewed paragraph, and only RELEASED rows ever reach here.
      return Promise.all(rows.map((r) => viewOf(r, null, false, false)));
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationField("buildMonthlyReports", (t) =>
  t.field({
    type: "Int",
    description: "Compute (or recompute) a section's month. Returns how many revisions were raised.",
    authScopes: { authenticated: true },
    args: {
      sectionId: t.arg.string({ required: true }),
      periodKey: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      assertRelease(ctx);
      const outcomes = await buildSectionMonthlyReports(args.sectionId, args.periodKey);
      return outcomes.filter((o) => o.created).length;
    },
  }),
);

builder.mutationField("draftMonthlyReportComment", (t) =>
  t.field({
    type: ReportRef,
    description: "Generate the guardian paragraph. Writes a DRAFT only — a person must accept it.",
    authScopes: { authenticated: true },
    args: { reportId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertRelease(ctx);
      const report = await draftMonthlyComment(args.reportId);
      const { subjects, isTeacher } = await assertStaffReportRead(ctx, report);
      return viewOf(report, subjects, isTeacher, (ctx.auth?.role as Role) === "PRINCIPAL");
    },
  }),
);

const DraftOutcomeRef = builder
  .objectRef<{ reportId: string; drafted: boolean; fallback: boolean; error: string | null }>(
    "MonthlyReportDraftOutcome",
  )
  .implement({
    fields: (t) => ({
      reportId: t.exposeString("reportId"),
      drafted: t.exposeBoolean("drafted"),
      /** True when the template wrote it — drafted, but worth a second look. */
      fallback: t.exposeBoolean("fallback"),
      error: t.string({ nullable: true, resolve: (o) => o.error }),
    }),
  });

builder.mutationField("draftMonthlyReportComments", (t) =>
  t.field({
    type: [DraftOutcomeRef],
    description:
      "Generate the paragraph for MANY reports, one after another. Sequential on purpose: " +
      "the model's free tier is rated per minute, so a parallel burst would turn a whole " +
      "class into template fallbacks.",
    authScopes: { authenticated: true },
    args: { reportIds: t.arg.stringList({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertRelease(ctx);
      // Every id is gated individually — a bulk argument must never be a way past the
      // per-report read gate.
      for (const id of args.reportIds) {
        const r = await MonthlyReport.findById(id).select("sectionId classId");
        if (!r) throw new ForbiddenError("রিপোর্ট পাওয়া যায়নি");
        await assertStaffReportRead(ctx, r);
      }
      return draftMonthlyCommentsSequentially(args.reportIds);
    },
  }),
);

builder.mutationField("reviewMonthlyReportComment", (t) =>
  t.field({
    type: ReportRef,
    description:
      "Accept or edit the paragraph. The class teacher of the child's section may do this, as well " +
      "as Principal/Office — the words are theirs to own.",
    authScopes: { authenticated: true },
    args: {
      reportId: t.arg.string({ required: true }),
      text: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const existing = await MonthlyReport.findById(args.reportId);
      if (!existing) throw new ForbiddenError("রিপোর্ট পাওয়া যায়নি");
      const { subjects, isTeacher } = await assertStaffReportRead(ctx, existing);
      // A narrowed caller cannot even SEE the paragraph, so they cannot own it.
      if (subjects !== null) throw new ForbiddenError("মন্তব্য অনুমোদন শ্রেণি শিক্ষক/অফিসের কাজ");
      const report = await reviewMonthlyReport(args.reportId, args.text, ctx.auth.userId as string);
      return viewOf(report, subjects, isTeacher, (ctx.auth.role as Role) === "PRINCIPAL");
    },
  }),
);

builder.mutationField("releaseMonthlyReport", (t) =>
  t.field({
    type: ReportRef,
    authScopes: { authenticated: true },
    args: {
      reportId: t.arg.string({ required: true }),
      overrideReason: t.arg.string({ required: false, description: "Principal only — unlocks a provisional or hard-locked report" }),
    },
    resolve: async (_root, args, ctx) => {
      const { isPrincipal, actorId } = assertRelease(ctx);
      const report = await releaseMonthlyReport(args.reportId, actorId, {
        isPrincipal,
        overrideReason: args.overrideReason ?? null,
      });
      const { subjects, isTeacher } = await assertStaffReportRead(ctx, report);
      return viewOf(report, subjects, isTeacher, isPrincipal);
    },
  }),
);

builder.mutationField("bulkReleaseMonthlyReports", (t) =>
  t.field({
    type: [BulkOutcomeRef],
    description:
      "Release many under ONE batch id, so a wrong bulk release is revocable as a batch. A refusal " +
      "on one child does not abort the rest — every outcome comes back with its reason.",
    authScopes: { authenticated: true },
    args: {
      reportIds: t.arg.stringList({ required: true }),
      overrideReason: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const { isPrincipal, actorId } = assertRelease(ctx);
      return bulkReleaseMonthlyReports(args.reportIds, actorId, {
        isPrincipal,
        overrideReason: args.overrideReason ?? null,
      });
    },
  }),
);

builder.mutationField("revokeMonthlyReport", (t) =>
  t.field({
    type: "Boolean",
    description: "PRINCIPAL ONLY — withdraw a released report; the family loses access (D-#397).",
    authScopes: { authenticated: true },
    args: {
      reportId: t.arg.string({ required: true }),
      reason: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const actorId = assertPrincipal(ctx, "রিপোর্ট প্রত্যাহার");
      await revokeMonthlyReport(args.reportId, actorId, args.reason);
      return true;
    },
  }),
);

builder.mutationField("revokeMonthlyReleaseBatch", (t) =>
  t.field({
    type: "Int",
    description: "PRINCIPAL ONLY — undo a whole bulk release. Returns how many were withdrawn.",
    authScopes: { authenticated: true },
    args: {
      batchId: t.arg.string({ required: true }),
      reason: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const actorId = assertPrincipal(ctx, "ব্যাচ প্রত্যাহার");
      return revokeReleaseBatch(args.batchId, actorId, args.reason);
    },
  }),
);

builder.mutationField("setMonthlyReportConfig", (t) =>
  t.field({
    type: ConfigRef,
    description: "PRINCIPAL ONLY — edit the thresholds, the coverage gate and the revision calendar.",
    authScopes: { authenticated: true },
    args: {
      attendanceThresholdPp: t.arg.float({ required: false }),
      attendanceMinDays: t.arg.int({ required: false }),
      homeworkThresholdPp: t.arg.float({ required: false }),
      homeworkMinSheets: t.arg.int({ required: false }),
      assignmentThresholdPp: t.arg.float({ required: false }),
      assignmentMinItems: t.arg.int({ required: false }),
      qualityThresholdPp: t.arg.float({ required: false }),
      qualityMinChecked: t.arg.int({ required: false }),
      classTestThresholdPp: t.arg.float({ required: false }),
      classTestMinTests: t.arg.int({ required: false }),
      concernThreshold: t.arg.int({ required: false }),
      coverageGatePct: t.arg.float({ required: false }),
      minSectionSizeForClassBest: t.arg.int({ required: false }),
      showClassBest: t.arg.boolean({ required: false }),
      showFees: t.arg.boolean({ required: false }),
      revisionWindowDays: t.arg.int({ required: false }),
      hardLockDays: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const actorId = assertPrincipal(ctx, "রিপোর্টের সীমা পরিবর্তন");
      const patch: Partial<MonthlyReportConfigShape> = {};
      for (const [k, v] of Object.entries(args)) {
        if (v !== null && v !== undefined) (patch as Record<string, unknown>)[k] = v;
      }
      return setMonthlyReportConfig(patch, actorId);
    },
  }),
);

/** Re-exported for the tests that pin the narrowing rule. */
export { assertStaffReportRead };
export type { Types };
