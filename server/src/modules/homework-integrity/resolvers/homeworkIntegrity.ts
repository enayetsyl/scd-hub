/**
 * Homework-honesty flag (GH-3, docs/prd-guardian-help.md section 4, D-#1522; AL-12 extensions, D-#1676).
 *
 *   homeworkIntegrityCases        - homework_integrity:view | :view_all; the queue, filtered. ROW-SCOPED (AC-H3): a
 *                                   teacher sees only the cases that name them (class teacher of the section / the
 *                                   subject teacher there); view_all (Office, Principal) sees every case
 *   homeworkIntegrityCase         - same gate + the same row rule; one case with the items behind each number
 *   recordHomeworkIntegrityOutcome - homework_integrity:record + the same row rule (audited; changes no mark)
 *   addHomeworkIntegrityNote      - the view gate + the row rule; any investigator adds a note
 *   recomputeHomeworkIntegrity    - homework_integrity:view_all; "আবার হিসাব করুন" (the nightly sweep, on demand)
 *   homeworkIntegritySettings     - settings | view_all; the gap and the recurring count
 *   saveHomeworkIntegritySettings - homework_integrity:settings (Principal only, LOCKED)
 *   sectionOutsideHelpTags        - mastery:view + the row rule (assertMayWork); the live tags on a section x subject,
 *                                   so the marks grid can mark a tagged objective's HW/AS marks
 *   studentOutsideHelpTags        - mastery:view + the row rule per subject (assertMayWork): one child's live tags, for the
 *                                   mastery student / outcome-trail / entry screens (a subject the caller may not work is dropped)
 *   childHintSteps                - mastery:view + the section's teacher; how many hint steps (0..3) the
 *                                   child's family opened per question (read-only, GH-1 follow-up)
 *
 * Nothing here is reachable by a guardian. The only people messaged are the class teacher of a new case's section
 * and the Principal (IntegrityService, AC-H2).
 */
import { Types } from "mongoose";
import { callerHasPermission } from "@scd/shared";
import { builder } from "../../../schema";
import { Student } from "../../foundation/models/Student";
import { MasteryAssignmentSheet } from "../../mastery/models/MasteryAssignmentSheet";
import { MasteryAssignment } from "../../mastery/models/MasteryAssignment";
import { assertMayWork, type Auth } from "../../mastery/services/MasteryWorkService";
import {
  addCaseNote,
  caseDetail,
  hintStepsFor,
  integrityPolicy,
  listCases,
  recordOutcome,
  saveIntegrityPolicy,
  sweepYear,
  type CaseDetail,
  type CaseItemView,
  type CaseNoteView,
  type CaseRow,
  type IntegrityActor,
  type IntegrityPolicy,
  type IntegrityViewer,
  type RecomputeSummary,
} from "../services/IntegrityService";
import { tagsForSection, tagsForStudent, OUTSIDE_HELP_MARK_BN, type StaffTag } from "../services/IntegrityTagService";
import type { MasterySubject } from "@scd/shared";

function authOf(ctx: { auth: Auth | null }): Auth {
  if (!ctx.auth) throw new Error("লগইন প্রয়োজন।");
  return ctx.auth;
}

/** The row rule's input: `all` is `homework_integrity:view_all`; everyone else is an investigating teacher. */
function viewerOf(ctx: { auth: Auth | null }): IntegrityViewer {
  const a = authOf(ctx);
  return { userId: a.userId, all: callerHasPermission(a, "homework_integrity:view_all") };
}
const actorOf = (ctx: { auth: Auth | null }): IntegrityActor => ({ ...viewerOf(ctx), role: authOf(ctx).role });

const CaseRowRef = builder.objectRef<CaseRow>("HomeworkIntegrityCaseRow");
CaseRowRef.implement({
  description: "One homework-honesty case as the Office queue lists it. Staff-only; no guardian type carries it.",
  fields: (t) => ({
    id: t.exposeString("id"),
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    studentSchoolId: t.exposeString("studentSchoolId"),
    classToken: t.exposeString("classToken"),
    classNameBn: t.exposeString("classNameBn"),
    sectionId: t.exposeString("sectionId"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    subject: t.exposeString("subject"),
    loCode: t.exposeString("loCode"),
    loLabelBn: t.exposeString("loLabelBn"),
    hwPct: t.exposeFloat("hwPct"),
    ctPct: t.exposeFloat("ctPct"),
    gap: t.exposeFloat("gap"),
    status: t.exposeString("status"),
    outcome: t.exposeString("outcome", { nullable: true }),
    note: t.exposeString("note", { nullable: true }),
    openedAt: t.exposeString("openedAt"),
    closedAt: t.exposeString("closedAt", { nullable: true }),
    recurring: t.exposeBoolean("recurring"),
    tagActive: t.exposeBoolean("tagActive", { description: "AL-12: the term tag is on right now (outcome GUARDIAN_DID / UNCLEAR)." }),
    tagUntil: t.exposeString("tagUntil", { nullable: true }),
  }),
});

const ItemRef = builder.objectRef<CaseItemView>("HomeworkIntegrityItem");
ItemRef.implement({
  fields: (t) => ({
    paperId: t.exposeString("paperId"),
    qid: t.exposeString("qid", { nullable: true }),
    itemNo: t.exposeInt("itemNo", { nullable: true }),
    earned: t.exposeFloat("earned"),
    available: t.exposeFloat("available"),
    date: t.exposeString("date"),
    hintStep: t.exposeInt("hintStep"),
  }),
});

const HistoryRef = builder.objectRef<CaseDetail["history"][number]>("HomeworkIntegrityHistory");
HistoryRef.implement({ fields: (t) => ({ at: t.exposeString("at"), hwPct: t.exposeFloat("hwPct"), ctPct: t.exposeFloat("ctPct") }) });

const NoteRef = builder.objectRef<CaseNoteView>("HomeworkIntegrityNote");
NoteRef.implement({
  fields: (t) => ({ byName: t.exposeString("byName"), at: t.exposeString("at"), text: t.exposeString("text"), mine: t.exposeBoolean("mine") }),
});

const CaseDetailRef = builder.objectRef<CaseDetail>("HomeworkIntegrityCase");
CaseDetailRef.implement({
  fields: (t) => ({
    row: t.field({ type: CaseRowRef, resolve: (c) => c }),
    hwItems: t.field({ type: [ItemRef], resolve: (c) => c.hwItems }),
    ctItems: t.field({ type: [ItemRef], resolve: (c) => c.ctItems }),
    history: t.field({ type: [HistoryRef], resolve: (c) => c.history }),
    investigatorNames: t.stringList({ resolve: (c) => c.investigatorNames }),
    notes: t.field({ type: [NoteRef], resolve: (c) => c.notes }),
  }),
});

const SettingsRef = builder.objectRef<IntegrityPolicy>("HomeworkIntegritySettings");
SettingsRef.implement({
  description: "The two school-wide policy keys (PRD section 3.5): the gap that opens a case and the cases in a term that make a child recurring.",
  fields: (t) => ({ gapPoints: t.exposeFloat("gapPoints"), recurringCases: t.exposeInt("recurringCases") }),
});

const TagRef = builder.objectRef<StaffTag & { markBn: string }>("HomeworkIntegrityTag");
TagRef.implement({
  description: "A live term tag (outcome GUARDIAN_DID / UNCLEAR) on a child's objective - staff views only; a note, never a mark change.",
  fields: (t) => ({
    caseId: t.exposeString("caseId"),
    studentId: t.exposeString("studentId"),
    subject: t.exposeString("subject"),
    loCode: t.exposeString("loCode"),
    loLabelBn: t.exposeString("loLabelBn"),
    outcome: t.exposeString("outcome"),
    tagUntil: t.exposeString("tagUntil"),
    recurring: t.exposeBoolean("recurring"),
    markBn: t.exposeString("markBn", { description: "The note a tagged objective's HW/AS marks carry." }),
  }),
});

const SummaryRef = builder.objectRef<RecomputeSummary>("HomeworkIntegrityRecompute");
SummaryRef.implement({
  fields: (t) => ({
    checked: t.exposeInt("checked"),
    opened: t.exposeInt("opened"),
    updated: t.exposeInt("updated"),
    reopened: t.exposeInt("reopened"),
  }),
});

builder.queryField("homeworkIntegrityCases", (t) =>
  t.field({
    type: [CaseRowRef],
    description:
      "The homework-honesty queue (HW+AS percentage `integrityGapPoints`+ above the class-test percentage on one objective), worst gap " +
      "first, open before closed. At most 500 rows. Office / Principal (view_all) see all; a teacher only the cases that name them.",
    authScopes: { hasAnyPermission: ["homework_integrity:view", "homework_integrity:view_all"] },
    args: {
      status: t.arg.string({ required: false, description: "OPEN or CLOSED; omit for both." }),
      classToken: t.arg.string({ required: false }),
      sectionId: t.arg.string({ required: false }),
      subject: t.arg.string({ required: false }),
    },
    resolve: (_r, args, ctx) => listCases(args, viewerOf(ctx)),
  }),
);

builder.queryField("homeworkIntegrityCase", (t) =>
  t.field({
    type: CaseDetailRef,
    description: "One case with the items behind each number, the hint steps opened on each (GH-1), the investigators and their notes.",
    authScopes: { hasAnyPermission: ["homework_integrity:view", "homework_integrity:view_all"] },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => caseDetail(args.id, viewerOf(ctx)),
  }),
);

builder.mutationField("recordHomeworkIntegrityOutcome", (t) =>
  t.field({
    type: CaseRowRef,
    description:
      "Close a case with the finding (GUARDIAN_DID / CHILD_DID / UNCLEAR) and a note - the Office, or the class teacher / subject teacher " +
      "of that case (row rule). GUARDIAN_DID / UNCLEAR start the term tag. Audited. Changes no mark.",
    authScopes: { hasPermission: "homework_integrity:record" },
    args: {
      id: t.arg.string({ required: true }),
      outcome: t.arg.string({ required: true }),
      note: t.arg.string({ required: false }),
    },
    resolve: (_r, args, ctx) => recordOutcome(args.id, args.outcome, args.note, actorOf(ctx)),
  }),
);

builder.mutationField("addHomeworkIntegrityNote", (t) =>
  t.field({
    type: CaseDetailRef,
    description: "Add a note to a case (any investigator of it, or view_all). Open or closed; never edited. Audited.",
    authScopes: { hasAnyPermission: ["homework_integrity:view", "homework_integrity:view_all"] },
    args: { id: t.arg.string({ required: true }), text: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => addCaseNote(args.id, args.text, actorOf(ctx)),
  }),
);

builder.mutationField("recomputeHomeworkIntegrity", (t) =>
  t.field({
    type: SummaryRef,
    description: "Run the nightly sweep now for the current academic year (idempotent). A NEW case notifies its class teacher + the Principal once.",
    authScopes: { hasPermission: "homework_integrity:view_all" },
    resolve: () => sweepYear(),
  }),
);

builder.queryField("homeworkIntegritySettings", (t) =>
  t.field({
    type: SettingsRef,
    description: "The gap in points that opens a case and the cases in a term that make a child recurring.",
    authScopes: { hasAnyPermission: ["homework_integrity:settings", "homework_integrity:view_all"] },
    resolve: () => integrityPolicy(),
  }),
);

builder.mutationField("saveHomeworkIntegritySettings", (t) =>
  t.field({
    type: SettingsRef,
    description: "Principal only (LOCKED): set the gap and the recurring count. Moves only these two keys; audited.",
    authScopes: { hasPermission: "homework_integrity:settings" },
    args: { gapPoints: t.arg.float({ required: true }), recurringCases: t.arg.int({ required: true }) },
    resolve: (_r, args, ctx) => saveIntegrityPolicy({ gapPoints: args.gapPoints, recurringCases: args.recurringCases }, { userId: authOf(ctx).userId, role: authOf(ctx).role }),
  }),
);

builder.queryField("studentOutsideHelpTags", (t) =>
  t.field({
    type: [TagRef],
    description:
      "One child's live term tags (AL-12): optionally narrowed to a subject or one objective. Only subjects the caller may work " +
      "(routine holder of the child's section x subject, or mastery:edit_all) come back; others are dropped, never an error. A note only.",
    authScopes: { hasPermission: "mastery:view" },
    args: { studentId: t.arg.string({ required: true }), subject: t.arg.string({ required: false }), loCode: t.arg.string({ required: false }) },
    resolve: async (_r, args, ctx) => {
      const auth = authOf(ctx);
      if (!Types.ObjectId.isValid(args.studentId)) return [];
      const st = await Student.findById(args.studentId).select("sectionId").lean();
      if (!st) return [];
      const wanted = (await tagsForStudent(args.studentId)).filter((x) => (!args.subject || x.subject === args.subject) && (!args.loCode || x.loCode === args.loCode));
      const out: Array<StaffTag & { markBn: string }> = [];
      const allowed = new Map<string, boolean>();
      for (const x of wanted) {
        if (!allowed.has(x.subject)) {
          try {
            await assertMayWork(auth, st.sectionId as Types.ObjectId, x.subject as MasterySubject, new Date());
            allowed.set(x.subject, true);
          } catch {
            allowed.set(x.subject, false);
          }
        }
        if (allowed.get(x.subject)) out.push({ ...x, markBn: OUTSIDE_HELP_MARK_BN });
      }
      return out;
    },
  }),
);

builder.queryField("sectionOutsideHelpTags", (t) =>
  t.field({
    type: [TagRef],
    description:
      "The live term tags (outside-help outcome GUARDIAN_DID / UNCLEAR) on one section x subject, for the marks grid: HW/AS marks on a " +
      "tagged objective carry the note. The section's subject teacher (row rule) or mastery:edit_all. A note only - no mark changes.",
    authScopes: { hasPermission: "mastery:view" },
    args: { sectionId: t.arg.string({ required: true }), subject: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => {
      const auth = authOf(ctx);
      if (!Types.ObjectId.isValid(args.sectionId)) return [];
      await assertMayWork(auth, new Types.ObjectId(args.sectionId), args.subject as MasterySubject, new Date());
      return (await tagsForSection(args.sectionId, args.subject)).map((x) => ({ ...x, markBn: OUTSIDE_HELP_MARK_BN }));
    },
  }),
);

// -- the teacher's read-only hint count (GH-1 follow-up) ----------------------

const HintStepRef = builder.objectRef<{ qid: string; step: number }>("ChildHintStepCount");
HintStepRef.implement({ fields: (t) => ({ qid: t.exposeString("qid"), step: t.exposeInt("step") }) });

builder.queryField("childHintSteps", (t) =>
  t.field({
    type: [HintStepRef],
    description:
      "How many hint steps (1..3) any guardian of the child opened per question - only questions with at least one step " +
      "are returned. Teacher of the assignment's section x subject (or mastery:edit_all). Read-only.",
    authScopes: { hasPermission: "mastery:view" },
    args: {
      studentId: t.arg.string({ required: true }),
      assignmentId: t.arg.string({ required: true }),
      qids: t.arg.stringList({ required: true }),
    },
    resolve: async (_r, args, ctx) => {
      const auth = authOf(ctx);
      if (!Types.ObjectId.isValid(args.studentId) || !Types.ObjectId.isValid(args.assignmentId)) return [];
      const a = await MasteryAssignment.findById(args.assignmentId).select("sectionId subject partA").lean();
      if (!a) return [];
      await assertMayWork(auth, a.sectionId, a.subject as MasterySubject, new Date());
      // The child must be on this section's roll (current section).
      const st = await Student.findOne({ _id: args.studentId, sectionId: a.sectionId }).select("_id").lean();
      if (!st) return [];
      // Only questions that are on this assignment (Part A + this child's Part B).
      const sheet = await MasteryAssignmentSheet.findOne({ assignmentId: a._id, studentId: args.studentId }).select("items").lean();
      const onSheet = new Set<string>([...(a.partA ?? []), ...(sheet?.items ?? [])].map((q) => q.qid).filter((x): x is string => !!x));
      const steps = await hintStepsFor(args.studentId, args.qids.slice(0, 300).filter((q) => onSheet.has(q)));
      return [...steps.entries()].filter(([, s]) => s > 0).map(([qid, step]) => ({ qid, step }));
    },
  }),
);
