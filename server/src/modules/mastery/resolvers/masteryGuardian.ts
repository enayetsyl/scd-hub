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
import { childMasteryAssignments, type ChildAssignmentView } from "../services/MasteryGuardianService";

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
