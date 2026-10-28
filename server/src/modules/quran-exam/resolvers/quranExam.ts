/**
 * Quran oral exam resolvers (D-#873–#877, docs/prd-quran-exam.md).
 *
 *   quranExams                 — view|manage: every exam's plan, papers and day counts.
 *   quranExamDay               — view|manage: one day's examiners and their sittings.
 *   quranExamExaminerCandidates— manage: teachers who can be added as an examiner.
 *   quranExamResults           — view|manage|edit_all: per-student marks, computed on read.
 *   quranExamSitting           — any staff action: one sitting + paper; the service lets an
 *                                examiner read only their own, published sittings.
 *   myQuranExamSittings        — examine (SELF): the caller's own published sittings.
 *   saveQuranExamPaper / moveQuranExamSitting / add|removeQuranExamExaminer /
 *   scheduleQuranExamMakeUp    — manage.
 *   saveQuranExamResult        — examine (own sitting) | edit_all.
 *   publishQuranExam           — publish.   lockQuranExamMarks — lock.
 *   myQuranExamSchedule / acknowledgeQuranExamNotice — guardian plane (guardian:read_child).
 */
import { builder } from "../../../schema";
import {
  acknowledgeQuranExamNotice,
  addQuranExamExaminer,
  lockQuranExamMarks,
  moveQuranExamSitting,
  myQuranExamSchedule,
  myQuranExamSittings,
  publishQuranExam,
  quranExamDay,
  quranExamExaminerCandidates,
  quranExamOverviews,
  quranExamResults,
  quranExamSittingDetail,
  removeQuranExamExaminer,
  saveQuranExamPaper,
  saveQuranExamResult,
  scheduleQuranExamMakeUp,
  type GuardianExamChildShape,
  type GuardianExamSittingShape,
  type QuranExamDayExaminerShape,
  type QuranExamDayShape,
  type QuranExamDaySummaryShape,
  type QuranExamOverviewShape,
  type QuranExamPaperShape,
  type QuranExamSittingDetailShape,
  type QuranExamSittingShape,
  type QuranExamStudentResultShape,
} from "../services/QuranExamService";
import type { QuranExamScheme } from "../models/QuranExamPaper";
import type { QuranExamAbsenceReason } from "../models/QuranExamSitting";

type Item = { label: string; marks: number };
type Section = { title: string; items: Item[] };
type HifzCount = { para: number; tanbih: number; fath: number };

const ItemRef = builder.objectRef<Item>("QuranExamPaperItem");
ItemRef.implement({ fields: (t) => ({ label: t.exposeString("label"), marks: t.exposeInt("marks") }) });

const SectionRef = builder.objectRef<Section>("QuranExamPaperSection");
SectionRef.implement({ fields: (t) => ({ title: t.exposeString("title"), items: t.field({ type: [ItemRef], resolve: (s) => s.items }) }) });

const PaperRef = builder.objectRef<QuranExamPaperShape>("QuranExamPaper");
PaperRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    level: t.exposeString("level"),
    // ITEMS | HIFZ_DEDUCTION
    scheme: t.exposeString("scheme"),
    fullMarks: t.exposeInt("fullMarks"),
    durationMin: t.exposeInt("durationMin"),
    sections: t.field({ type: [SectionRef], resolve: (p) => p.sections }),
    paras: t.exposeIntList("paras"),
    tanbihPerMark: t.int({ nullable: true, resolve: (p) => p.tanbihPerMark }),
    fathCost: t.int({ nullable: true, resolve: (p) => p.fathCost }),
    frozen: t.exposeBoolean("frozen"),
  }),
});

const HifzCountRef = builder.objectRef<HifzCount>("QuranExamHifzCount");
HifzCountRef.implement({
  fields: (t) => ({ para: t.exposeInt("para"), tanbih: t.exposeInt("tanbih"), fath: t.exposeInt("fath") }),
});

const SittingRef = builder.objectRef<QuranExamSittingShape>("QuranExamSitting");
SittingRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    classLabelBn: t.exposeString("classLabelBn"),
    level: t.exposeString("level"),
    dateKey: t.exposeString("dateKey"),
    start: t.exposeString("start"),
    end: t.exposeString("end"),
    examinerId: t.exposeString("examinerId"),
    examinerName: t.exposeString("examinerName"),
    paras: t.exposeIntList("paras"),
    portionLabel: t.exposeString("portionLabel"),
    // SCHEDULED | DONE | ABSENT
    status: t.exposeString("status"),
    // Flat, in paper order (section by section).
    itemMarks: t.intList({ nullable: true, resolve: (s) => (s.itemMarks ? s.itemMarks.flat() : null) }),
    hifzCounts: t.field({ type: [HifzCountRef], resolve: (s) => s.hifzCounts }),
    comment: t.string({ nullable: true, resolve: (s) => s.comment }),
    absenceReason: t.string({ nullable: true, resolve: (s) => s.absenceReason }),
    total: t.int({ nullable: true, resolve: (s) => s.total }),
    enteredAt: t.string({ nullable: true, resolve: (s) => s.enteredAt }),
    madeUp: t.exposeBoolean("madeUp"),
  }),
});

const DaySummaryRef = builder.objectRef<QuranExamDaySummaryShape>("QuranExamDaySummary");
DaySummaryRef.implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    sittings: t.exposeInt("sittings"),
    done: t.exposeInt("done"),
    absent: t.exposeInt("absent"),
    pending: t.exposeInt("pending"),
    examiners: t.exposeInt("examiners"),
  }),
});

const OverviewRef = builder.objectRef<QuranExamOverviewShape>("QuranExamOverview");
OverviewRef.implement({
  fields: (t) => ({
    examId: t.exposeString("examId"),
    examName: t.exposeString("examName"),
    // DRAFT | PUBLISHED
    status: t.exposeString("status"),
    publishedAt: t.string({ nullable: true, resolve: (o) => o.publishedAt }),
    marksLockedAt: t.string({ nullable: true, resolve: (o) => o.marksLockedAt }),
    makeUpDateKey: t.string({ nullable: true, resolve: (o) => o.makeUpDateKey }),
    papers: t.field({ type: [PaperRef], resolve: (o) => o.papers }),
    days: t.field({ type: [DaySummaryRef], resolve: (o) => o.days }),
  }),
});

const DayExaminerRef = builder.objectRef<QuranExamDayExaminerShape>("QuranExamDayExaminer");
DayExaminerRef.implement({
  fields: (t) => ({
    userId: t.exposeString("userId"),
    name: t.exposeString("name"),
    sittings: t.field({ type: [SittingRef], resolve: (e) => e.sittings }),
  }),
});

const DayRef = builder.objectRef<QuranExamDayShape>("QuranExamDay");
DayRef.implement({
  fields: (t) => ({
    examId: t.exposeString("examId"),
    dateKey: t.exposeString("dateKey"),
    examiners: t.field({ type: [DayExaminerRef], resolve: (d) => d.examiners }),
  }),
});

const CandidateRef = builder.objectRef<{ userId: string; name: string }>("QuranExamExaminerCandidate");
CandidateRef.implement({ fields: (t) => ({ userId: t.exposeString("userId"), name: t.exposeString("name") }) });

const ResultRef = builder.objectRef<QuranExamStudentResultShape>("QuranExamStudentResult");
ResultRef.implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    classLabelBn: t.exposeString("classLabelBn"),
    level: t.exposeString("level"),
    fullMarks: t.exposeInt("fullMarks"),
    mark: t.int({ nullable: true, resolve: (r) => r.mark }),
    done: t.exposeInt("done"),
    sittings: t.exposeInt("sittings"),
    absent: t.exposeBoolean("absent"),
    tanbih: t.int({ nullable: true, resolve: (r) => r.tanbih }),
    fath: t.int({ nullable: true, resolve: (r) => r.fath }),
  }),
});

type HifzSoFar = NonNullable<QuranExamSittingDetailShape["hifzSoFar"]>;
const HifzSoFarRef = builder.objectRef<HifzSoFar>("QuranExamHifzResult");
HifzSoFarRef.implement({
  fields: (t) => ({
    tanbih: t.exposeInt("tanbih"),
    fath: t.exposeInt("fath"),
    tanbihCut: t.exposeInt("tanbihCut"),
    fathCut: t.exposeInt("fathCut"),
    mark: t.exposeInt("mark"),
  }),
});

const DetailRef = builder.objectRef<QuranExamSittingDetailShape>("QuranExamSittingDetail");
DetailRef.implement({
  fields: (t) => ({
    sitting: t.field({ type: SittingRef, resolve: (d) => d.sitting }),
    paper: t.field({ type: PaperRef, resolve: (d) => d.paper }),
    otherSittings: t.field({ type: [SittingRef], resolve: (d) => d.otherSittings }),
    hifzSoFar: t.field({ type: HifzSoFarRef, nullable: true, resolve: (d) => d.hifzSoFar }),
    locked: t.exposeBoolean("locked"),
    canEdit: t.exposeBoolean("canEdit"),
  }),
});

const GuardianSittingRef = builder.objectRef<GuardianExamSittingShape>("QuranExamGuardianSitting");
GuardianSittingRef.implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    start: t.exposeString("start"),
    end: t.exposeString("end"),
    portionLabel: t.exposeString("portionLabel"),
    status: t.exposeString("status"),
    changed: t.exposeBoolean("changed"),
    fromDateKey: t.string({ nullable: true, resolve: (s) => s.fromDateKey }),
    fromStart: t.string({ nullable: true, resolve: (s) => s.fromStart }),
    fromEnd: t.string({ nullable: true, resolve: (s) => s.fromEnd }),
  }),
});

const GuardianChildRef = builder.objectRef<GuardianExamChildShape>("QuranExamGuardianChild");
GuardianChildRef.implement({
  fields: (t) => ({
    examId: t.exposeString("examId"),
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    level: t.exposeString("level"),
    // NONE | SCHEDULE | CHANGED
    notice: t.exposeString("notice"),
    version: t.exposeInt("version"),
    sittings: t.field({ type: [GuardianSittingRef], resolve: (c) => c.sittings }),
  }),
});

const SectionInput = builder.inputType("QuranExamSectionInput", {
  fields: (t) => ({
    title: t.string({ required: true }),
    labels: t.stringList({ required: true }),
    marks: t.intList({ required: true }),
  }),
});

const HifzCountInput = builder.inputType("QuranExamHifzCountInput", {
  fields: (t) => ({
    para: t.int({ required: true }),
    tanbih: t.int({ required: true }),
    fath: t.int({ required: true }),
  }),
});

// ── Queries ──────────────────────────────────────────────────────────────────

builder.queryField("quranExams", (t) =>
  t.field({
    type: [OverviewRef],
    authScopes: { hasAnyPermission: ["quran_exam:view", "quran_exam:manage"] },
    resolve: () => quranExamOverviews(),
  }),
);

builder.queryField("quranExamDay", (t) =>
  t.field({
    type: DayRef,
    authScopes: { hasAnyPermission: ["quran_exam:view", "quran_exam:manage"] },
    args: { examId: t.arg.string({ required: true }), dateKey: t.arg.string({ required: true }) },
    resolve: (_r, args) => quranExamDay(args.examId, args.dateKey),
  }),
);

builder.queryField("quranExamExaminerCandidates", (t) =>
  t.field({
    type: [CandidateRef],
    authScopes: { hasPermission: "quran_exam:manage" },
    resolve: () => quranExamExaminerCandidates(),
  }),
);

builder.queryField("quranExamResults", (t) =>
  t.field({
    type: [ResultRef],
    authScopes: { hasAnyPermission: ["quran_exam:view", "quran_exam:manage", "quran_exam:edit_all"] },
    args: { examId: t.arg.string({ required: true }) },
    resolve: (_r, args) => quranExamResults(args.examId),
  }),
);

builder.queryField("quranExamSitting", (t) =>
  t.field({
    type: DetailRef,
    // The service narrows `examine` to the caller's own, published sittings.
    authScopes: {
      hasAnyPermission: ["quran_exam:view", "quran_exam:manage", "quran_exam:edit_all", "quran_exam:examine"],
    },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => quranExamSittingDetail(ctx, args.id),
  }),
);

builder.queryField("myQuranExamSittings", (t) =>
  t.field({
    type: [SittingRef],
    authScopes: { hasPermission: "quran_exam:examine" },
    args: { fromDateKey: t.arg.string({ required: false }) },
    resolve: (_r, args, ctx) => myQuranExamSittings(ctx, args.fromDateKey ?? null),
  }),
);

builder.queryField("myQuranExamSchedule", (t) =>
  t.field({
    type: [GuardianChildRef],
    authScopes: { hasPermission: "guardian:read_child" },
    resolve: (_r, _a, ctx) => myQuranExamSchedule(ctx.auth!.userId),
  }),
);

// ── Mutations ────────────────────────────────────────────────────────────────

builder.mutationField("saveQuranExamPaper", (t) =>
  t.field({
    type: PaperRef,
    authScopes: { hasPermission: "quran_exam:manage" },
    args: {
      examId: t.arg.string({ required: true }),
      level: t.arg.string({ required: true }),
      scheme: t.arg.string({ required: true }),
      fullMarks: t.arg.int({ required: true }),
      durationMin: t.arg.int({ required: true }),
      sections: t.arg({ type: [SectionInput], required: false }),
      paras: t.arg.intList({ required: false }),
      tanbihPerMark: t.arg.int({ required: false }),
      fathCost: t.arg.int({ required: false }),
    },
    resolve: (_r, args, ctx) =>
      saveQuranExamPaper(ctx, args.examId, {
        level: args.level,
        scheme: args.scheme as QuranExamScheme,
        fullMarks: args.fullMarks,
        durationMin: args.durationMin,
        sections: (args.sections ?? []).map((s) => ({
          title: s.title,
          items: s.labels.map((label, i) => ({ label, marks: s.marks[i] ?? 0 })),
        })),
        paras: args.paras ?? undefined,
        tanbihPerMark: args.tanbihPerMark ?? undefined,
        fathCost: args.fathCost ?? undefined,
      }),
  }),
);

builder.mutationField("moveQuranExamSitting", (t) =>
  t.field({
    type: SittingRef,
    authScopes: { hasPermission: "quran_exam:manage" },
    args: { id: t.arg.string({ required: true }), toExaminerId: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => moveQuranExamSitting(ctx, args.id, args.toExaminerId),
  }),
);

builder.mutationField("addQuranExamExaminer", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "quran_exam:manage" },
    args: {
      examId: t.arg.string({ required: true }),
      dateKey: t.arg.string({ required: true }),
      userId: t.arg.string({ required: true }),
    },
    resolve: (_r, args, ctx) => addQuranExamExaminer(ctx, args.examId, args.dateKey, args.userId),
  }),
);

builder.mutationField("removeQuranExamExaminer", (t) =>
  t.field({
    type: "Int",
    authScopes: { hasPermission: "quran_exam:manage" },
    args: {
      examId: t.arg.string({ required: true }),
      dateKey: t.arg.string({ required: true }),
      userId: t.arg.string({ required: true }),
    },
    resolve: (_r, args, ctx) => removeQuranExamExaminer(ctx, args.examId, args.dateKey, args.userId),
  }),
);

builder.mutationField("scheduleQuranExamMakeUp", (t) =>
  t.field({
    type: SittingRef,
    authScopes: { hasPermission: "quran_exam:manage" },
    args: {
      id: t.arg.string({ required: true }),
      dateKey: t.arg.string({ required: true }),
      start: t.arg.string({ required: true }),
      examinerId: t.arg.string({ required: true }),
    },
    resolve: (_r, args, ctx) => scheduleQuranExamMakeUp(ctx, args.id, args.dateKey, args.start, args.examinerId),
  }),
);

builder.mutationField("saveQuranExamResult", (t) =>
  t.field({
    type: DetailRef,
    // The service admits `examine` only on the caller's own sitting; `edit_all` on any.
    authScopes: { hasAnyPermission: ["quran_exam:examine", "quran_exam:edit_all"] },
    args: {
      id: t.arg.string({ required: true }),
      present: t.arg.boolean({ required: true }),
      // Flat, in paper order; the service reshapes it by the paper's sections.
      itemMarks: t.arg.intList({ required: false }),
      hifzCounts: t.arg({ type: [HifzCountInput], required: false }),
      absenceReason: t.arg.string({ required: false }),
      comment: t.arg.string({ required: false }),
    },
    resolve: (_r, args, ctx) =>
      saveQuranExamResult(ctx, args.id, {
        present: args.present,
        itemMarksFlat: args.itemMarks ?? null,
        hifzCounts: args.hifzCounts ?? null,
        absenceReason: (args.absenceReason as QuranExamAbsenceReason | null | undefined) ?? null,
        comment: args.comment ?? null,
      }),
  }),
);

builder.mutationField("publishQuranExam", (t) =>
  t.field({
    type: OverviewRef,
    authScopes: { hasPermission: "quran_exam:publish" },
    args: { examId: t.arg.string({ required: true }), publish: t.arg.boolean({ required: true }) },
    resolve: (_r, args, ctx) => publishQuranExam(ctx, args.examId, args.publish),
  }),
);

builder.mutationField("lockQuranExamMarks", (t) =>
  t.field({
    type: OverviewRef,
    authScopes: { hasPermission: "quran_exam:lock" },
    args: { examId: t.arg.string({ required: true }), lock: t.arg.boolean({ required: true }) },
    resolve: (_r, args, ctx) => lockQuranExamMarks(ctx, args.examId, args.lock),
  }),
);

builder.mutationField("acknowledgeQuranExamNotice", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "guardian:read_child" },
    args: {
      examId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      version: t.arg.int({ required: true }),
    },
    resolve: (_r, args, ctx) => acknowledgeQuranExamNotice(ctx.auth!.userId, args.examId, args.studentId, args.version),
  }),
);
