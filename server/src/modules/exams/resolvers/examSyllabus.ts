/**
 * Exam syllabus resolvers (SY-3/SY-6, docs/prd-exam-syllabus.md).
 *
 *   examSyllabusClass       — authenticated; one class's syllabus, role-scoped.
 *   examSyllabusDetail      — authenticated; one subject; refuses unpublished to staff readers.
 *   guardianChildSyllabus   — guardian:read_child; the linked child's class, PUBLISHED only.
 *   mySyllabusApprovals     — authenticated; the teacher's "waiting on you" list + drawer badge.
 *   examSyllabusApprover    — exam:manage; who the routine says teaches this pair.
 *   saveExamSyllabus        — exam:manage
 *   submitExamSyllabus      — exam:manage
 *   approveExamSyllabus     — authenticated; gated to the NAMED routine holder in the service (D-#530)
 *   sendBackExamSyllabus    — authenticated; gated per stage in the service
 *   publishExamSyllabus     — exam:manage + PRINCIPAL role, enforced in the service (§7.4)
 *
 * `approveExamSyllabus` deliberately carries only `authenticated: true`: the
 * authority is "do you teach this class × subject in the routine", which is a row
 * fact, not a permission — the CO-1 assigned-observer posture (D-#147). A
 * permission here would let AC-1 hand sign-off to someone who teaches nothing.
 */
import { builder } from "../../../schema";
import {
  saveSyllabus,
  submitSyllabusToTeacher,
  approveSyllabusAsTeacher,
  sendBackSyllabus,
  publishSyllabus,
  routineHoldersFor,
  defaultApproverFor,
} from "../services/ExamSyllabusService";
import {
  classSyllabus,
  syllabusDetail,
  guardianChildSyllabus,
  mySyllabusApprovals,
  type SyllabusShape,
  type ClassSyllabusView,
} from "../services/ExamSyllabusReadService";
import type { RoutineSubject } from "@scd/shared";

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

const MarkRowRef = builder.objectRef<SyllabusShape["marks"][number]>("SyllabusMarkRow");
MarkRowRef.implement({
  description:
    "One numbered line of the মানবন্টন. A row carrying `component` (CT/ADAB) IS a report-card " +
    "component rather than a question item and has no count/marksEach (D-#528).",
  fields: (t) => ({
    seq: t.exposeInt("seq"),
    label: t.exposeString("label"),
    itemType: t.string({ nullable: true, resolve: (r) => r.itemType ?? null }),
    component: t.string({ nullable: true, resolve: (r) => r.component ?? null }),
    count: t.int({ nullable: true, resolve: (r) => r.count ?? null }),
    marksEach: t.int({ nullable: true, resolve: (r) => r.marksEach ?? null }),
    total: t.exposeInt("total"),
  }),
});

const SyllabusRef = builder.objectRef<SyllabusShape>("ExamSyllabus");
SyllabusRef.implement({
  description:
    "One exam syllabus for a (exam × class × subject): the prose, the mark distribution and the " +
    "question types. `pending: true` marks a subject the caller teaches that has no published row yet.",
  fields: (t) => ({
    id: t.string({ nullable: true, resolve: (r) => r.id }),
    examId: t.exposeString("examId"),
    classId: t.exposeString("classId"),
    subject: t.exposeString("subject"),
    bodyMd: t.exposeString("bodyMd"),
    marks: t.field({ type: [MarkRowRef], resolve: (r) => r.marks }),
    questionTypes: t.stringList({ resolve: (r) => r.questionTypes }),
    examDateKey: t.string({ nullable: true, resolve: (r) => r.examDateKey }),
    status: t.exposeString("status"),
    isMine: t.exposeBoolean("isMine"),
    writtenMarks: t.exposeInt("writtenMarks"),
    oralMarks: t.exposeInt("oralMarks"),
    totalMarks: t.exposeInt("totalMarks"),
    pending: t.exposeBoolean("pending"),
  }),
});

const ClassSyllabusRef = builder.objectRef<ClassSyllabusView>("ClassSyllabus");
ClassSyllabusRef.implement({
  description:
    "One class's syllabus for one exam. `questionTypes`/`noteMd` are the sheet's per-CLASS footer, " +
    "rendered ONCE at the top rather than repeated on every subject (§5.5).",
  fields: (t) => ({
    examId: t.exposeString("examId"),
    classId: t.exposeString("classId"),
    classLabel: t.exposeString("classLabel"),
    classLevel: t.exposeInt("classLevel"),
    questionTypes: t.stringList({ resolve: (r) => r.questionTypes }),
    noteMd: t.exposeString("noteMd"),
    subjects: t.field({ type: [SyllabusRef], resolve: (r) => r.subjects }),
  }),
});

const ApproverRef = builder.objectRef<{ userId: string; periods: number }>("SyllabusApprover");
ApproverRef.implement({
  description: "A routine holder for a (class × subject), with the weekly period count that ranks them.",
  fields: (t) => ({
    userId: t.exposeString("userId"),
    periods: t.exposeInt("periods"),
  }),
});

const ApproverOptionsRef = builder.objectRef<{
  holders: { userId: string; periods: number }[];
  defaultUserId: string | null;
}>("SyllabusApproverOptions");
ApproverOptionsRef.implement({
  description:
    "Who the ROUTINE says teaches this pair. An empty `holders` list is the §7.2 case — the " +
    "Principal may sign off in the teacher's place, stamped as a bypass.",
  fields: (t) => ({
    holders: t.field({ type: [ApproverRef], resolve: (r) => r.holders }),
    defaultUserId: t.string({ nullable: true, resolve: (r) => r.defaultUserId }),
  }),
});

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

const MarkRowInput = builder.inputType("SyllabusMarkRowInput", {
  description:
    "One মানবন্টন row. Provide count+marksEach for a question row, or `component` (CT/ADAB) for a " +
    "report-card component row — never both (D-#528). `total` is always authoritative.",
  fields: (t) => ({
    seq: t.int({ required: true }),
    label: t.string({ required: true }),
    itemType: t.string({ required: false }),
    component: t.string({ required: false }),
    count: t.int({ required: false }),
    marksEach: t.int({ required: false }),
    total: t.int({ required: true }),
  }),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryFields((t) => ({
  examSyllabusClass: t.field({
    type: ClassSyllabusRef,
    description:
      "One class's syllabus for an exam. Principal/Office see every status; everyone else sees " +
      "PUBLISHED rows plus placeholders for their own not-yet-published subjects.",
    authScopes: { authenticated: true },
    args: {
      examId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => classSyllabus(ctx, args.examId, args.classId),
  }),

  examSyllabusDetail: t.field({
    type: SyllabusRef,
    nullable: true,
    description: "One subject's syllabus. Refuses an unpublished row to anyone but Principal/Office.",
    authScopes: { authenticated: true },
    args: {
      examId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) =>
      syllabusDetail(ctx, args.examId, args.classId, args.subject as RoutineSubject),
  }),

  guardianChildSyllabus: t.field({
    type: ClassSyllabusRef,
    description:
      "The linked child's class syllabus, PUBLISHED rows only. Link-scoped via assertGuardianOfStudent.",
    authScopes: { hasPermission: "guardian:read_child" },
    args: {
      examId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => guardianChildSyllabus(ctx, args.examId, args.studentId),
  }),

  mySyllabusApprovals: t.field({
    type: [SyllabusRef],
    description:
      "Syllabuses waiting on THIS caller's subject-teacher sign-off. Returns [] — never an error — " +
      "for a caller with none, because the drawer badge reads it on every render (the 791e5fe rule).",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => mySyllabusApprovals(ctx),
  }),

  examSyllabusApprover: t.field({
    type: ApproverOptionsRef,
    description: "The routine holders for a (class × subject), most periods first (§7.1).",
    authScopes: { hasPermission: "exam:manage" },
    args: {
      classId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
    },
    resolve: async (_root, args) => ({
      holders: await routineHoldersFor(args.classId, args.subject as RoutineSubject),
      defaultUserId: await defaultApproverFor(args.classId, args.subject as RoutineSubject),
    }),
  }),
}));

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationFields((t) => ({
  saveExamSyllabus: t.field({
    type: SyllabusRef,
    description:
      "Create or update one syllabus row. Refuses Σ marks ≠ 100 and mojibake. A CONTENT edit to an " +
      "already-approved row returns it to DRAFT and clears the teacher's sign-off (§7.3).",
    authScopes: { hasPermission: "exam:manage" },
    args: {
      examId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      bodyMd: t.arg.string({ required: true }),
      marks: t.arg({ type: [MarkRowInput], required: true }),
      questionTypes: t.arg.stringList({ required: true }),
      examDateKey: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const doc = await saveSyllabus(ctx, {
        examId: args.examId,
        classId: args.classId,
        subject: args.subject as RoutineSubject,
        bodyMd: args.bodyMd,
        marks: args.marks.map((m) => ({
          seq: m.seq,
          label: m.label,
          itemType: (m.itemType ?? null) as SyllabusShape["marks"][number]["itemType"],
          component: (m.component ?? null) as SyllabusShape["marks"][number]["component"],
          count: m.count ?? null,
          marksEach: m.marksEach ?? null,
          total: m.total,
        })),
        questionTypes: args.questionTypes as SyllabusShape["questionTypes"],
        examDateKey: args.examDateKey ?? null,
      });
      return (await syllabusDetail(
        ctx,
        doc.examId.toString(),
        doc.classId.toString(),
        doc.subject,
      ))!;
    },
  }),

  submitExamSyllabus: t.field({
    type: SyllabusRef,
    description:
      "DRAFT → TEACHER_REVIEW. `approverUserId` must be a ROUTINE holder of the pair; omit it to " +
      "take the default (most periods, §7.1).",
    authScopes: { hasPermission: "exam:manage" },
    args: {
      id: t.arg.string({ required: true }),
      approverUserId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const doc = await submitSyllabusToTeacher(ctx, args.id, args.approverUserId ?? null);
      return (await syllabusDetail(
        ctx,
        doc.examId.toString(),
        doc.classId.toString(),
        doc.subject,
      ))!;
    },
  }),

  approveExamSyllabus: t.field({
    type: SyllabusRef,
    description:
      "TEACHER_REVIEW → PRINCIPAL_REVIEW. Allowed to the NAMED routine holder, or to the Principal " +
      "when the routine names nobody — the latter stamped as a bypass (§7.2).",
    authScopes: { authenticated: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const doc = await approveSyllabusAsTeacher(ctx, args.id);
      return (await syllabusDetail(
        ctx,
        doc.examId.toString(),
        doc.classId.toString(),
        doc.subject,
      ))!;
    },
  }),

  sendBackExamSyllabus: t.field({
    type: SyllabusRef,
    description: "Either review stage → DRAFT. The reason is mandatory.",
    authScopes: { authenticated: true },
    args: {
      id: t.arg.string({ required: true }),
      reason: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const doc = await sendBackSyllabus(ctx, args.id, args.reason);
      return (await syllabusDetail(
        ctx,
        doc.examId.toString(),
        doc.classId.toString(),
        doc.subject,
      ))!;
    },
  }),

  publishExamSyllabus: t.field({
    type: SyllabusRef,
    description:
      "PRINCIPAL_REVIEW → PUBLISHED. Sets publishedAt, the ONE guardian-visible predicate. Office " +
      "holds exam:manage and is still refused — publish rides the PRINCIPAL role (§7.4).",
    authScopes: { hasPermission: "exam:manage" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const doc = await publishSyllabus(ctx, args.id);
      return (await syllabusDetail(
        ctx,
        doc.examId.toString(),
        doc.classId.toString(),
        doc.subject,
      ))!;
    },
  }),
}));
