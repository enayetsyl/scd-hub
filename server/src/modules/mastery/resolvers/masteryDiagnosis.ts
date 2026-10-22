/**
 * Mastery tracker — diagnosis views and the quality report (M-3, docs/prd-mastery.md §5.3/§6.4).
 *
 *   masteryStudentDiagnosis  — mastery:view; one student × subject, every locked outcome's state (I1)
 *   masteryOutcomeTrail      — mastery:view; one student × outcome, state path + evidence (I2)
 *   masterySectionHeatmap    — mastery:view; outcomes taught × students, section %, trigger (I3)
 *   masteryQualityPapersPage — mastery:view; confirmed sheets with mean % and flagged items (I4)
 *   masteryPaperQuality      — mastery:view; one sheet's per-item quality + exclusions (I4)
 *   excludeMasteryItem       — mastery:enter_results; take an item / bank question out of diagnosis
 *   revokeMasteryExclusion   — mastery:enter_results; bring it back
 *
 * The catalogue action is the gate; the ROW rule (routine holder, or `mastery:edit_all`) is in
 * the service (D-#807).
 */
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import type { MasterySubject } from "@scd/shared";
import {
  excludeItem,
  outcomeTrail,
  paperQualityDetail,
  qualityPapersPage,
  revokeExclusion,
  sectionHeatmap,
  studentDiagnosis,
  type ExclusionView,
  type HeatOutcome,
  type OutcomeStateView,
  type OutcomeTrail,
  type PaperQualityDetail,
  type QualityPaperRow,
  type SectionHeatmap,
  type StudentDiagnosis,
  type TrailRow,
} from "../services/MasteryDiagnosisService";
import type { Auth } from "../services/MasteryWorkService";
import type { MasteryExclusionScope } from "../models/MasteryExclusion";
import { PaperRef } from "./masteryWork";

function authOf(ctx: { auth: Auth | null }): Auth {
  if (!ctx.auth) throw new Error("লগইন প্রয়োজন।");
  return ctx.auth;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

const StateRef = builder.objectRef<OutcomeStateView>("MasteryOutcomeState");
StateRef.implement({
  description: "One student's state on one outcome, computed on read from the live evidence (D-#808).",
  fields: (t) => ({
    loCode: t.exposeString("loCode"),
    labelBn: t.exposeString("labelBn"),
    chapterNumber: t.int({ nullable: true, resolve: (s) => s.chapterNumber }),
    strand: t.string({ nullable: true, resolve: (s) => s.strand }),
    state: t.exposeString("state"),
    since: t.string({ nullable: true, resolve: (s) => s.since }),
    lastEvidenceAt: t.string({ nullable: true, resolve: (s) => s.lastEvidenceAt }),
    evidenceCount: t.exposeInt("evidenceCount"),
    assessments: t.exposeInt("assessments"),
    earnedPct: t.int({ nullable: true, resolve: (s) => s.earnedPct }),
    recentPct: t.int({ nullable: true, resolve: (s) => s.recentPct }),
    sectionMeanPct: t.int({ nullable: true, resolve: (s) => s.sectionMeanPct }),
    reworkCount: t.exposeInt("reworkCount"),
    reasons: t.exposeStringList("reasons"),
    nextRevisionAt: t.string({ nullable: true, resolve: (s) => s.nextRevisionAt }),
  }),
});

const StudentDiagnosisRef = builder.objectRef<StudentDiagnosis>("MasteryStudentDiagnosis");
StudentDiagnosisRef.implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    rollNumber: t.string({ nullable: true, resolve: (s) => s.rollNumber }),
    sectionId: t.exposeString("sectionId"),
    sectionName: t.exposeString("sectionName"),
    className: t.exposeString("className"),
    classToken: t.exposeString("classToken"),
    subject: t.exposeString("subject"),
    subjects: t.exposeStringList("subjects"),
    outcomes: t.field({ type: [StateRef], resolve: (s) => s.outcomes }),
    sectionSize: t.exposeInt("sectionSize"),
    moreWeakThan: t.exposeInt("moreWeakThan"),
  }),
});

const TagRef = builder.objectRef<{ code: string; labelBn: string }>("MasteryTagLabel");
TagRef.implement({ fields: (t) => ({ code: t.exposeString("code"), labelBn: t.exposeString("labelBn") }) });

const TrailRowRef = builder.objectRef<TrailRow>("MasteryTrailRow");
TrailRowRef.implement({
  fields: (t) => ({
    paperId: t.exposeString("paperId"),
    source: t.exposeString("source"),
    title: t.string({ nullable: true, resolve: (r) => r.title }),
    date: t.exposeString("date"),
    itemNo: t.int({ nullable: true, resolve: (r) => r.itemNo }),
    qid: t.string({ nullable: true, resolve: (r) => r.qid }),
    questionTypeCode: t.string({ nullable: true, resolve: (r) => r.questionTypeCode }),
    earned: t.exposeFloat("earned"),
    available: t.exposeFloat("available"),
    rubricStep: t.int({ nullable: true, resolve: (r) => r.rubricStep }),
    rework: t.exposeBoolean("rework"),
    workRework: t.exposeBoolean("workRework"),
    signal: t.exposeString("signal"),
    routed: t.exposeBoolean("routed"),
    tags: t.field({ type: [TagRef], resolve: (r) => r.tags }),
    excluded: t.exposeBoolean("excluded"),
    excludeReason: t.string({ nullable: true, resolve: (r) => r.excludeReason }),
  }),
});

const HistoryRef = builder.objectRef<OutcomeTrail["history"][number]>("MasteryStateStep");
HistoryRef.implement({
  fields: (t) => ({
    state: t.exposeString("state"),
    at: t.exposeString("at"),
    paperId: t.string({ nullable: true, resolve: (h) => h.paperId }),
  }),
});

const TrailRef = builder.objectRef<OutcomeTrail>("MasteryOutcomeTrail");
TrailRef.implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    outcome: t.field({ type: StateRef, resolve: (x) => x.outcome }),
    homeTipBn: t.string({ nullable: true, resolve: (x) => x.outcome.homeTipBn }),
    history: t.field({ type: [HistoryRef], resolve: (x) => x.history }),
    rows: t.field({ type: [TrailRowRef], resolve: (x) => x.rows }),
    bankGold: t.exposeInt("bankGold"),
    bankSeen: t.exposeInt("bankSeen"),
  }),
});

const HeatCellRef = builder.objectRef<HeatOutcome["cells"][number]>("MasteryHeatCell");
HeatCellRef.implement({
  fields: (t) => ({ state: t.exposeString("state"), pct: t.int({ nullable: true, resolve: (c) => c.pct }) }),
});

const HeatOutcomeRef = builder.objectRef<HeatOutcome>("MasteryHeatOutcome");
HeatOutcomeRef.implement({
  fields: (t) => ({
    loCode: t.exposeString("loCode"),
    labelBn: t.exposeString("labelBn"),
    chapterNumber: t.int({ nullable: true, resolve: (o) => o.chapterNumber }),
    strand: t.string({ nullable: true, resolve: (o) => o.strand }),
    assessments: t.exposeInt("assessments"),
    weak: t.exposeInt("weak"),
    verdicts: t.exposeInt("verdicts"),
    weakPct: t.int({ nullable: true, resolve: (o) => o.weakPct }),
    triggered: t.exposeBoolean("triggered"),
    sectionMeanPct: t.int({ nullable: true, resolve: (o) => o.sectionMeanPct }),
    actionId: t.string({ nullable: true, resolve: (o) => o.actionId }),
    actionStatus: t.string({ nullable: true, resolve: (o) => o.actionStatus }),
    cells: t.field({ type: [HeatCellRef], resolve: (o) => o.cells }),
  }),
});

const HeatStudentRef = builder.objectRef<SectionHeatmap["students"][number]>("MasteryHeatStudent");
HeatStudentRef.implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    rollNumber: t.string({ nullable: true, resolve: (s) => s.rollNumber }),
    weakCount: t.exposeInt("weakCount"),
  }),
});

const HeatmapRef = builder.objectRef<SectionHeatmap>("MasterySectionHeatmap");
HeatmapRef.implement({
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    sectionName: t.exposeString("sectionName"),
    className: t.exposeString("className"),
    subject: t.exposeString("subject"),
    triggerPct: t.exposeInt("triggerPct"),
    students: t.field({ type: [HeatStudentRef], resolve: (h) => h.students }),
    outcomes: t.field({ type: [HeatOutcomeRef], resolve: (h) => h.outcomes }),
    notYetAssessed: t.exposeInt("notYetAssessed"),
  }),
});

const QualityPaperRef = builder.objectRef<QualityPaperRow>("MasteryQualityPaper");
QualityPaperRef.implement({
  fields: (t) => ({
    paper: t.field({ type: PaperRef, resolve: (q) => q.paper }),
    students: t.exposeInt("students"),
    meanPct: t.int({ nullable: true, resolve: (q) => q.meanPct }),
    flagged: t.exposeInt("flagged"),
  }),
});
const QualityPaperPageRef = pageRef("MasteryQualityPaperPage", QualityPaperRef);

const ExclusionRef = builder.objectRef<ExclusionView>("MasteryExclusion");
ExclusionRef.implement({
  description: "A teacher's 'do not use in diagnosis' for their section (D-#782). QID scope covers every sheet with that bank question.",
  fields: (t) => ({
    id: t.exposeString("id"),
    scope: t.exposeString("scope"),
    paperId: t.exposeString("paperId"),
    itemNo: t.exposeInt("itemNo"),
    qid: t.string({ nullable: true, resolve: (x) => x.qid }),
    reason: t.exposeString("reason"),
    at: t.exposeString("at"),
    byName: t.exposeString("byName"),
  }),
});

const ItemQualityRef = builder.objectRef<PaperQualityDetail["items"][number]>("MasteryItemQuality");
ItemQualityRef.implement({
  fields: (t) => ({
    itemNo: t.exposeInt("itemNo"),
    students: t.exposeInt("students"),
    facility: t.int({ nullable: true, resolve: (i) => i.facility }),
    reworkRate: t.int({ nullable: true, resolve: (i) => i.reworkRate }),
    meanPct: t.int({ nullable: true, resolve: (i) => i.meanPct }),
    discrimination: t.int({ nullable: true, resolve: (i) => i.discrimination }),
    topMeanPct: t.int({ nullable: true, resolve: (i) => i.topMeanPct }),
    signals: t.stringList({ resolve: (i) => i.signals }),
    exclusion: t.field({ type: ExclusionRef, nullable: true, resolve: (i) => i.exclusion }),
  }),
});

const PaperQualityRef = builder.objectRef<PaperQualityDetail>("MasteryPaperQuality");
PaperQualityRef.implement({
  fields: (t) => ({
    paper: t.field({ type: PaperRef, resolve: (q) => q.paper }),
    students: t.exposeInt("students"),
    rosterSize: t.exposeInt("rosterSize"),
    meanPct: t.int({ nullable: true, resolve: (q) => q.meanPct }),
    flagged: t.exposeInt("flagged"),
    items: t.field({ type: [ItemQualityRef], resolve: (q) => q.items }),
  }),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryFields((t) => ({
  masteryStudentDiagnosis: t.field({
    type: StudentDiagnosisRef,
    description: "One student × subject: every locked outcome with its state. Routine holder or mastery:edit_all.",
    authScopes: { hasPermission: "mastery:view" },
    args: { studentId: t.arg.string({ required: true }), subject: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => studentDiagnosis(args.studentId, args.subject as MasterySubject, authOf(ctx)),
  }),

  masteryOutcomeTrail: t.field({
    type: TrailRef,
    description: "One student × outcome: the state path, every evidence row (excluded ones marked) and bank coverage.",
    authScopes: { hasPermission: "mastery:view" },
    args: { studentId: t.arg.string({ required: true }), loCode: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => outcomeTrail(args.studentId, args.loCode, authOf(ctx)),
  }),

  masterySectionHeatmap: t.field({
    type: HeatmapRef,
    description: "One section × subject: outcomes with evidence × students, the section weak % and the trigger flag.",
    authScopes: { hasPermission: "mastery:view" },
    args: { sectionId: t.arg.string({ required: true }), subject: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => sectionHeatmap(args.sectionId, args.subject as MasterySubject, authOf(ctx)),
  }),

  masteryQualityPapersPage: t.field({
    type: QualityPaperPageRef,
    description: "Confirmed question sheets of one section × subject with their mean % and flagged items, newest first.",
    authScopes: { hasPermission: "mastery:view" },
    args: {
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      page: t.arg.int({ required: false }),
      pageSize: t.arg.int({ required: false }),
    },
    resolve: async (_r, args, ctx) => qualityPapersPage(args.sectionId, args.subject as MasterySubject, args, authOf(ctx)),
  }),

  masteryPaperQuality: t.field({
    type: PaperQualityRef,
    description: "One sheet's per-item facility, re-work rate, discrimination and signals, with any exclusion (D-#782).",
    authScopes: { hasPermission: "mastery:view" },
    args: { paperId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => paperQualityDetail(args.paperId, authOf(ctx)),
  }),
}));

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationFields((t) => ({
  excludeMasteryItem: t.field({
    type: ExclusionRef,
    description: "Take an item (scope ITEM) or a bank question (scope QID, every sheet) out of this section's diagnosis. Reason required.",
    authScopes: { hasPermission: "mastery:enter_results" },
    args: {
      paperId: t.arg.string({ required: true }),
      itemNo: t.arg.int({ required: true }),
      scope: t.arg.string({ required: true }),
      reason: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) =>
      excludeItem(args.paperId, args.itemNo, args.scope as MasteryExclusionScope, args.reason, authOf(ctx)),
  }),

  revokeMasteryExclusion: t.field({
    type: "Boolean",
    description: "Bring an excluded item back into diagnosis.",
    authScopes: { hasPermission: "mastery:enter_results" },
    args: { exclusionId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => revokeExclusion(args.exclusionId, authOf(ctx)),
  }),
}));
