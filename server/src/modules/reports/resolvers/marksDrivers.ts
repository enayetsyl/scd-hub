/**
 * "What moves the marks" resolver (D-#905). One read-only query over existing records;
 * no capture, no new model. Gated on its own Reports-hub switch `reports:marks_drivers`
 * (Principal by default — the scatter carries one dot per child, though never a name).
 *
 * Identity/operational plane (ADR-005) — no corpus path.
 */
import { builder } from "../../../schema";
import {
  marksDriversReport,
  MARKS_DRIVERS_WINDOWS,
  type MarksDriversReport,
  type MarksDriversWindow,
} from "../services/MarksDriversService";
import type {
  Correlation,
  Tertile,
  AttendanceBand,
  Below85,
  LevelRow,
  EffectRow,
  ScatterPoint,
} from "../services/marksDriversStats";

const CorrelationRef = builder.objectRef<Correlation>("MarksDriverCorrelation");
CorrelationRef.implement({
  description: "How closely one measure moves with a child's class-test average (Pearson r over `n` children).",
  fields: (t) => ({
    key: t.exposeString("key"),
    n: t.exposeInt("n"),
    r: t.float({ nullable: true, resolve: (c) => c.r }),
    p: t.float({ nullable: true, resolve: (c) => c.p }),
    significant: t.exposeBoolean("significant"),
  }),
});

const TertileRef = builder.objectRef<Tertile>("MarksDriverTertile");
TertileRef.implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    bottom: t.float({ nullable: true, resolve: (x) => x.bottom }),
    middle: t.float({ nullable: true, resolve: (x) => x.middle }),
    top: t.float({ nullable: true, resolve: (x) => x.top }),
    n: t.exposeInt("n"),
  }),
});

const BandRef = builder.objectRef<AttendanceBand>("MarksDriverAttendanceBand");
BandRef.implement({
  fields: (t) => ({
    lo: t.exposeInt("lo"),
    hi: t.exposeInt("hi"),
    n: t.exposeInt("n"),
    meanResult: t.float({ nullable: true, resolve: (b) => b.meanResult }),
  }),
});

const Below85Ref = builder.objectRef<Below85>("MarksDriverBelow85");
Below85Ref.implement({
  fields: (t) => ({
    nBelow: t.exposeInt("nBelow"),
    nAbove: t.exposeInt("nAbove"),
    below: t.float({ nullable: true, resolve: (b) => b.below }),
    above: t.float({ nullable: true, resolve: (b) => b.above }),
    p: t.float({ nullable: true, resolve: (b) => b.p }),
    hwBelow: t.float({ nullable: true, resolve: (b) => b.hwBelow }),
    hwAbove: t.float({ nullable: true, resolve: (b) => b.hwAbove }),
    controlledGap: t.float({ nullable: true, resolve: (b) => b.controlledGap }),
  }),
});

const LevelRef = builder.objectRef<LevelRow>("MarksDriverLevel");
LevelRef.implement({
  fields: (t) => ({
    level: t.exposeInt("level"),
    n: t.exposeInt("n"),
    att: t.float({ nullable: true, resolve: (l) => l.att }),
    hwDone: t.float({ nullable: true, resolve: (l) => l.hwDone }),
    asDone: t.float({ nullable: true, resolve: (l) => l.asDone }),
    result: t.float({ nullable: true, resolve: (l) => l.result }),
    rAtt: t.float({ nullable: true, resolve: (l) => l.rAtt }),
    rHw: t.float({ nullable: true, resolve: (l) => l.rHw }),
  }),
});

const SeniorRef = builder.objectRef<MarksDriversReport["senior"]>("MarksDriverSenior");
SeniorRef.implement({
  fields: (t) => ({
    n: t.exposeInt("n"),
    r: t.float({ nullable: true, resolve: (s) => s.r }),
    p: t.float({ nullable: true, resolve: (s) => s.p }),
  }),
});

const EffectRef = builder.objectRef<EffectRow>("MarksDriverEffect");
EffectRef.implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    marks: t.exposeFloat("marks"),
  }),
});

const PointRef = builder.objectRef<ScatterPoint>("MarksDriverPoint");
PointRef.implement({
  description: "One child, anonymous: class level and three figures. No id, no name.",
  fields: (t) => ({
    level: t.exposeInt("level"),
    att: t.float({ nullable: true, resolve: (p) => p.att }),
    hwDone: t.float({ nullable: true, resolve: (p) => p.hwDone }),
    result: t.exposeFloat("result"),
  }),
});

const ReportRef = builder.objectRef<MarksDriversReport>("MarksDriversReport");
ReportRef.implement({
  description:
    "What moves the marks (D-#905): homework, assignments and attendance against class-test " +
    "results over a rolling window. Fractions are 0–1; results and marks are percentage points.",
  fields: (t) => ({
    window: t.exposeString("window"),
    fromKey: t.exposeString("fromKey"),
    toKey: t.exposeString("toKey"),
    computedAt: t.exposeString("computedAt"),
    students: t.exposeInt("students"),
    withResult: t.exposeInt("withResult"),
    testsPrinted: t.exposeInt("testsPrinted"),
    papersMarked: t.exposeInt("papersMarked"),
    homeworkRecords: t.exposeInt("homeworkRecords"),
    assignmentRecords: t.exposeInt("assignmentRecords"),
    medianMarkedDays: t.exposeInt("medianMarkedDays"),
    attMedian: t.float({ nullable: true, resolve: (r) => r.attMedian }),
    sanityR: t.float({ nullable: true, resolve: (r) => r.sanityR }),
    longAbsent: t.exposeInt("longAbsent"),
    absenceDays: t.exposeInt("absenceDays"),
    correlations: t.field({ type: [CorrelationRef], resolve: (r) => r.correlations }),
    tertiles: t.field({ type: [TertileRef], resolve: (r) => r.tertiles }),
    bands: t.field({ type: [BandRef], resolve: (r) => r.bands }),
    below85: t.field({ type: Below85Ref, resolve: (r) => r.below85 }),
    levels: t.field({ type: [LevelRef], resolve: (r) => r.levels }),
    senior: t.field({ type: SeniorRef, resolve: (r) => r.senior }),
    effects: t.field({ type: [EffectRef], resolve: (r) => r.effects }),
    points: t.field({ type: [PointRef], resolve: (r) => r.points }),
  }),
});

builder.queryField("marksDrivers", (t) =>
  t.field({
    type: ReportRef,
    description:
      "What moves the marks over a rolling window. `window` ∈ d30 | d90 | year (this academic " +
      "year to today). Cached ten minutes per window; `refresh: true` recomputes now. " +
      "Requires reports:marks_drivers.",
    authScopes: { hasAnyPermission: ["reports:marks_drivers"] },
    args: {
      window: t.arg.string({ required: true }),
      refresh: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args) => {
      const window = (MARKS_DRIVERS_WINDOWS as readonly string[]).includes(args.window)
        ? (args.window as MarksDriversWindow)
        : "d90";
      return marksDriversReport(window, { refresh: args.refresh ?? false });
    },
  }),
);
