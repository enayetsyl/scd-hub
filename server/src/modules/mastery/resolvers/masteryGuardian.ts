/**
 * Mastery tracker — the guardian plane (M-4b, mock G3, D-#783 / #810).
 *
 *   childMasteryAssignments — guardian:read_child + the guardian link (assertGuardianOfStudent);
 *                             the child's sent weekly assignments as printed, and how they went
 *
 * The PDF of one week is GET /pdf/mastery-assignment/:id?studentId=… (guardian path in the route).
 */
import { builder } from "../../../schema";
import { assertGuardianOfStudent } from "../../../middleware/authz";
import {
  childMasteryAssignments,
  childMasteryProgress,
  type ChildAssignmentView,
  type ChildProgressSubject,
} from "../services/MasteryGuardianService";

const QuestionRef = builder.objectRef<ChildAssignmentView["partA"][number]>("ChildMasteryQuestion");
QuestionRef.implement({
  fields: (t) => ({ n: t.exposeInt("n"), textBn: t.exposeString("textBn"), marks: t.exposeFloat("marks") }),
});

type Result = NonNullable<ChildAssignmentView["result"]>;
const ResultRowRef = builder.objectRef<Result["rows"][number]>("ChildMasteryResultRow");
ResultRowRef.implement({
  fields: (t) => ({
    labelBn: t.exposeString("labelBn"),
    earned: t.exposeFloat("earned"),
    available: t.exposeFloat("available"),
    again: t.exposeBoolean("again"),
  }),
});

const ResultRef = builder.objectRef<Result>("ChildMasteryResult");
ResultRef.implement({
  fields: (t) => ({
    earned: t.exposeFloat("earned"),
    available: t.exposeFloat("available"),
    rows: t.field({ type: [ResultRowRef], resolve: (r) => r.rows }),
    note: t.string({ nullable: true, resolve: (r) => r.note }),
    notMarked: t.exposeBoolean("notMarked"),
  }),
});

const AssignmentRef = builder.objectRef<ChildAssignmentView>("ChildMasteryAssignment");
AssignmentRef.implement({
  description: "A sent weekly assignment as printed on the child's page, and — once marked — how it went (plain words, D-#783).",
  fields: (t) => ({
    id: t.exposeString("id"),
    subject: t.exposeString("subject"),
    dueDate: t.exposeString("dueDate"),
    minutes: t.exposeInt("minutes"),
    totalMarks: t.exposeFloat("totalMarks"),
    partA: t.field({ type: [QuestionRef], resolve: (a) => a.partA }),
    partB: t.field({ type: [QuestionRef], resolve: (a) => a.partB }),
    result: t.field({ type: ResultRef, nullable: true, resolve: (a) => a.result }),
  }),
});

builder.queryField("childMasteryAssignments", (t) =>
  t.field({
    type: [AssignmentRef],
    description:
      "The linked child's sent weekly tailored assignments, newest first (M-4b). limit = the newest N weeks " +
      "(the app raises it with LoadOlder, D-#761). Link-gated (assertGuardianOfStudent); switched-off subjects are hidden.",
    authScopes: { hasPermission: "guardian:read_child" },
    args: {
      studentId: t.arg.string({ required: true }),
      limit: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return childMasteryAssignments(args.studentId, args.limit);
    },
  }),
);

// ---------------------------------------------------------------------------
// M-6 — progress and what the school did (mocks G1 / G2 / G4)
// ---------------------------------------------------------------------------

const CountsRef = builder.objectRef<ChildProgressSubject["counts"]>("ChildMasteryCounts");
CountsRef.implement({
  fields: (t) => ({
    attention: t.exposeInt("attention"),
    improving: t.exposeInt("improving"),
    good: t.exposeInt("good"),
    unknown: t.exposeInt("unknown"),
  }),
});

const AttentionRef = builder.objectRef<ChildProgressSubject["attention"][number]>("ChildMasteryAttention");
AttentionRef.implement({
  fields: (t) => ({ labelBn: t.exposeString("labelBn"), homeTipBn: t.string({ nullable: true, resolve: (a) => a.homeTipBn }) }),
});

const ImprovingRef = builder.objectRef<ChildProgressSubject["improving"][number]>("ChildMasteryImproving");
ImprovingRef.implement({ fields: (t) => ({ labelBn: t.exposeString("labelBn") }) });

const DidRef = builder.objectRef<ChildProgressSubject["schoolDid"][number]>("ChildMasterySchoolDid");
DidRef.implement({
  fields: (t) => ({
    date: t.exposeString("date"),
    kind: t.exposeString("kind"),
    labelBn: t.exposeString("labelBn"),
    status: t.exposeString("status"),
    present: t.boolean({ nullable: true, resolve: (d) => d.present }),
    retestPct: t.int({ nullable: true, resolve: (d) => d.retestPct }),
  }),
});

const ProgressRef = builder.objectRef<ChildProgressSubject>("ChildMasteryProgress");
ProgressRef.implement({
  description: "One subject of the child's mastery in plain words (D-#783): counts, topics needing attention with home tips, and what the school did.",
  fields: (t) => ({
    subject: t.exposeString("subject"),
    counts: t.field({ type: CountsRef, resolve: (p) => p.counts }),
    attention: t.field({ type: [AttentionRef], resolve: (p) => p.attention }),
    improving: t.field({ type: [ImprovingRef], resolve: (p) => p.improving }),
    schoolDid: t.field({ type: [DidRef], resolve: (p) => p.schoolDid }),
    assignmentsSent: t.exposeInt("assignmentsSent"),
  }),
});

builder.queryField("childMasteryProgress", (t) =>
  t.field({
    type: [ProgressRef],
    description:
      "The linked child's mastery per switched-on subject, in guardian wording (no codes, no verdict words, no ranks), " +
      "with home tips and the extra classes / re-teaches the child was part of (M-6). Link-gated (assertGuardianOfStudent).",
    authScopes: { hasPermission: "guardian:read_child" },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return childMasteryProgress(args.studentId);
    },
  }),
);
