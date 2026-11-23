/**
 * AL-13 (docs/prd-academic-loop-2027.md journey L, AC-L1..L3) - the loop-health page and the readiness list. Reads only.
 *
 *   loopHealthYears                the years the readiness list may read (current + the prepared next, AL-11 pattern)
 *   loopHealthPage(kind, from, to) paged health rows per teacher or per section x subject for a period
 *   loopReadiness(year, onlyRed)   the January readiness list + the low-stock list for the Principal
 *
 * Gate: the Reports-hub switch `reports:loop_health` (Office by default; the Principal has everything). Not behind the
 * 2027 release switch - this is how the Principal watches the loop before and after turning it on.
 */
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import { targetYears, type TargetYear } from "../../lesson-progress/services/SyllabusTargetService";
import { loopHealthPage, type LoopHealthRow, type Rate } from "../services/LoopHealthService";
import { loopReadiness, type LowStockRow, type ReadinessCheck, type ReadinessRow, type ReadinessView } from "../services/LoopReadinessService";

const RateRef = builder.objectRef<Rate>("LoopHealthRate");
RateRef.implement({
  description: "done of total; pct is null when there is nothing to count (never shown as 0 %).",
  fields: (t) => ({
    done: t.exposeInt("done"),
    total: t.exposeInt("total"),
    pct: t.int({ nullable: true, resolve: (r) => r.pct }),
  }),
});

const HealthRowRef = builder.objectRef<LoopHealthRow>("LoopHealthRow");
HealthRowRef.implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    kind: t.exposeString("kind", { description: "TEACHER | SECTION" }),
    teacherId: t.string({ nullable: true, resolve: (r) => r.teacherId }),
    teacherName: t.string({ nullable: true, resolve: (r) => r.teacherName }),
    sectionId: t.string({ nullable: true, resolve: (r) => r.sectionId }),
    className: t.string({ nullable: true, resolve: (r) => r.className }),
    sectionName: t.string({ nullable: true, resolve: (r) => r.sectionName }),
    subject: t.string({ nullable: true, resolve: (r) => r.subject }),
    periods: t.field({ type: RateRef, resolve: (r) => r.periods }),
    papers: t.field({ type: RateRef, resolve: (r) => r.papers }),
    ticks: t.field({ type: RateRef, resolve: (r) => r.ticks }),
    zeroNotJudged: t.exposeBoolean("zeroNotJudged"),
    classTests: t.field({ type: RateRef, resolve: (r) => r.classTests }),
    weakToImproving: t.exposeInt("weakToImproving"),
    weakToMastered: t.exposeInt("weakToMastered"),
    reteachOpened: t.exposeInt("reteachOpened"),
    reteachClosed: t.exposeInt("reteachClosed"),
    reteachBeforePct: t.int({ nullable: true, resolve: (r) => r.reteachBeforePct }),
    reteachAfterPct: t.int({ nullable: true, resolve: (r) => r.reteachAfterPct }),
  }),
});

const HealthPageRef = pageRef("LoopHealthPage", HealthRowRef);
const HealthPageWithPeriodRef = builder.objectRef<Awaited<ReturnType<typeof loopHealthPage>>>("LoopHealthPeriodPage");
HealthPageWithPeriodRef.implement({
  fields: (t) => ({
    from: t.exposeString("from"),
    to: t.exposeString("to"),
    page: t.field({ type: HealthPageRef, resolve: (p) => ({ rows: p.rows, total: p.total, page: p.page, pageSize: p.pageSize }) }),
  }),
});

const EmptyObjectiveRef = builder.objectRef<ReadinessCheck["emptyObjectives"][number]>("LoopEmptyObjective");
EmptyObjectiveRef.implement({
  description: "An objective with a share (HW or ASCT) that has nothing left to give.",
  fields: (t) => ({
    code: t.exposeString("code"),
    labelBn: t.exposeString("labelBn"),
    share: t.exposeString("share", { description: "HW | ASCT" }),
  }),
});

const CheckRef = builder.objectRef<ReadinessCheck>("LoopReadinessCheck");
CheckRef.implement({
  fields: (t) => ({
    key: t.exposeString("key", { description: "TREE | SWITCH | STOCK | PLANS | ROTATION | TARGETS | HINTS" }),
    state: t.exposeString("state", { description: "OK | RED | NA" }),
    have: t.exposeInt("have"),
    need: t.int({ nullable: true, resolve: (c) => c.need }),
    hwWeeks: t.float({ nullable: true, resolve: (c) => c.hwWeeks }),
    asctWeeks: t.float({ nullable: true, resolve: (c) => c.asctWeeks }),
    usingDefault: t.exposeBoolean("usingDefault"),
    emptyObjectives: t.field({ type: [EmptyObjectiveRef], resolve: (c) => c.emptyObjectives }),
    hwEmptyCount: t.exposeInt("hwEmptyCount"),
    asctEmptyCount: t.exposeInt("asctEmptyCount"),
    hwUnderWeekCount: t.exposeInt("hwUnderWeekCount"),
    asctUnderWeekCount: t.exposeInt("asctUnderWeekCount"),
  }),
});

const ReadinessRowRef = builder.objectRef<ReadinessRow>("LoopReadinessRow");
ReadinessRowRef.implement({
  fields: (t) => ({
    classToken: t.exposeString("classToken"),
    subject: t.exposeString("subject"),
    ready: t.exposeBoolean("ready"),
    checks: t.field({ type: [CheckRef], resolve: (r) => r.checks }),
  }),
});
const ReadinessPageRef = pageRef("LoopReadinessPage", ReadinessRowRef);

const LowStockRef = builder.objectRef<LowStockRow>("LoopLowStockRow");
LowStockRef.implement({
  fields: (t) => ({
    classToken: t.exposeString("classToken"),
    subject: t.exposeString("subject"),
    hwWeeks: t.float({ nullable: true, resolve: (r) => r.hwWeeks }),
    asctWeeks: t.float({ nullable: true, resolve: (r) => r.asctWeeks }),
    gold: t.exposeInt("gold"),
  }),
});

const ReadinessViewRef = builder.objectRef<ReadinessView>("LoopReadiness");
ReadinessViewRef.implement({
  fields: (t) => ({
    yearId: t.string({ nullable: true, resolve: (v) => v.yearId }),
    yearLabel: t.string({ nullable: true, resolve: (v) => v.yearLabel }),
    yearCurrent: t.exposeBoolean("yearCurrent"),
    switchOn: t.exposeBoolean("switchOn"),
    totalPairs: t.exposeInt("totalPairs"),
    readyPairs: t.exposeInt("readyPairs"),
    lowStock: t.field({ type: [LowStockRef], resolve: (v) => v.lowStock }),
    rows: t.field({ type: ReadinessPageRef, resolve: (v) => v.rows }),
  }),
});

const YearRef = builder.objectRef<TargetYear>("LoopHealthYear");
YearRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    label: t.exposeString("label"),
    current: t.exposeBoolean("current"),
  }),
});

builder.queryFields((t) => ({
  loopHealthYears: t.field({
    type: [YearRef],
    description: "AL-13: the years the readiness list may read - the current one and the prepared next one. Requires reports:loop_health.",
    authScopes: { hasPermission: "reports:loop_health" },
    resolve: () => targetYears(),
  }),
  loopHealthPage: t.field({
    type: HealthPageWithPeriodRef,
    description:
      "AL-13 (AC-L1): paged loop-health rows per TEACHER or per SECTION (section x subject) for a period (default the last 4 weeks): " +
      "periods marked, papers confirmed by the deadline, papers with a tick, class tests with a sheet, WEAK moves, re-teach before/after. " +
      "Read only. Requires reports:loop_health.",
    authScopes: { hasPermission: "reports:loop_health" },
    args: {
      kind: t.arg.string({ required: true, description: "TEACHER | SECTION" }),
      from: t.arg.string({ required: false }),
      to: t.arg.string({ required: false }),
      page: t.arg.int({ required: false }),
      pageSize: t.arg.int({ required: false }),
    },
    resolve: (_r, args) =>
      loopHealthPage({ kind: args.kind === "TEACHER" ? "TEACHER" : "SECTION", from: args.from, to: args.to, page: args.page, pageSize: args.pageSize }),
  }),
  loopReadiness: t.field({
    type: ReadinessViewRef,
    description:
      "AL-13 (AC-L2/L3): the readiness list per class x subject for the current or the prepared next year - tree, switch, weeks of stock " +
      "(homework share and AS/CT share apart), plans with tags, rotation, targets, hints - plus the under-4-weeks list. Read only. Requires reports:loop_health.",
    authScopes: { hasPermission: "reports:loop_health" },
    args: {
      academicYearId: t.arg.string({ required: false }),
      onlyRed: t.arg.boolean({ required: false }),
      page: t.arg.int({ required: false }),
      pageSize: t.arg.int({ required: false }),
    },
    resolve: (_r, args) => loopReadiness({ academicYearId: args.academicYearId, onlyRed: args.onlyRed, page: args.page, pageSize: args.pageSize }),
  }),
}));
