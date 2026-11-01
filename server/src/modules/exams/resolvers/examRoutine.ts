/**
 * Exam routine resolvers (D-#883).
 *
 *   examRoutine           — exam_routine:view|manage|publish; non-managers see it once published.
 *   guardianExamRoutine   — guardian plane (guardian:read_child + assertGuardianOfStudent).
 *   saveExamRoutineClass  — exam_routine:manage.
 *   publishExamRoutine    — exam_routine:publish.
 */
import { builder } from "../../../schema";
import {
  examRoutine,
  guardianExamRoutine,
  publishExamRoutine,
  saveExamRoutineClass,
  type ExamRoutineClassShape,
  type ExamRoutineShape,
  type ExamRoutineSlotShape,
  type GuardianExamRoutineShape,
  type QuranExamDayShape,
} from "../services/ExamRoutineService";

const SlotRef = builder.objectRef<ExamRoutineSlotShape>("ExamRoutineSlot");
SlotRef.implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    subject: t.exposeString("subject"),
    // WRITTEN | ORAL
    kind: t.exposeString("kind"),
    start: t.exposeString("start"),
    end: t.exposeString("end"),
    note: t.exposeString("note"),
  }),
});

const ClassRef = builder.objectRef<ExamRoutineClassShape>("ExamRoutineClass");
ClassRef.implement({
  fields: (t) => ({
    classId: t.exposeString("classId"),
    level: t.exposeInt("level"),
    labelBn: t.exposeString("labelBn"),
    slots: t.field({ type: [SlotRef], resolve: (c) => c.slots }),
  }),
});

const QuranDayRef = builder.objectRef<QuranExamDayShape>("ExamRoutineQuranDay");
QuranDayRef.implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    levels: t.exposeStringList("levels"),
    start: t.exposeString("start"),
    end: t.exposeString("end"),
    makeUp: t.exposeBoolean("makeUp"),
  }),
});

const RoutineRef = builder.objectRef<ExamRoutineShape>("ExamRoutine");
RoutineRef.implement({
  fields: (t) => ({
    examId: t.exposeString("examId"),
    examName: t.exposeString("examName"),
    published: t.exposeBoolean("published"),
    publishedAt: t.string({ nullable: true, resolve: (r) => r.publishedAt }),
    noteBn: t.exposeString("noteBn"),
    classes: t.field({ type: [ClassRef], resolve: (r) => r.classes }),
    quranDays: t.field({ type: [QuranDayRef], resolve: (r) => r.quranDays }),
  }),
});

type GuardianQuranSitting = GuardianExamRoutineShape["quranSittings"][number];
const GuardianQuranSittingRef = builder.objectRef<GuardianQuranSitting>("ExamRoutineQuranSitting");
GuardianQuranSittingRef.implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    start: t.exposeString("start"),
    end: t.exposeString("end"),
    level: t.exposeString("level"),
    portionLabel: t.exposeString("portionLabel"),
  }),
});

const GuardianRoutineRef = builder.objectRef<GuardianExamRoutineShape>("GuardianExamRoutine");
GuardianRoutineRef.implement({
  fields: (t) => ({
    examId: t.exposeString("examId"),
    examName: t.exposeString("examName"),
    published: t.exposeBoolean("published"),
    noteBn: t.exposeString("noteBn"),
    classLabelBn: t.exposeString("classLabelBn"),
    slots: t.field({ type: [SlotRef], resolve: (r) => r.slots }),
    quranSittings: t.field({ type: [GuardianQuranSittingRef], resolve: (r) => r.quranSittings }),
  }),
});

const SlotInput = builder.inputType("ExamRoutineSlotInput", {
  fields: (t) => ({
    dateKey: t.string({ required: true }),
    subject: t.string({ required: true }),
    kind: t.string({ required: true }),
    start: t.string({ required: false }),
    end: t.string({ required: false }),
    note: t.string({ required: false }),
  }),
});

builder.queryField("examRoutine", (t) =>
  t.field({
    type: RoutineRef,
    description: "One exam's routine, every class, plus the Quran exam's days (D-#883).",
    authScopes: { hasAnyPermission: ["exam_routine:view", "exam_routine:manage", "exam_routine:publish"] },
    args: { examId: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => examRoutine(ctx, args.examId),
  }),
);

builder.queryField("guardianExamRoutine", (t) =>
  t.field({
    type: GuardianRoutineRef,
    description: "The linked child's class routine (published only) and their Quran exam sittings.",
    authScopes: { hasPermission: "guardian:read_child" },
    args: { examId: t.arg.string({ required: true }), studentId: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => guardianExamRoutine(ctx, args.examId, args.studentId),
  }),
);

builder.mutationField("saveExamRoutineClass", (t) =>
  t.field({
    type: RoutineRef,
    description: "Replace one class's routine slots; writes each subject's date onto the class's syllabus.",
    authScopes: { hasPermission: "exam_routine:manage" },
    args: {
      examId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      slots: t.arg({ type: [SlotInput], required: true }),
      noteBn: t.arg.string({ required: false }),
    },
    resolve: (_r, args, ctx) => saveExamRoutineClass(ctx, args.examId, args.classId, args.slots, args.noteBn),
  }),
);

builder.mutationField("publishExamRoutine", (t) =>
  t.field({
    type: RoutineRef,
    authScopes: { hasPermission: "exam_routine:publish" },
    args: { examId: t.arg.string({ required: true }), publish: t.arg.boolean({ required: true }) },
    resolve: (_r, args, ctx) => publishExamRoutine(ctx, args.examId, args.publish),
  }),
);
