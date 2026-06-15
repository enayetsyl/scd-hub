/**
 * Saturday-Revision analytics resolvers (SR-3, prd-sr3 §3/§5/§6, D-#246). All DERIVED
 * over the SR-1 entries (no new model). RBAC composes existing perms (no new permission):
 *   - Student/group reads: `tracker:read` + the Quran-group scope (teacher own groups /
 *     own students); Principal/Office unscoped.
 *   - School/level dashboards + completeness: Principal/Office.
 *   - The completeness-chase: `message:dispatch` + Principal/Office (Office chases the
 *     teacher, never the reverse — AS-T4/D-#88).
 *
 * authScopes `{ authenticated: true }` + the internal gates (OFFICE holds no tracker:*;
 * CT-4-FIX/D-#196). Identity plane (names studentIds); no corpus path.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { callerHasPermission } from "@scd/shared";
import { ForbiddenError } from "../../../middleware/authz";
import { teacherTeachesGroup, teacherCanReadStudent } from "../services/RevisionService";
import {
  studentJuzWeakness,
  groupCoverage,
  weeklyTrend,
  levelDashboard,
  studentDashboard,
  mistakeBreakdown,
  completenessStatus,
  completenessChase,
  type JuzWeakness,
  type CoverageRow,
  type TrendPoint,
  type WeeklyTrend,
  type RevisionDashboard,
  type MistakeBreakdown,
  type CompletenessRow,
  type CompletenessChaseRow,
} from "../services/RevisionSummaryService";

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

function isAdmin(ctx: AppContext): boolean {
  return ctx.auth?.role === "PRINCIPAL" || ctx.auth?.role === "OFFICE";
}

async function assertReadStudent(ctx: AppContext, studentId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (isAdmin(ctx)) return;
  if (ctx.auth.role === "GUARDIAN" || !callerHasPermission(ctx.auth, "tracker:read")) {
    throw new ForbiddenError("You cannot read this child's revision");
  }
  if (!(await teacherCanReadStudent(ctx.auth.userId as string, studentId))) {
    throw new ForbiddenError("This child is not in a Qur'an group you lead");
  }
}

async function assertReadGroup(ctx: AppContext, groupId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (isAdmin(ctx)) return;
  if (ctx.auth.role === "GUARDIAN" || !callerHasPermission(ctx.auth, "tracker:read")) {
    throw new ForbiddenError("You cannot read this group's revision");
  }
  if (!(await teacherTeachesGroup(ctx.auth.userId as string, groupId))) {
    throw new ForbiddenError("You do not lead this Qur'an group");
  }
}

function assertDashboardAdmin(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!isAdmin(ctx)) throw new ForbiddenError("Principal/Office only");
}

function assertChaseAdmin(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!(isAdmin(ctx) && callerHasPermission(ctx.auth, "message:dispatch"))) {
    throw new ForbiddenError("The completeness-chase is Principal/Office (message:dispatch) only");
  }
}

/** Resolve + gate a {studentId? | groupId?} scope. Exactly one must be set. */
async function assertScope(ctx: AppContext, studentId?: string | null, groupId?: string | null): Promise<void> {
  if (studentId && groupId) throw new ForbiddenError("Provide exactly one of studentId / groupId");
  if (studentId) return assertReadStudent(ctx, studentId);
  if (groupId) return assertReadGroup(ctx, groupId);
  throw new ForbiddenError("A studentId or groupId is required");
}

const asOfDate = (s?: string | null): Date | undefined => (s ? new Date(s) : undefined);

// ---------------------------------------------------------------------------
// Shared object refs
// ---------------------------------------------------------------------------

const PortionsRef = builder.objectRef<RevisionDashboard["portionsByCategory"]>("RevisionPortions");
PortionsRef.implement({
  fields: (t) => ({
    SABAQ: t.exposeFloat("SABAQ"),
    SABQI: t.exposeFloat("SABQI"),
    MANZIL: t.exposeFloat("MANZIL"),
  }),
});

const MistakesRef = builder.objectRef<MistakeBreakdown>("RevisionMistakeBreakdown");
MistakesRef.implement({
  fields: (t) => ({
    harf: t.exposeInt("harf"),
    ghunnah: t.exposeInt("ghunnah"),
    madd: t.exposeInt("madd"),
    other: t.exposeInt("other"),
  }),
});

const JuzWeaknessRef = builder.objectRef<JuzWeakness>("RevisionJuzWeakness");
JuzWeaknessRef.implement({
  description: "Per-juz weakness: Σ تنبیه/فتح + mistake totals (higher = weaker). SR-3 heatmap.",
  fields: (t) => ({
    juz: t.exposeInt("juz"),
    tanbih: t.exposeInt("tanbih"),
    fath: t.exposeInt("fath"),
    harf: t.exposeInt("harf"),
    ghunnah: t.exposeInt("ghunnah"),
    madd: t.exposeInt("madd"),
    other: t.exposeInt("other"),
    total: t.exposeInt("total"),
  }),
});

const CoverageRowRef = builder.objectRef<CoverageRow>("RevisionCoverageRow");
CoverageRowRef.implement({
  description: "Per (student × juz): last-revised Saturday + an overdue flag (SR-3 coverage).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    juz: t.exposeInt("juz"),
    lastRevised: t.exposeString("lastRevised"),
    daysSince: t.exposeInt("daysSince"),
    overdue: t.exposeBoolean("overdue"),
  }),
});

const TrendPointRef = builder.objectRef<TrendPoint>("RevisionTrendPoint");
TrendPointRef.implement({
  fields: (t) => ({
    date: t.exposeString("date"),
    tanbih: t.exposeInt("tanbih"),
    fath: t.exposeInt("fath"),
    mistakes: t.exposeInt("mistakes"),
    total: t.exposeInt("total"),
  }),
});

const WeeklyTrendRef = builder.objectRef<WeeklyTrend>("RevisionWeeklyTrend");
WeeklyTrendRef.implement({
  description: "Per-Saturday totals + a ↑/↓/→ trend (latest vs previous; SR-3). Higher total = weaker.",
  fields: (t) => ({
    points: t.field({ type: [TrendPointRef], resolve: (r) => r.points }),
    trend: t.exposeString("trend"),
  }),
});

const RevisionDashboardRef = builder.objectRef<RevisionDashboard>("RevisionDashboard");
RevisionDashboardRef.implement({
  description: "A level (group) or student rollup (SR-3): portions, totals, weakest juz, mistake breakdown.",
  fields: (t) => ({
    scopeId: t.exposeString("scopeId"),
    entries: t.exposeInt("entries"),
    present: t.exposeInt("present"),
    absent: t.exposeInt("absent"),
    portionsByCategory: t.field({ type: PortionsRef, resolve: (r) => r.portionsByCategory }),
    totalTanbih: t.exposeInt("totalTanbih"),
    totalFath: t.exposeInt("totalFath"),
    mistakes: t.field({ type: MistakesRef, resolve: (r) => r.mistakes }),
    weakestJuz: t.field({ type: [JuzWeaknessRef], resolve: (r) => r.weakestJuz }),
  }),
});

const CompletenessRowRef = builder.objectRef<CompletenessRow>("RevisionCompletenessRow");
CompletenessRowRef.implement({
  fields: (t) => ({
    groupId: t.exposeString("groupId"),
    code: t.exposeString("code"),
    nameBn: t.exposeString("nameBn"),
    level: t.exposeString("level"),
  }),
});

const CompletenessChaseRowRef = builder.objectRef<CompletenessChaseRow>("RevisionCompletenessChaseRow");
CompletenessChaseRowRef.implement({
  description: "A stateless wa.me nudge to the teacher of a Hifz group with no entry for a Saturday (SR-3).",
  fields: (t) => ({
    groupId: t.exposeString("groupId"),
    code: t.exposeString("code"),
    nameBn: t.exposeString("nameBn"),
    level: t.exposeString("level"),
    teacherId: t.string({ nullable: true, resolve: (r) => r.teacherId }),
    teacherName: t.string({ nullable: true, resolve: (r) => r.teacherName }),
    unreachableByWa: t.exposeBoolean("unreachableByWa"),
    messageBn: t.exposeString("messageBn"),
    waLink: t.string({ nullable: true, resolve: (r) => r.waLink }),
  }),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("studentJuzWeakness", (t) =>
  t.field({
    type: [JuzWeaknessRef],
    description: "Per-juz weakness heatmap for a child (SR-3, J-SR3-1). tracker:read + the child's group scope.",
    authScopes: { authenticated: true },
    args: { studentId: t.arg.string({ required: true }), asOf: t.arg.string({ required: false }) },
    resolve: async (_root, args, ctx) => {
      await assertReadStudent(ctx, args.studentId);
      return studentJuzWeakness(args.studentId, asOfDate(args.asOf));
    },
  }),
);

builder.queryField("revisionGroupCoverage", (t) =>
  t.field({
    type: [CoverageRowRef],
    description: "Per (student × juz) last-revised + overdue flag for a group (SR-3, J-SR3-2). tracker:read + group scope.",
    authScopes: { authenticated: true },
    args: {
      groupId: t.arg.string({ required: true }),
      asOf: t.arg.string({ required: false }),
      windowDays: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertReadGroup(ctx, args.groupId);
      return groupCoverage(args.groupId, asOfDate(args.asOf), args.windowDays ?? undefined);
    },
  }),
);

builder.queryField("revisionWeeklyTrend", (t) =>
  t.field({
    type: WeeklyTrendRef,
    description: "Per-Saturday تنبیه/فتح/mistake trend (↑/↓/→) for a student or group (SR-3, J-SR3-3).",
    authScopes: { authenticated: true },
    args: {
      studentId: t.arg.string({ required: false }),
      groupId: t.arg.string({ required: false }),
      asOf: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertScope(ctx, args.studentId, args.groupId);
      return weeklyTrend({ studentId: args.studentId ?? undefined, groupId: args.groupId ?? undefined }, asOfDate(args.asOf));
    },
  }),
);

builder.queryField("revisionLevelDashboard", (t) =>
  t.field({
    type: RevisionDashboardRef,
    description: "The level (group) rollup (SR-3, J-SR3-4). tracker:read + group scope (Principal/Office unscoped).",
    authScopes: { authenticated: true },
    args: { groupId: t.arg.string({ required: true }), asOf: t.arg.string({ required: false }) },
    resolve: async (_root, args, ctx) => {
      await assertReadGroup(ctx, args.groupId);
      return levelDashboard(args.groupId, asOfDate(args.asOf));
    },
  }),
);

builder.queryField("revisionStudentDashboard", (t) =>
  t.field({
    type: RevisionDashboardRef,
    description: "The student rollup (SR-3, J-SR3-4). tracker:read + the child's group scope.",
    authScopes: { authenticated: true },
    args: { studentId: t.arg.string({ required: true }), asOf: t.arg.string({ required: false }) },
    resolve: async (_root, args, ctx) => {
      await assertReadStudent(ctx, args.studentId);
      return studentDashboard(args.studentId, asOfDate(args.asOf));
    },
  }),
);

builder.queryField("revisionMistakeBreakdown", (t) =>
  t.field({
    type: MistakesRef,
    description: "harf/ghunnah/madd/other distribution for a student or group (SR-3, J-SR3-4).",
    authScopes: { authenticated: true },
    args: {
      studentId: t.arg.string({ required: false }),
      groupId: t.arg.string({ required: false }),
      asOf: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertScope(ctx, args.studentId, args.groupId);
      return mistakeBreakdown({ studentId: args.studentId ?? undefined, groupId: args.groupId ?? undefined }, asOfDate(args.asOf));
    },
  }),
);

builder.queryField("revisionCompletenessStatus", (t) =>
  t.field({
    type: [CompletenessRowRef],
    description: "Hifz groups with no entry for a Saturday (SR-3, J-SR3-5). Principal/Office.",
    authScopes: { authenticated: true },
    args: { date: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertDashboardAdmin(ctx);
      return completenessStatus(new Date(args.date));
    },
  }),
);

builder.queryField("revisionCompletenessChase", (t) =>
  t.field({
    type: [CompletenessChaseRowRef],
    description: "A stateless wa.me nudge per teacher of an un-entered Hifz group (SR-3, J-SR3-5). message:dispatch + Principal/Office.",
    authScopes: { authenticated: true },
    args: { date: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertChaseAdmin(ctx);
      return completenessChase(new Date(args.date));
    },
  }),
);
