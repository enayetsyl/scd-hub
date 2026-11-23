/**
 * Mastery tracker — the weekly tailored assignment (M-4, docs/prd-mastery.md §5.4 / §6.1).
 *
 *   masteryAssignment              — mastery:view; the week's assignment (or none) + the starting layout
 *   masteryAssignmentSheet         — mastery:view; one student's Part B with outcome choices
 *   masteryAssignmentTrackerItems  — mastery:create; the tracker's items to link (read-only)
 *   buildMasteryAssignment         — mastery:create; create / rebuild the DRAFT from the layout
 *   editMasteryAssignmentSheet     — mastery:create; swap / remove / add own / approve
 *   approveMasteryAssignmentSheets — mastery:create; approve every clean sheet
 *   sendMasteryAssignment          — mastery:create; one AS work sheet with each student's items
 *   deleteMasteryAssignment        — mastery:create; a DRAFT only
 *
 * The ROW rule (routine holder, or `mastery:edit_all`) and the add-on switch are in the service.
 */
import { builder } from "../../../schema";
import type { MasterySubject } from "@scd/shared";
import {
  approveAllSheets,
  assignmentFor,
  buildAssignment,
  deleteAssignment,
  editPartA,
  editSheet,
  sendAssignment,
  sheetDetail,
  trackerOptions,
  addCandidates,
  type AddCandidate,
  type AssignmentView,
  type LayoutInput,
  type QuestionView,
  type SheetDetail,
  type SheetOp,
  type SheetSummary,
  type SuggestionView,
  type TrackerOption,
  type PartAEdit,
} from "../services/MasteryAssignmentService";
import {
  acceptAssignmentSwap,
  assignmentLoad,
  assignmentSuggestionWeek,
  suggestAssignment,
  type AssignmentLoadView,
  type ChildLoadRow,
  type SuggestResult,
  type SuggestResultItem,
  type SuggestionSubjectView,
  type SuggestionWeekView,
} from "../services/AssignmentSuggestionService";
import type { Auth } from "../services/MasteryWorkService";
import {
  addAssignmentComment,
  assignmentComments,
  assignmentForReview,
  assignmentOfficeWeeksPage,
  type AssignmentCommentView,
  type OfficeWeekRow,
} from "../services/AssignmentCommentService";
import { pageRef } from "../../../pageRef";

function authOf(ctx: { auth: Auth | null }): Auth {
  if (!ctx.auth) throw new Error("লগইন প্রয়োজন।");
  return ctx.auth;
}

const LayoutRef = builder.objectRef<LayoutInput>("MasteryAssignmentLayout");
LayoutRef.implement({
  fields: (t) => ({
    totalMarks: t.exposeFloat("totalMarks"),
    minutes: t.exposeInt("minutes"),
    partAOn: t.exposeBoolean("partAOn"),
    partAMarks: t.exposeFloat("partAMarks"),
    partALoCodes: t.exposeStringList("partALoCodes"),
    partBMarks: t.exposeFloat("partBMarks"),
    mixWeak: t.exposeInt("mixWeak"),
    mixImproving: t.exposeInt("mixImproving"),
    mixRevision: t.exposeInt("mixRevision"),
    questionTypeCodes: t.exposeStringList("questionTypeCodes"),
  }),
});

const QuestionRef = builder.objectRef<QuestionView>("MasteryAssignmentQuestion");
QuestionRef.implement({
  fields: (t) => ({
    origin: t.exposeString("origin"),
    artifactId: t.string({ nullable: true, resolve: (q) => q.artifactId }),
    qid: t.string({ nullable: true, resolve: (q) => q.qid }),
    textBn: t.string({ nullable: true, resolve: (q) => q.textBn }),
    loCode: t.exposeString("loCode"),
    labelBn: t.exposeString("labelBn"),
    chapterNumber: t.int({ nullable: true, resolve: (q) => q.chapterNumber }),
    questionTypeCode: t.exposeString("questionTypeCode"),
    marks: t.exposeFloat("marks"),
    band: t.exposeString("band"),
    reasonBn: t.string({ nullable: true, description: "AL-7: why the engine picked it (\"দুর্বল: …\", \"ক্লাস মিস: …\").", resolve: (q) => q.reasonBn }),
    repeat: t.boolean({ description: "AL-7: a question the শাখা had before, outside the window — shown \"আবার\".", resolve: (q) => q.repeat }),
  }),
});

const WarningRef = builder.objectRef<SheetSummary["warnings"][number]>("MasteryAssignmentWarning");
WarningRef.implement({
  fields: (t) => ({
    code: t.exposeString("code"),
    loCode: t.string({ nullable: true, resolve: (w) => w.loCode }),
    labelBn: t.string({ nullable: true, resolve: (w) => w.labelBn }),
  }),
});

const SheetItemRef = builder.objectRef<SheetSummary["items"][number]>("MasteryAssignmentSheetItem");
SheetItemRef.implement({
  fields: (t) => ({ loCode: t.exposeString("loCode"), labelBn: t.exposeString("labelBn"), band: t.exposeString("band") }),
});

const SheetSummaryRef = builder.objectRef<SheetSummary>("MasteryAssignmentSheetSummary");
SheetSummaryRef.implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    rollNumber: t.string({ nullable: true, resolve: (s) => s.rollNumber }),
    status: t.exposeString("status"),
    marks: t.exposeFloat("marks"),
    items: t.field({ type: [SheetItemRef], resolve: (s) => s.items }),
    warnings: t.field({ type: [WarningRef], resolve: (s) => s.warnings }),
  }),
});

const SuggestionRef = builder.objectRef<SuggestionView>("MasteryAssignmentSuggestion");
SuggestionRef.implement({
  description: "AL-7: the engine's audit of a draft — who built it and from what.",
  fields: (t) => ({
    builtBy: t.exposeString("builtBy"),
    at: t.exposeString("at"),
    noLessonMarks: t.exposeBoolean("noLessonMarks"),
    chapters: t.exposeIntList("chapters"),
    excludedHw: t.exposeInt("excludedHw"),
    excludedWindow: t.exposeInt("excludedWindow"),
    excludedSeen: t.exposeInt("excludedSeen"),
    edited: t.exposeBoolean("edited"),
    needsReviewCount: t.exposeInt("needsReviewCount"),
  }),
});

const AssignmentRef = builder.objectRef<AssignmentView>("MasteryAssignment");
AssignmentRef.implement({
  description: "A section × subject's weekly tailored assignment (D-#809). Part A for all, Part B per student.",
  fields: (t) => ({
    id: t.exposeString("id"),
    sectionId: t.exposeString("sectionId"),
    subject: t.exposeString("subject"),
    classToken: t.exposeString("classToken"),
    dueDate: t.exposeString("dueDate"),
    week: t.exposeString("week"),
    layout: t.field({ type: LayoutRef, resolve: (a) => a.layout }),
    rememberLayout: t.exposeBoolean("rememberLayout"),
    status: t.exposeString("status"),
    paperId: t.string({ nullable: true, resolve: (a) => a.paperId }),
    asItemId: t.string({ nullable: true, resolve: (a) => a.asItemId }),
    countedMinutes: t.int({ nullable: true, description: "AL-6b: counted minutes at finalise (release switch on).", resolve: (a) => (a.countedMinutes === null ? null : Math.round(a.countedMinutes)) }),
    dayLabel: t.string({ nullable: true, description: "AL-6b: the Bangla day label — শুক্রবার / শনিবার / split by question numbers + the own part.", resolve: (a) => a.dayLabel }),
    dayLabelEn: t.string({ nullable: true, description: "AL-6b: the same label in English.", resolve: (a) => a.dayLabelEn }),
    suggestion: t.field({ type: SuggestionRef, nullable: true, description: "AL-7: set on a draft the suggestion engine built.", resolve: (a) => a.suggestion }),
    partA: t.field({ type: [QuestionRef], resolve: (a) => a.partA }),
    sheets: t.field({ type: [SheetSummaryRef], resolve: (a) => a.sheets }),
    mayEdit: t.boolean({ nullable: true, description: "AL-8: set by assignmentForReview — the caller may change this draft (the mutations' own rule).", resolve: (a) => a.mayEdit ?? null }),
    mayFinalise: t.boolean({ nullable: true, description: "AL-8: set by assignmentForReview — the caller may finalise this draft (incl. the Office on a teacher's Wed/Thu leave).", resolve: (a) => a.mayFinalise ?? null }),
  }),
});

const AssignmentForRef = builder.objectRef<{ week: string; assignment: AssignmentView | null; startingLayout: LayoutInput }>("MasteryAssignmentWeek");
AssignmentForRef.implement({
  fields: (t) => ({
    week: t.exposeString("week"),
    assignment: t.field({ type: AssignmentRef, nullable: true, resolve: (x) => x.assignment }),
    startingLayout: t.field({ type: LayoutRef, resolve: (x) => x.startingLayout }),
  }),
});

const OutcomeChoiceRef = builder.objectRef<SheetDetail["outcomeChoices"][number]>("MasteryAssignmentOutcomeChoice");
OutcomeChoiceRef.implement({
  fields: (t) => ({ loCode: t.exposeString("loCode"), labelBn: t.exposeString("labelBn"), questionTypeCodes: t.exposeStringList("questionTypeCodes") }),
});

const TypeChoiceRef = builder.objectRef<SheetDetail["typeChoices"][number]>("MasteryAssignmentTypeChoice");
TypeChoiceRef.implement({
  fields: (t) => ({ code: t.exposeString("code"), labelBn: t.exposeString("labelBn"), marks: t.exposeFloat("marks") }),
});

const SheetDetailRef = builder.objectRef<SheetDetail>("MasteryAssignmentSheet");
SheetDetailRef.implement({
  fields: (t) => ({
    assignmentId: t.exposeString("assignmentId"),
    assignmentStatus: t.exposeString("assignmentStatus"),
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    rollNumber: t.string({ nullable: true, resolve: (s) => s.rollNumber }),
    status: t.exposeString("status"),
    marks: t.exposeFloat("marks"),
    targetMarks: t.exposeFloat("targetMarks"),
    items: t.field({ type: [QuestionRef], resolve: (s) => s.items }),
    warnings: t.field({ type: [WarningRef], resolve: (s) => s.warnings }),
    outcomeChoices: t.field({ type: [OutcomeChoiceRef], resolve: (s) => s.outcomeChoices }),
    typeChoices: t.field({ type: [TypeChoiceRef], resolve: (s) => s.typeChoices }),
    mayEdit: t.boolean({ nullable: true, description: "AL-8: false = a read-only reader of the week.", resolve: (s) => s.mayEdit ?? null }),
  }),
});

const TrackerOptionRef = builder.objectRef<TrackerOption>("MasteryAssignmentTrackerItem");
TrackerOptionRef.implement({
  fields: (t) => ({
    asItemId: t.exposeString("asItemId"),
    asId: t.exposeString("asId"),
    dueDate: t.exposeString("dueDate"),
    description: t.string({ nullable: true, resolve: (o) => o.description }),
  }),
});

const LayoutInputType = builder.inputType("MasteryAssignmentLayoutInput", {
  fields: (t) => ({
    totalMarks: t.float({ required: true }),
    minutes: t.int({ required: true }),
    partAOn: t.boolean({ required: true }),
    partAMarks: t.float({ required: true }),
    partALoCodes: t.stringList({ required: false }),
    partBMarks: t.float({ required: true }),
    mixWeak: t.int({ required: true }),
    mixImproving: t.int({ required: true }),
    mixRevision: t.int({ required: true }),
    questionTypeCodes: t.stringList({ required: false }),
  }),
});

const ChapterChoiceRef = builder.objectRef<SuggestionSubjectView["chapterChoices"][number]>("AssignmentChapterChoice");
ChapterChoiceRef.implement({ fields: (t) => ({ chapterNumber: t.exposeInt("chapterNumber"), objectives: t.exposeInt("objectives") }) });

const SuggestionSubjectRef = builder.objectRef<SuggestionSubjectView>("AssignmentSuggestionSubject");
SuggestionSubjectRef.implement({
  description: "AL-7: one subject of the শাখা's week — its draft state (NONE | DRAFT | SENT | MANUAL = নিজে তৈরি করুন | NIL | DELIVERED).",
  fields: (t) => ({
    subject: t.exposeString("subject"),
    subjectBn: t.exposeString("subjectBn"),
    teacherId: t.string({ nullable: true, resolve: (s) => s.teacherId }),
    teacherName: t.string({ nullable: true, resolve: (s) => s.teacherName }),
    state: t.exposeString("state"),
    assignmentId: t.string({ nullable: true, resolve: (s) => s.assignmentId }),
    builtBy: t.string({ nullable: true, resolve: (s) => s.builtBy }),
    edited: t.exposeBoolean("edited"),
    needsReviewCount: t.exposeInt("needsReviewCount"),
    minutes: t.int({ nullable: true, resolve: (s) => s.minutes }),
    doOnDay: t.string({ nullable: true, resolve: (s) => s.doOnDay }),
    noLessonMarks: t.exposeBoolean("noLessonMarks"),
    chapterChoices: t.field({ type: [ChapterChoiceRef], resolve: (s) => s.chapterChoices }),
    inRotation: t.exposeBoolean("inRotation"),
  }),
});

type SwapCardShape = NonNullable<SuggestionWeekView["swapCard"]>;
const SwapCardRef = builder.objectRef<SwapCardShape>("AssignmentSwapCard");
SwapCardRef.implement({
  description: "AL-7 (§4.5): \"এই সপ্তাহে X-এর বদলে Y?\" — accepted by the class teacher or the Office; expires at delivery.",
  fields: (t) => ({
    dropSubject: t.exposeString("dropSubject"),
    dropSubjectBn: t.exposeString("dropSubjectBn"),
    addSubject: t.exposeString("addSubject"),
    addSubjectBn: t.exposeString("addSubjectBn"),
    addWeakPct: t.exposeInt("addWeakPct"),
    addWeakRows: t.exposeInt("addWeakRows"),
    dropWeakRows: t.exposeInt("dropWeakRows"),
  }),
});

const DayPlanRef = builder.objectRef<SuggestionWeekView["dayPlan"]>("AssignmentDayPlan");
DayPlanRef.implement({ fields: (t) => ({ FRI: t.exposeInt("FRI"), SAT: t.exposeInt("SAT"), overBy: t.exposeInt("overBy"), dayCap: t.exposeInt("dayCap") }) });

const SuggestionWeekRef = builder.objectRef<SuggestionWeekView>("AssignmentSuggestionWeek");
SuggestionWeekRef.implement({
  description: "AL-7: a শাখা's week — rotation subjects, each draft's state, the swap card, the planned Friday / Saturday minutes.",
  fields: (t) => ({
    week: t.exposeString("week"),
    dueDate: t.exposeString("dueDate"),
    deliveryDate: t.string({ nullable: true, resolve: (w) => w.deliveryDate }),
    weekNumber: t.int({ nullable: true, resolve: (w) => w.weekNumber }),
    hasWeek: t.exposeBoolean("hasWeek"),
    suspended: t.exposeBoolean("suspended"),
    subjects: t.field({ type: [SuggestionSubjectRef], resolve: (w) => w.subjects }),
    swapCard: t.field({ type: SwapCardRef, nullable: true, resolve: (w) => w.swapCard }),
    canAcceptSwap: t.exposeBoolean("canAcceptSwap"),
    dayPlan: t.field({ type: DayPlanRef, resolve: (w) => w.dayPlan }),
  }),
});

const SuggestItemRef = builder.objectRef<SuggestResultItem>("AssignmentSuggestionItem");
SuggestItemRef.implement({
  fields: (t) => ({
    subject: t.exposeString("subject"),
    state: t.exposeString("state"),
    assignment: t.field({ type: AssignmentRef, nullable: true, resolve: (i) => i.assignment }),
    noLessonMarks: t.exposeBoolean("noLessonMarks"),
    needsReviewCount: t.exposeInt("needsReviewCount"),
  }),
});

const SuggestResultRef = builder.objectRef<SuggestResult>("AssignmentSuggestionResult");
SuggestResultRef.implement({
  fields: (t) => ({
    items: t.field({ type: [SuggestItemRef], resolve: (r) => r.items }),
    manualSubjects: t.exposeStringList("manualSubjects"),
  }),
});

const ChildLoadSubjectRef = builder.objectRef<ChildLoadRow["subjects"][number]>("AssignmentChildLoadSubject");
ChildLoadSubjectRef.implement({ fields: (t) => ({ subject: t.exposeString("subject"), fri: t.exposeInt("fri"), sat: t.exposeInt("sat") }) });

const ChildLoadRef = builder.objectRef<ChildLoadRow>("AssignmentChildLoad");
ChildLoadRef.implement({
  description: "AL-7 (AC-C10): one child's minutes on Friday and Saturday across the week's subjects plus weekend extra homework.",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    schoolId: t.string({ nullable: true, resolve: (c) => c.schoolId }),
    fri: t.int({ resolve: (c) => c.FRI }),
    sat: t.int({ resolve: (c) => c.SAT }),
    extraFri: t.int({ resolve: (c) => Math.round(c.extra.FRI) }),
    extraSat: t.int({ resolve: (c) => Math.round(c.extra.SAT) }),
    overFri: t.boolean({ resolve: (c) => c.over.FRI }),
    overSat: t.boolean({ resolve: (c) => c.over.SAT }),
    warn: t.exposeBoolean("warn"),
    subjects: t.field({ type: [ChildLoadSubjectRef], resolve: (c) => c.subjects }),
  }),
});

const ThursdayRef = builder.objectRef<AssignmentLoadView["thursdayHomework"][number]>("AssignmentThursdayHomework");
ThursdayRef.implement({ fields: (t) => ({ subject: t.exposeString("subject"), minutes: t.exposeInt("minutes"), description: t.string({ nullable: true, resolve: (h) => h.description }) }) });

const LoadRef = builder.objectRef<AssignmentLoadView>("AssignmentLoad");
LoadRef.implement({
  description: "AL-7 (AC-C10): the per-child weekly load. The Thursday class homework is LISTED but not counted (R27).",
  fields: (t) => ({
    week: t.exposeString("week"),
    dayCap: t.exposeInt("dayCap"),
    children: t.field({ type: [ChildLoadRef], resolve: (l) => l.children }),
    thursdayHomework: t.field({ type: [ThursdayRef], resolve: (l) => l.thursdayHomework }),
  }),
});

builder.queryFields((t) => ({
  assignmentSuggestionWeek: t.field({
    type: SuggestionWeekRef,
    description: "AL-7: a শাখা's weekly-assignment week — rotation subjects, drafts, swap card, day plan. Every subject teacher of the week, the class teacher and the Office read it.",
    authScopes: { hasPermission: "assignment:suggest" },
    args: { sectionId: t.arg.string({ required: true }), dueDate: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => assignmentSuggestionWeek(args.sectionId, args.dueDate, authOf(ctx)),
  }),

  assignmentLoad: t.field({
    type: LoadRef,
    description: "AL-7 (AC-C10): each child's Friday / Saturday minutes across the week's subjects plus weekend extra homework; > perDayHours is a warning.",
    authScopes: { hasPermission: "assignment:suggest" },
    args: { sectionId: t.arg.string({ required: true }), dueDate: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => assignmentLoad(args.sectionId, args.dueDate, authOf(ctx)),
  }),

  masteryAssignment: t.field({
    type: AssignmentForRef,
    description: "The section × subject's weekly assignment for the due date's ISO week (or none) and the layout a new one starts from.",
    authScopes: { hasPermission: "mastery:view" },
    args: {
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      dueDate: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) => assignmentFor(args.sectionId, args.subject as MasterySubject, args.dueDate, authOf(ctx)),
  }),

  masteryAssignmentSheet: t.field({
    type: SheetDetailRef,
    description: "One student's Part B: the builder's pick with its band, warnings, and the outcomes a teacher question can target.",
    authScopes: { hasPermission: "mastery:view" },
    args: { assignmentId: t.arg.string({ required: true }), studentId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => sheetDetail(args.assignmentId, args.studentId, authOf(ctx)),
  }),

  masteryAssignmentTrackerItems: t.field({
    type: [TrackerOptionRef],
    description: "The section × subject's assignment-tracker items due within four weeks either side — to link for absent / not-submitted defaults.",
    authScopes: { hasPermission: "mastery:create" },
    args: { sectionId: t.arg.string({ required: true }), subject: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => trackerOptions(args.sectionId, args.subject as MasterySubject, authOf(ctx)),
  }),
}));

builder.mutationFields((t) => ({
  buildMasteryAssignment: t.field({
    type: AssignmentRef,
    description: "Create or rebuild the week's DRAFT from the teacher's layout. Sheets the teacher edited are kept.",
    authScopes: { hasPermission: "mastery:create" },
    args: {
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      dueDate: t.arg.string({ required: true }),
      layout: t.arg({ type: LayoutInputType, required: true }),
      rememberLayout: t.arg.boolean({ required: true }),
      asItemId: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) =>
      buildAssignment(
        {
          sectionId: args.sectionId,
          subject: args.subject as MasterySubject,
          dueDate: args.dueDate,
          layout: {
            ...args.layout,
            partALoCodes: args.layout.partALoCodes ?? [],
            questionTypeCodes: args.layout.questionTypeCodes ?? [],
          },
          rememberLayout: args.rememberLayout,
          asItemId: args.asItemId,
        },
        authOf(ctx),
      ),
  }),

  suggestAssignment: t.field({
    type: SuggestResultRef,
    description:
      "AL-7 (§4.1): \"প্রস্তাব দিন\" — build the week's DRAFT from the engine for one subject (or every rotation subject the caller may work). " +
      "An existing DRAFT is kept unless rebuild = true (after the confirm dialog); a finalised assignment is never touched.",
    authScopes: { hasPermission: "assignment:suggest" },
    args: {
      sectionId: t.arg.string({ required: true }),
      dueDate: t.arg.string({ required: true }),
      subject: t.arg.string({ required: false }),
      rebuild: t.arg.boolean({ required: false }),
    },
    resolve: async (_r, args, ctx) => suggestAssignment({ sectionId: args.sectionId, dueYmd: args.dueDate, subject: args.subject, rebuild: Boolean(args.rebuild) }, authOf(ctx)),
  }),

  acceptAssignmentSwap: t.field({
    type: SuggestItemRef,
    description:
      "AL-7 (R29): accept the swap card — the dropped subject's DRAFT is deleted (confirmEdited when its teacher already edited it), the new subject's " +
      "draft is built, both teachers are told. The শাখা's class teacher or the Office; a finalised subject cannot be swapped.",
    authScopes: { hasPermission: "assignment:accept_swap" },
    args: {
      sectionId: t.arg.string({ required: true }),
      dueDate: t.arg.string({ required: true }),
      dropSubject: t.arg.string({ required: true }),
      addSubject: t.arg.string({ required: true }),
      confirmEdited: t.arg.boolean({ required: false }),
    },
    resolve: async (_r, args, ctx) =>
      acceptAssignmentSwap({ sectionId: args.sectionId, dueYmd: args.dueDate, dropSubject: args.dropSubject, addSubject: args.addSubject, confirmEdited: Boolean(args.confirmEdited) }, authOf(ctx)),
  }),

  editMasteryAssignmentPartA: t.field({
    type: AssignmentRef,
    description: "AL-7 (§4.6): the common part of an engine draft — SWAP (another unseen question, same objective), REMOVE, ADD_BANK (re-checked against §4.3: a homework question or an in-window repeat is refused).",
    authScopes: { hasAnyPermission: ["assignment:suggest", "mastery:create"] },
    args: {
      assignmentId: t.arg.string({ required: true }),
      op: t.arg.string({ required: true }),
      index: t.arg.int({ required: false }),
      qid: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) => editPartA(args.assignmentId, { op: args.op as PartAEdit["op"], index: args.index, qid: args.qid }, authOf(ctx)),
  }),

  editMasteryAssignmentSheet: t.field({
    type: SheetDetailRef,
    description: "One student's Part B: SWAP (next unseen gold question, same outcome), REMOVE, ADD_OWN (outcome + type + text), ADD_BANK (a bank question by qid, AL-7), APPROVE.",
    authScopes: { hasAnyPermission: ["mastery:create", "assignment:finalise_on_leave"] },
    args: {
      assignmentId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      op: t.arg.string({ required: true }),
      index: t.arg.int({ required: false }),
      loCode: t.arg.string({ required: false }),
      questionTypeCode: t.arg.string({ required: false }),
      textBn: t.arg.string({ required: false }),
      qid: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) =>
      editSheet(
        args.assignmentId,
        args.studentId,
        { op: args.op as SheetOp, index: args.index, loCode: args.loCode, questionTypeCode: args.questionTypeCode, textBn: args.textBn, qid: args.qid },
        authOf(ctx),
      ),
  }),

  approveMasteryAssignmentSheets: t.field({
    type: AssignmentRef,
    description: "Approve every sheet the builder filled without a gap (NEEDS_REVIEW sheets stay for the teacher).",
    authScopes: { hasAnyPermission: ["mastery:create", "assignment:finalise_on_leave"] },
    args: { assignmentId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => approveAllSheets(args.assignmentId, authOf(ctx)),
  }),

  sendMasteryAssignment: t.field({
    type: AssignmentRef,
    description:
      "Send: writes one AS work sheet (Part A + every Part B) with each student's own item list. Every sheet must be approved. " +
      "AL-7 (R28): with the switch on, the Office (assignment:finalise_on_leave) may finalise while the subject teacher is on approved leave that Wednesday / Thursday.",
    authScopes: { hasAnyPermission: ["mastery:create", "assignment:finalise_on_leave"] },
    args: { assignmentId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => sendAssignment(args.assignmentId, authOf(ctx)),
  }),

  deleteMasteryAssignment: t.field({
    type: "Boolean",
    description: "Delete a DRAFT assignment and its sheets.",
    authScopes: { hasPermission: "mastery:create" },
    args: { assignmentId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => deleteAssignment(args.assignmentId, authOf(ctx)),
  }),
}));

// ---------------------------------------------------------------------------
// AL-8: Office / Principal view of every শাখা's weekly assignments + comments (journey C6)
// ---------------------------------------------------------------------------

const OfficeWeekRowRef = builder.objectRef<OfficeWeekRow>("AssignmentOfficeWeekRow");
OfficeWeekRowRef.implement({
  description: "AL-8 (C6): one শাখা × subject's draft or finalised weekly assignment, for the Office / Principal.",
  fields: (t) => ({
    assignmentId: t.exposeString("assignmentId"),
    sectionId: t.exposeString("sectionId"),
    sectionLabelBn: t.exposeString("sectionLabelBn"),
    subject: t.exposeString("subject"),
    subjectBn: t.exposeString("subjectBn"),
    status: t.exposeString("status"),
    builtBy: t.string({ nullable: true, resolve: (r) => r.builtBy }),
    edited: t.exposeBoolean("edited"),
    needsReviewCount: t.exposeInt("needsReviewCount"),
    minutes: t.int({ nullable: true, resolve: (r) => r.minutes }),
    commentCount: t.exposeInt("commentCount"),
    dueDate: t.exposeString("dueDate"),
  }),
});
const AddCandidateRef = builder.objectRef<AddCandidate>("AssignmentAddCandidate");
AddCandidateRef.implement({
  fields: (t) => ({
    qid: t.exposeString("qid"),
    textBn: t.string({ nullable: true, resolve: (c) => c.textBn }),
    loCode: t.exposeString("loCode"),
    labelBn: t.exposeString("labelBn"),
    questionTypeCode: t.exposeString("questionTypeCode"),
    marks: t.exposeFloat("marks"),
    repeat: t.exposeBoolean("repeat"),
  }),
});

const OfficeWeekPageRef = pageRef("AssignmentOfficeWeekPage", OfficeWeekRowRef);

const AssignmentCommentRef = builder.objectRef<AssignmentCommentView>("AssignmentComment");
AssignmentCommentRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    authorName: t.exposeString("authorName"),
    textBn: t.exposeString("textBn"),
    createdAt: t.exposeString("createdAt"),
  }),
});

builder.queryFields((t) => ({
  assignmentOfficeWeeksPage: t.field({
    type: OfficeWeekPageRef,
    description: "AL-8 (C6): every শাখা's drafts and finalised weeks for the due date's ISO week, paged. Office / Principal.",
    authScopes: { hasPermission: "assignment:view_all" },
    args: { dueDate: t.arg.string({ required: true }), page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: async (_r, args) => assignmentOfficeWeeksPage(args.dueDate, { page: args.page, pageSize: args.pageSize }),
  }),

  assignmentForReview: t.field({
    type: AssignmentRef,
    description: "AL-8: one weekly assignment by id for the review screen — the Office / Principal (any শাখা) or the subject teacher / today's substitute it is about.",
    authScopes: { hasAnyPermission: ["assignment:comment", "assignment:view_all", "assignment:suggest", "mastery:view"] },
    args: { assignmentId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => assignmentForReview(args.assignmentId, authOf(ctx)),
  }),

  assignmentAddCandidates: t.field({
    type: [AddCandidateRef],
    description: "AL-8 (§4.3 / §4.6): the bank questions the caller may add to the draft's common part (no studentId) or one child's Part B — the exclusions applied, repeats last.",
    authScopes: { hasAnyPermission: ["assignment:suggest", "mastery:create", "assignment:finalise_on_leave"] },
    args: { assignmentId: t.arg.string({ required: true }), studentId: t.arg.string({ required: false }), filter: t.arg.string({ required: false }) },
    resolve: async (_r, args, ctx) => addCandidates(args.assignmentId, args.studentId ?? null, args.filter, authOf(ctx)),
  }),

  assignmentComments: t.field({
    type: [AssignmentCommentRef],
    description: "AL-8: the Office / Principal comments on one assignment — read by them and by the subject teacher it is about.",
    authScopes: { hasAnyPermission: ["assignment:comment", "assignment:view_all", "assignment:suggest"] },
    args: { assignmentId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => assignmentComments(args.assignmentId, authOf(ctx)),
  }),
}));

builder.mutationFields((t) => ({
  addAssignmentComment: t.field({
    type: AssignmentCommentRef,
    description: "AL-8 (§4.6): an Office / Principal comment on a draft or finalised week; notifies the subject teacher.",
    authScopes: { hasPermission: "assignment:comment" },
    args: { assignmentId: t.arg.string({ required: true }), text: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => addAssignmentComment(args.assignmentId, args.text, authOf(ctx)),
  }),
}));
