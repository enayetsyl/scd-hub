/**
 * Vocab read-aggregate + guardian-message resolvers (VC-4; prd-vocabulary-tracker
 * §6/§8/§9, D-#44/#85/#153/#154).
 *
 * RBAC (composes existing perms — NO new permission, D-#94):
 *   - Reports (`vocabTestReport`/`vocabStudentDashboard`/`vocabClassDashboard`/
 *     `vocabStudentCumulative`): `tracker:read`.
 *   - Message generation (`generateVocabTestMessages`/`generateVocabCumulativeMessages`):
 *     `message:dispatch` (Principal/Teacher/Office — the AS-T4 R-T2 posture; Guardian
 *     denied by default-deny).
 *
 * Time inputs (`asOf`) are passed in (D-#153 — no clock in the aggregate math).
 * Identity-plane; NO corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import {
  vocabTestReport,
  vocabStudentDashboard,
  vocabClassDashboard,
  vocabStudentCumulative,
  type VocabTestReport,
  type VocabStudentDashboard,
  type VocabClassDashboard,
  type VocabStudentCumulative,
  type VocabTestMeta,
} from "../services/VocabSummaryService";
import {
  generateVocabTestMessages,
  generateVocabCumulativeMessages,
  type GenerateVocabMessagesResult,
  type GenerateVocabCumulativeResult,
  type VocabMessageRecipient,
} from "../services/VocabGuardianService";
import type { ScoreRollup, MissedWord, PersistentWord, CumulativeMode } from "../services/vocabAggregate";
import { DerivedStudentResultRef } from "./vocabResult";
import type { DerivedStudentResult } from "../services/VocabResultService";

function parseDate(iso: string, label: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new ForbiddenError(`${label} is not a valid date`);
  return d;
}

// ---------------------------------------------------------------------------
// Shared aggregate shapes
// ---------------------------------------------------------------------------

const VocabTestMetaRef = builder.objectRef<VocabTestMeta>("VocabTestMeta");
VocabTestMetaRef.implement({
  description: "Lightweight test header carried by VC-4 reports.",
  fields: (t) => ({
    testId: t.exposeString("testId"),
    program: t.exposeString("program"),
    sectionId: t.exposeString("sectionId"),
    classLevel: t.exposeInt("classLevel"),
    label: t.exposeString("label"),
    testDate: t.exposeString("testDate"),
    totalMarks: t.exposeInt("totalMarks"),
    status: t.exposeString("status"),
  }),
});

const ScoreRollupRef = builder.objectRef<ScoreRollup>("VocabScoreRollup");
ScoreRollupRef.implement({
  description: "Present/absent counts + averages over PRESENT outcomes only (§4 — ABSENT excluded).",
  fields: (t) => ({
    presentCount: t.exposeInt("presentCount"),
    absentCount: t.exposeInt("absentCount"),
    totalScore: t.exposeInt("totalScore"),
    totalPossible: t.exposeInt("totalPossible"),
    averageScore: t.exposeFloat("averageScore"),
    averageTotal: t.exposeFloat("averageTotal"),
  }),
});

const MissedWordRef = builder.objectRef<MissedWord>("VocabMissedWord");
MissedWordRef.implement({
  description: "A most-missed word: distinct present students who missed it / present count (§9).",
  fields: (t) => ({
    wordId: t.exposeString("wordId"),
    headword: t.exposeString("headword"),
    banglaMeaning: t.exposeString("banglaMeaning"),
    missedBy: t.exposeInt("missedBy"),
    missedPct: t.exposeFloat("missedPct"),
    flagged: t.exposeBoolean("flagged"),
    directions: t.exposeStringList("directions"),
  }),
});

const PersistentWordRef = builder.objectRef<PersistentWord>("VocabPersistentWord");
PersistentWordRef.implement({
  description: "A persistent weak word: missed in ≥ N tests by a student (§9).",
  fields: (t) => ({
    wordId: t.exposeString("wordId"),
    headword: t.exposeString("headword"),
    banglaMeaning: t.exposeString("banglaMeaning"),
    missCount: t.exposeInt("missCount"),
    directions: t.exposeStringList("directions"),
  }),
});

// ---------------------------------------------------------------------------
// Per-test report
// ---------------------------------------------------------------------------

const VocabTestReportRef = builder.objectRef<VocabTestReport>("VocabTestReport");
VocabTestReportRef.implement({
  description: "Per-test report: roster of derived results + class roll-up + most-missed (VC-4, J5).",
  fields: (t) => ({
    test: t.field({ type: VocabTestMetaRef, resolve: (r) => r.test }),
    rollup: t.field({ type: ScoreRollupRef, resolve: (r) => r.rollup }),
    students: t.field({ type: [DerivedStudentResultRef], resolve: (r) => r.students }),
    mostMissed: t.field({ type: [MissedWordRef], resolve: (r) => r.mostMissed }),
  }),
});

// ---------------------------------------------------------------------------
// Per-student dashboard
// ---------------------------------------------------------------------------

interface StudentTestEntry {
  test: VocabTestMeta;
  result: DerivedStudentResult;
}
const StudentTestEntryRef = builder.objectRef<StudentTestEntry>("VocabStudentTestEntry");
StudentTestEntryRef.implement({
  fields: (t) => ({
    test: t.field({ type: VocabTestMetaRef, resolve: (e) => e.test }),
    result: t.field({ type: DerivedStudentResultRef, resolve: (e) => e.result }),
  }),
});

const VocabStudentDashboardRef = builder.objectRef<VocabStudentDashboard>("VocabStudentDashboard");
VocabStudentDashboardRef.implement({
  description: "Per-student dashboard: per-test history + roll-up + persistent weak words (VC-4, J5).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    perTest: t.field({ type: [StudentTestEntryRef], resolve: (d) => d.perTest }),
    rollup: t.field({ type: ScoreRollupRef, resolve: (d) => d.rollup }),
    persistentWords: t.field({ type: [PersistentWordRef], resolve: (d) => d.persistentWords }),
  }),
});

// ---------------------------------------------------------------------------
// Class dashboard
// ---------------------------------------------------------------------------

interface ClassTestEntry {
  test: VocabTestMeta;
  rollup: ScoreRollup;
}
const ClassTestEntryRef = builder.objectRef<ClassTestEntry>("VocabClassTestEntry");
ClassTestEntryRef.implement({
  fields: (t) => ({
    test: t.field({ type: VocabTestMetaRef, resolve: (e) => e.test }),
    rollup: t.field({ type: ScoreRollupRef, resolve: (e) => e.rollup }),
  }),
});

const VocabClassDashboardRef = builder.objectRef<VocabClassDashboard>("VocabClassDashboard");
VocabClassDashboardRef.implement({
  description: "Class dashboard: per-test summaries + class roll-up + most-missed (VC-4, J5).",
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    program: t.string({ nullable: true, resolve: (d) => d.program }),
    tests: t.field({ type: [ClassTestEntryRef], resolve: (d) => d.tests }),
    rollup: t.field({ type: ScoreRollupRef, resolve: (d) => d.rollup }),
    mostMissed: t.field({ type: [MissedWordRef], resolve: (d) => d.mostMissed }),
  }),
});

// ---------------------------------------------------------------------------
// Cumulative
// ---------------------------------------------------------------------------

const VocabCumulativeRef = builder.objectRef<VocabStudentCumulative>("VocabStudentCumulative");
VocabCumulativeRef.implement({
  description: "A student's cumulative period roll-up (Weekly/Monthly/Last-N; §9, VC-4).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    program: t.string({ nullable: true, resolve: (c) => c.program }),
    mode: t.exposeString("mode"),
    periodLabel: t.exposeString("periodLabel"),
    numTests: t.exposeInt("numTests"),
    rollup: t.field({ type: ScoreRollupRef, resolve: (c) => c.rollup }),
    persistentWords: t.field({ type: [PersistentWordRef], resolve: (c) => c.persistentWords }),
    testIds: t.exposeStringList("testIds"),
  }),
});

// ---------------------------------------------------------------------------
// Message-generation result shapes
// ---------------------------------------------------------------------------

const VocabMessageRecipientRef = builder.objectRef<VocabMessageRecipient>("VocabMessageRecipient");
VocabMessageRecipientRef.implement({
  description: "A generated per-student guardian message + delivery handles (VC-4, §8).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    kind: t.exposeString("kind"),
    messageBn: t.exposeString("messageBn"),
    waLink: t.string({ nullable: true, resolve: (r) => r.waLink }),
    unreachableByWa: t.exposeBoolean("unreachableByWa"),
    notifiedGuardianIds: t.exposeStringList("notifiedGuardianIds"),
  }),
});

const GenerateVocabMessagesResultRef = builder.objectRef<GenerateVocabMessagesResult>("GenerateVocabMessagesResult");
GenerateVocabMessagesResultRef.implement({
  fields: (t) => ({
    testId: t.exposeString("testId"),
    recipients: t.field({ type: [VocabMessageRecipientRef], resolve: (r) => r.recipients }),
    unreachableCount: t.exposeInt("unreachableCount"),
  }),
});

const GenerateVocabCumulativeResultRef = builder.objectRef<GenerateVocabCumulativeResult>("GenerateVocabCumulativeResult");
GenerateVocabCumulativeResultRef.implement({
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    program: t.string({ nullable: true, resolve: (r) => r.program }),
    recipients: t.field({ type: [VocabMessageRecipientRef], resolve: (r) => r.recipients }),
    unreachableCount: t.exposeInt("unreachableCount"),
  }),
});

// ---------------------------------------------------------------------------
// Queries (tracker:read)
// ---------------------------------------------------------------------------

builder.queryField("vocabTestReport", (t) =>
  t.field({
    type: VocabTestReportRef,
    nullable: true,
    description: "Per-test report: derived results + roll-up + most-missed (VC-4, J5). Requires tracker:read.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      testId: t.arg.string({ required: true }),
      classPersistentPct: t.arg.float({ required: false }),
    },
    resolve: async (_root, args) =>
      vocabTestReport(args.testId, args.classPersistentPct != null ? { persistentClassPct: args.classPersistentPct } : undefined),
  }),
);

builder.queryField("vocabStudentDashboard", (t) =>
  t.field({
    type: VocabStudentDashboardRef,
    description: "Per-student dashboard + persistent weak words (VC-4, J5). Requires tracker:read.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      studentId: t.arg.string({ required: true }),
      program: t.arg.string({ required: false }),
      persistentMinTests: t.arg.int({ required: false }),
    },
    resolve: async (_root, args) =>
      vocabStudentDashboard(args.studentId, {
        program: args.program ?? null,
        thresholds: args.persistentMinTests != null ? { persistentStudentMinTests: args.persistentMinTests } : null,
      }),
  }),
);

builder.queryField("vocabClassDashboard", (t) =>
  t.field({
    type: VocabClassDashboardRef,
    description: "Class dashboard: per-test summaries + most-missed (VC-4, J5). Requires tracker:read.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      program: t.arg.string({ required: false }),
      classPersistentPct: t.arg.float({ required: false }),
    },
    resolve: async (_root, args) =>
      vocabClassDashboard(args.sectionId, {
        program: args.program ?? null,
        thresholds: args.classPersistentPct != null ? { persistentClassPct: args.classPersistentPct } : null,
      }),
  }),
);

builder.queryField("vocabStudentCumulative", (t) =>
  t.field({
    type: VocabCumulativeRef,
    description:
      "A student's cumulative roll-up over the active period (Weekly/Monthly/Last-N; §9, VC-4). " +
      "asOf selects the window deterministically. Requires tracker:read.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      studentId: t.arg.string({ required: true }),
      program: t.arg.string({ required: false }),
      mode: t.arg.string({ required: false }),
      asOf: t.arg.string({ required: false }),
      n: t.arg.int({ required: false }),
      persistentMinTests: t.arg.int({ required: false }),
    },
    resolve: async (_root, args) =>
      vocabStudentCumulative(args.studentId, {
        program: args.program ?? null,
        mode: (args.mode as CumulativeMode | null) ?? null,
        asOf: args.asOf ? parseDate(args.asOf, "asOf") : new Date(),
        n: args.n ?? null,
        thresholds: args.persistentMinTests != null ? { persistentStudentMinTests: args.persistentMinTests } : null,
      }),
  }),
);

// ---------------------------------------------------------------------------
// Mutations (message:dispatch — Principal/Teacher/Office; Guardian denied)
// ---------------------------------------------------------------------------

builder.mutationField("generateVocabTestMessages", (t) =>
  t.field({
    type: GenerateVocabMessagesResultRef,
    description:
      "Generate + deliver the per-student guardian messages for a marked test: wa.me for every " +
      "family (ADR-003) + in-app Notification for login-enabled guardians (D-#72). Requires " +
      "message:dispatch. Audited.",
    authScopes: { hasPermission: "message:dispatch" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) =>
      generateVocabTestMessages({ testId: args.testId, actorId: ctx.auth!.userId }),
  }),
);

builder.mutationField("generateVocabCumulativeMessages", (t) =>
  t.field({
    type: GenerateVocabCumulativeResultRef,
    description:
      "Generate + deliver per-student CUMULATIVE guardian messages for a section over the active " +
      "period (§8/§9). wa.me + emit() as the per-test path. Requires message:dispatch. Audited.",
    authScopes: { hasPermission: "message:dispatch" },
    args: {
      sectionId: t.arg.string({ required: true }),
      program: t.arg.string({ required: false }),
      mode: t.arg.string({ required: false }),
      asOf: t.arg.string({ required: false }),
      n: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) =>
      generateVocabCumulativeMessages({
        sectionId: args.sectionId,
        program: args.program ?? null,
        mode: (args.mode as CumulativeMode | null) ?? null,
        asOf: args.asOf ? parseDate(args.asOf, "asOf") : new Date(),
        n: args.n ?? null,
        actorId: ctx.auth!.userId,
      }),
  }),
);
