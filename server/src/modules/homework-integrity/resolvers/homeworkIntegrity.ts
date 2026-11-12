/**
 * Homework-honesty flag (GH-3, docs/prd-guardian-help.md section 4, D-#1522). Office / Principal only.
 *
 *   homeworkIntegrityCases        - homework_integrity:view; the queue, filtered
 *   homeworkIntegrityCase         - homework_integrity:view; one case with the items behind each number
 *   recordHomeworkIntegrityOutcome - homework_integrity:record; the Office writes what it found (audited)
 *   recomputeHomeworkIntegrity    - homework_integrity:record; "আবার হিসাব করুন" (the nightly sweep, on demand)
 *   childHintSteps                - mastery:view + the section's teacher; how many hint steps (0..3) the
 *                                   child's family opened per question (read-only, GH-1 follow-up)
 *
 * Nothing here is reachable by a guardian and nothing here sends a message to anyone.
 */
import { Types } from "mongoose";
import { builder } from "../../../schema";
import { Student } from "../../foundation/models/Student";
import { MasteryAssignmentSheet } from "../../mastery/models/MasteryAssignmentSheet";
import { MasteryAssignment } from "../../mastery/models/MasteryAssignment";
import { assertMayWork, type Auth } from "../../mastery/services/MasteryWorkService";
import {
  caseDetail,
  hintStepsFor,
  listCases,
  recordOutcome,
  sweepYear,
  type CaseDetail,
  type CaseItemView,
  type CaseRow,
  type RecomputeSummary,
} from "../services/IntegrityService";
import type { MasterySubject } from "@scd/shared";

function authOf(ctx: { auth: Auth | null }): Auth {
  if (!ctx.auth) throw new Error("লগইন প্রয়োজন।");
  return ctx.auth;
}

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

const CaseDetailRef = builder.objectRef<CaseDetail>("HomeworkIntegrityCase");
CaseDetailRef.implement({
  fields: (t) => ({
    row: t.field({ type: CaseRowRef, resolve: (c) => c }),
    hwItems: t.field({ type: [ItemRef], resolve: (c) => c.hwItems }),
    ctItems: t.field({ type: [ItemRef], resolve: (c) => c.ctItems }),
    history: t.field({ type: [HistoryRef], resolve: (c) => c.history }),
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
      "The homework-honesty queue (HW+AS percentage 20+ points above the class-test percentage on one objective), worst gap " +
      "first, open before closed. At most 500 rows.",
    authScopes: { hasPermission: "homework_integrity:view" },
    args: {
      status: t.arg.string({ required: false, description: "OPEN or CLOSED; omit for both." }),
      classToken: t.arg.string({ required: false }),
      sectionId: t.arg.string({ required: false }),
      subject: t.arg.string({ required: false }),
    },
    resolve: (_r, args) => listCases(args),
  }),
);

builder.queryField("homeworkIntegrityCase", (t) =>
  t.field({
    type: CaseDetailRef,
    description: "One case with the items behind each number and the hint steps opened on each (GH-1).",
    authScopes: { hasPermission: "homework_integrity:view" },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args) => caseDetail(args.id),
  }),
);

builder.mutationField("recordHomeworkIntegrityOutcome", (t) =>
  t.field({
    type: CaseRowRef,
    description: "Close a case with the Office's finding (GUARDIAN_DID / CHILD_DID / UNCLEAR) and a note. Audited. Changes no mark.",
    authScopes: { hasPermission: "homework_integrity:record" },
    args: {
      id: t.arg.string({ required: true }),
      outcome: t.arg.string({ required: true }),
      note: t.arg.string({ required: false }),
    },
    resolve: (_r, args, ctx) => recordOutcome(args.id, args.outcome, args.note, { userId: authOf(ctx).userId, role: authOf(ctx).role }),
  }),
);

builder.mutationField("recomputeHomeworkIntegrity", (t) =>
  t.field({
    type: SummaryRef,
    description: "Run the nightly sweep now for the current academic year (idempotent). Sends nothing to anyone.",
    authScopes: { hasPermission: "homework_integrity:record" },
    resolve: () => sweepYear(),
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
