/**
 * Exam paper bank resolvers (D-#1030–#1034, docs/prd-exam-paper-bank.md).
 *
 * Reference papers (another branch's past papers). The upload is a REST route
 * (POST /files/reference-paper, multipart PDF + optional original):
 *   referencePapers / referencePaperPage — exam_papers:view_reference | manage_reference
 *   updateReferencePaper / deleteReferencePaper — exam_papers:manage_reference
 *
 * Draft papers reviewed item by item:
 *   examPaperDrafts / examPaperDraft — view/manage see every paper; a reviewer
 *     (exam_papers:review, SELF) sees only the papers given to them (service-checked).
 *   importExamPaperDraft / assignExamPaperReviewer / resolveExamPaperSuggestion /
 *     finalizeExamPaper / examPaperReviewerOptions — exam_papers:manage
 *   setExamItemSyllabusMatch / confirmExamSectionSyllabus / suggestExamPaperChange /
 *     withdrawExamPaperSuggestion / submitExamPaperReview — the paper's reviewer (or a manager)
 */
import { builder } from "../../../schema";
import {
  deleteReferencePaper,
  referencePaperByHash,
  referencePaperPage,
  referencePapers,
  updateReferencePaper,
  type ReferencePaperPageShape,
  type ReferencePaperShape,
} from "../services/ReferencePaperService";
import {
  assignExamPaperReviewer,
  confirmExamSectionSyllabus,
  examPaperDraft,
  examPaperDrafts,
  examPaperReviewerOptions,
  finalizeExamPaper,
  importExamPaperDraft,
  resolveExamPaperSuggestion,
  setExamItemSyllabusMatch,
  submitExamPaperReview,
  suggestExamPaperChange,
  withdrawExamPaperSuggestion,
  type ExamPaperDetailShape,
  type ExamPaperItemShape,
  type ExamPaperSectionShape,
  type ExamPaperSuggestionShape,
  type ExamPaperSummaryShape,
  type ReviewerOption,
} from "../services/ExamPaperDraftService";

const REF_READ = ["exam_papers:view_reference", "exam_papers:manage_reference"] as const;
const DRAFT_READ = ["exam_papers:view", "exam_papers:manage", "exam_papers:review"] as const;
const DRAFT_REVIEW = ["exam_papers:review", "exam_papers:manage"] as const;

// ---------------------------------------------------------------------------
// Reference papers
// ---------------------------------------------------------------------------

const ReferencePaperRef = builder.objectRef<ReferencePaperShape>("ReferencePaper");
ReferencePaperRef.implement({
  description: "Another branch's past exam paper, kept for reading (D-#1030).",
  fields: (t) => ({
    id: t.exposeString("id"),
    branch: t.exposeString("branch"),
    // HALF_YEARLY | ANNUAL
    term: t.exposeString("term"),
    year: t.exposeInt("year"),
    classLevel: t.int({ nullable: true, resolve: (r) => r.classLevel }),
    classLabelBn: t.string({ nullable: true, resolve: (r) => r.classLabelBn }),
    subject: t.exposeString("subject"),
    title: t.exposeString("title"),
    // PROCESSING | READY | FAILED
    status: t.exposeString("status"),
    error: t.string({ nullable: true, resolve: (r) => r.error }),
    pageCount: t.exposeInt("pageCount"),
    pageAspect: t.exposeFloat("pageAspect"),
    sourceFileId: t.string({ nullable: true, resolve: (r) => r.sourceFileId }),
    sourceName: t.exposeString("sourceName"),
    createdAt: t.exposeString("createdAt"),
  }),
});

const ReferencePaperPageRef = builder.objectRef<ReferencePaperPageShape>("ReferencePaperPage");
ReferencePaperPageRef.implement({
  fields: (t) => ({
    paperId: t.exposeString("paperId"),
    page: t.exposeInt("page"),
    pageCount: t.exposeInt("pageCount"),
    dataUri: t.exposeString("dataUri"),
  }),
});

builder.queryField("referencePapers", (t) =>
  t.field({
    type: [ReferencePaperRef],
    authScopes: { hasAnyPermission: [...REF_READ] },
    args: {
      year: t.arg.int({ required: false }),
      term: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
    },
    resolve: (_r, args) => referencePapers({ year: args.year, term: args.term, classLevel: args.classLevel }),
  }),
);

builder.queryField("referencePaperByHash", (t) =>
  t.field({
    type: ReferencePaperRef,
    nullable: true,
    description: "The import script's skip check: a paper whose original has this sha1.",
    authScopes: { hasPermission: "exam_papers:manage_reference" },
    args: { hash: t.arg.string({ required: true }) },
    resolve: (_r, args) => referencePaperByHash(args.hash),
  }),
);

builder.queryField("referencePaperPage", (t) =>
  t.field({
    type: ReferencePaperPageRef,
    authScopes: { hasAnyPermission: [...REF_READ] },
    args: { paperId: t.arg.string({ required: true }), page: t.arg.int({ required: true }) },
    resolve: (_r, args, ctx) => referencePaperPage(ctx, args.paperId, args.page),
  }),
);

builder.mutationField("updateReferencePaper", (t) =>
  t.field({
    type: ReferencePaperRef,
    authScopes: { hasPermission: "exam_papers:manage_reference" },
    args: {
      id: t.arg.string({ required: true }),
      term: t.arg.string({ required: false }),
      year: t.arg.int({ required: false }),
      classLevel: t.arg.int({ required: false }),
      clearClass: t.arg.boolean({ required: false }),
      subject: t.arg.string({ required: false }),
      title: t.arg.string({ required: false }),
    },
    resolve: (_r, args, ctx) =>
      updateReferencePaper(ctx.auth!.userId, args.id, {
        term: args.term,
        year: args.year,
        classLevel: args.classLevel,
        clearClass: args.clearClass,
        subject: args.subject,
        title: args.title,
      }),
  }),
);

builder.mutationField("deleteReferencePaper", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "exam_papers:manage_reference" },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => deleteReferencePaper(ctx.auth!.userId, args.id),
  }),
);

// ---------------------------------------------------------------------------
// Draft papers
// ---------------------------------------------------------------------------

const progressFields = (t: any) => ({
  itemCount: t.exposeInt("itemCount"),
  confirmedCount: t.exposeInt("confirmedCount"),
  openSuggestions: t.exposeInt("openSuggestions"),
  acceptedSuggestions: t.exposeInt("acceptedSuggestions"),
  rejectedSuggestions: t.exposeInt("rejectedSuggestions"),
});

const summaryFields = (t: any) => ({
  id: t.exposeString("id"),
  key: t.exposeString("key"),
  term: t.exposeString("term"),
  year: t.exposeInt("year"),
  examNameBn: t.exposeString("examNameBn"),
  classLevel: t.exposeInt("classLevel"),
  classLabelBn: t.exposeString("classLabelBn"),
  subject: t.exposeString("subject"),
  titleBn: t.exposeString("titleBn"),
  fullMarks: t.exposeFloat("fullMarks"),
  // DRAFT | IN_REVIEW | REVIEWED | FINAL
  status: t.exposeString("status"),
  reviewerUserId: t.string({ nullable: true, resolve: (r: ExamPaperSummaryShape) => r.reviewerUserId }),
  reviewerName: t.string({ nullable: true, resolve: (r: ExamPaperSummaryShape) => r.reviewerName }),
  reviewSubmittedAt: t.string({ nullable: true, resolve: (r: ExamPaperSummaryShape) => r.reviewSubmittedAt }),
  updatedAt: t.exposeString("updatedAt"),
  ...progressFields(t),
});

const ExamPaperSummaryRef = builder.objectRef<ExamPaperSummaryShape>("ExamPaperSummary");
ExamPaperSummaryRef.implement({ fields: (t) => summaryFields(t) });

const ExamPaperItemRef = builder.objectRef<ExamPaperItemShape>("ExamPaperItem");
ExamPaperItemRef.implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    text: t.exposeString("text"),
    options: t.exposeStringList("options"),
    answer: t.string({ nullable: true, resolve: (r) => r.answer }),
    marks: t.float({ nullable: true, resolve: (r) => r.marks }),
    // MP2026 | MP2026_ADAPTED | MP_OTHER | MP_OTHER_ADAPTED | NEW | REVIEWER
    source: t.exposeString("source"),
    sourceRef: t.string({ nullable: true, resolve: (r) => r.sourceRef }),
    bookRef: t.string({ nullable: true, resolve: (r) => r.bookRef }),
    needsPicture: t.exposeBoolean("needsPicture"),
    note: t.string({ nullable: true, resolve: (r) => r.note }),
    removed: t.exposeBoolean("removed"),
    syllabusConfirmed: t.exposeBoolean("syllabusConfirmed"),
    syllabusConfirmedByName: t.string({ nullable: true, resolve: (r) => r.syllabusConfirmedByName }),
    syllabusConfirmedAt: t.string({ nullable: true, resolve: (r) => r.syllabusConfirmedAt }),
    editedCount: t.exposeInt("editedCount"),
  }),
});

const ExamPaperSectionRef = builder.objectRef<ExamPaperSectionShape>("ExamPaperSection");
ExamPaperSectionRef.implement({
  fields: (t) => ({
    seq: t.exposeInt("seq"),
    syllabusRowSeq: t.exposeIntList("syllabusRowSeq"),
    syllabusLabel: t.string({ nullable: true, resolve: (r) => r.syllabusLabel }),
    // WRITTEN | ORAL
    kind: t.exposeString("kind"),
    instructionBn: t.exposeString("instructionBn"),
    count: t.int({ nullable: true, resolve: (r) => r.count }),
    marksEach: t.float({ nullable: true, resolve: (r) => r.marksEach }),
    total: t.exposeFloat("total"),
    choiceNoteBn: t.string({ nullable: true, resolve: (r) => r.choiceNoteBn }),
    splitMarks: t.exposeBoolean("splitMarks"),
    stimulusMd: t.string({ nullable: true, resolve: (r) => r.stimulusMd }),
    matchRight: t.exposeStringList("matchRight"),
    activeItemCount: t.exposeInt("activeItemCount"),
    items: t.field({ type: [ExamPaperItemRef], resolve: (r) => r.items }),
  }),
});

const ExamPaperSuggestionRef = builder.objectRef<ExamPaperSuggestionShape>("ExamPaperSuggestion");
ExamPaperSuggestionRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    // EDIT | DELETE | ADD
    kind: t.exposeString("kind"),
    sectionSeq: t.exposeInt("sectionSeq"),
    itemKey: t.string({ nullable: true, resolve: (r) => r.itemKey }),
    proposedText: t.string({ nullable: true, resolve: (r) => r.proposedText }),
    proposedAnswer: t.string({ nullable: true, resolve: (r) => r.proposedAnswer }),
    proposedOptions: t.exposeStringList("proposedOptions"),
    reason: t.string({ nullable: true, resolve: (r) => r.reason }),
    // OPEN | ACCEPTED | REJECTED | WITHDRAWN
    status: t.exposeString("status"),
    createdById: t.exposeString("createdById"),
    createdByName: t.exposeString("createdByName"),
    createdAt: t.exposeString("createdAt"),
    resolvedByName: t.string({ nullable: true, resolve: (r) => r.resolvedByName }),
    resolvedAt: t.string({ nullable: true, resolve: (r) => r.resolvedAt }),
    resolutionNote: t.string({ nullable: true, resolve: (r) => r.resolutionNote }),
    createdItemKey: t.string({ nullable: true, resolve: (r) => r.createdItemKey }),
  }),
});

const ExamPaperDetailRef = builder.objectRef<ExamPaperDetailShape>("ExamPaperDetail");
ExamPaperDetailRef.implement({
  fields: (t) => ({
    ...summaryFields(t),
    durationBn: t.string({ nullable: true, resolve: (r) => r.durationBn }),
    authorNotes: t.string({ nullable: true, resolve: (r) => r.authorNotes }),
    reviewSummary: t.string({ nullable: true, resolve: (r) => r.reviewSummary }),
    viewerIsReviewer: t.exposeBoolean("viewerIsReviewer"),
    viewerCanManage: t.exposeBoolean("viewerCanManage"),
    sections: t.field({ type: [ExamPaperSectionRef], resolve: (r) => r.sections }),
    suggestions: t.field({ type: [ExamPaperSuggestionRef], resolve: (r) => r.suggestions }),
  }),
});

const ReviewerOptionRef = builder.objectRef<ReviewerOption>("ExamPaperReviewerOption");
ReviewerOptionRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    name: t.exposeString("name"),
    role: t.exposeString("role"),
  }),
});

builder.queryField("examPaperDrafts", (t) =>
  t.field({
    type: [ExamPaperSummaryRef],
    authScopes: { hasAnyPermission: [...DRAFT_READ] },
    args: {
      year: t.arg.int({ required: false }),
      term: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
      mine: t.arg.boolean({ required: false }),
    },
    resolve: (_r, args, ctx) =>
      examPaperDrafts(ctx, { year: args.year, term: args.term, classLevel: args.classLevel, mine: args.mine }),
  }),
);

builder.queryField("examPaperDraft", (t) =>
  t.field({
    type: ExamPaperDetailRef,
    authScopes: { hasAnyPermission: [...DRAFT_READ] },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => examPaperDraft(ctx, args.id),
  }),
);

builder.queryField("examPaperReviewerOptions", (t) =>
  t.field({
    type: [ReviewerOptionRef],
    authScopes: { hasPermission: "exam_papers:manage" },
    resolve: () => examPaperReviewerOptions(),
  }),
);

builder.mutationField("importExamPaperDraft", (t) =>
  t.field({
    type: ExamPaperSummaryRef,
    authScopes: { hasPermission: "exam_papers:manage" },
    args: { json: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => {
      let payload: unknown;
      try {
        payload = JSON.parse(args.json);
      } catch {
        throw new Error("প্রশ্নপত্রের ফাইলটি সঠিক JSON নয়");
      }
      return importExamPaperDraft(ctx, payload);
    },
  }),
);

builder.mutationField("assignExamPaperReviewer", (t) =>
  t.field({
    type: [ExamPaperSummaryRef],
    authScopes: { hasPermission: "exam_papers:manage" },
    args: {
      paperIds: t.arg.stringList({ required: true }),
      reviewerUserId: t.arg.string({ required: true }),
    },
    resolve: (_r, args, ctx) => assignExamPaperReviewer(ctx, args.paperIds, args.reviewerUserId),
  }),
);

builder.mutationField("finalizeExamPaper", (t) =>
  t.field({
    type: ExamPaperDetailRef,
    authScopes: { hasPermission: "exam_papers:manage" },
    args: { paperId: t.arg.string({ required: true }), final: t.arg.boolean({ required: true }) },
    resolve: (_r, args, ctx) => finalizeExamPaper(ctx, args.paperId, args.final),
  }),
);

builder.mutationField("resolveExamPaperSuggestion", (t) =>
  t.field({
    type: ExamPaperDetailRef,
    authScopes: { hasPermission: "exam_papers:manage" },
    args: {
      suggestionId: t.arg.string({ required: true }),
      accept: t.arg.boolean({ required: true }),
      note: t.arg.string({ required: false }),
      text: t.arg.string({ required: false }),
      answer: t.arg.string({ required: false }),
      options: t.arg.stringList({ required: false }),
    },
    resolve: (_r, args, ctx) =>
      resolveExamPaperSuggestion(ctx, args.suggestionId, {
        accept: args.accept,
        note: args.note,
        text: args.text,
        answer: args.answer,
        options: args.options ?? null,
      }),
  }),
);

builder.mutationField("setExamItemSyllabusMatch", (t) =>
  t.field({
    type: ExamPaperDetailRef,
    authScopes: { hasAnyPermission: [...DRAFT_REVIEW] },
    args: {
      paperId: t.arg.string({ required: true }),
      itemKey: t.arg.string({ required: true }),
      confirmed: t.arg.boolean({ required: true }),
    },
    resolve: (_r, args, ctx) => setExamItemSyllabusMatch(ctx, args.paperId, args.itemKey, args.confirmed),
  }),
);

builder.mutationField("confirmExamSectionSyllabus", (t) =>
  t.field({
    type: ExamPaperDetailRef,
    authScopes: { hasAnyPermission: [...DRAFT_REVIEW] },
    args: { paperId: t.arg.string({ required: true }), sectionSeq: t.arg.int({ required: true }) },
    resolve: (_r, args, ctx) => confirmExamSectionSyllabus(ctx, args.paperId, args.sectionSeq),
  }),
);

builder.mutationField("suggestExamPaperChange", (t) =>
  t.field({
    type: ExamPaperDetailRef,
    authScopes: { hasAnyPermission: [...DRAFT_REVIEW] },
    args: {
      paperId: t.arg.string({ required: true }),
      // EDIT | DELETE | ADD
      kind: t.arg.string({ required: true }),
      sectionSeq: t.arg.int({ required: true }),
      itemKey: t.arg.string({ required: false }),
      proposedText: t.arg.string({ required: false }),
      proposedAnswer: t.arg.string({ required: false }),
      proposedOptions: t.arg.stringList({ required: false }),
      reason: t.arg.string({ required: false }),
    },
    resolve: (_r, args, ctx) =>
      suggestExamPaperChange(ctx, {
        paperId: args.paperId,
        kind: args.kind,
        sectionSeq: args.sectionSeq,
        itemKey: args.itemKey,
        proposedText: args.proposedText,
        proposedAnswer: args.proposedAnswer,
        proposedOptions: args.proposedOptions ?? null,
        reason: args.reason,
      }),
  }),
);

builder.mutationField("withdrawExamPaperSuggestion", (t) =>
  t.field({
    type: ExamPaperDetailRef,
    authScopes: { hasAnyPermission: [...DRAFT_REVIEW] },
    args: { suggestionId: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => withdrawExamPaperSuggestion(ctx, args.suggestionId),
  }),
);

builder.mutationField("submitExamPaperReview", (t) =>
  t.field({
    type: ExamPaperDetailRef,
    authScopes: { hasPermission: "exam_papers:review" },
    args: { paperId: t.arg.string({ required: true }), summary: t.arg.string({ required: false }) },
    resolve: (_r, args, ctx) => submitExamPaperReview(ctx, args.paperId, args.summary),
  }),
);
