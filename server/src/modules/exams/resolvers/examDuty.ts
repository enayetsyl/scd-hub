/**
 * Exam duty roster resolvers (D-#1660).
 *
 *   sittingDutyRoster    — exam_routine:manage: the whole roster of one exam.
 *   sittingDutyCandidates — exam_routine:manage: who can be put on a duty.
 *   mySittingDuties      — exam_routine:view: the caller's own upcoming duties.
 *   assignSittingDuty    — exam_routine:manage: put on / swap (reason needed to swap).
 *   clearSittingDuty     — exam_routine:manage: take off (reason needed).
 */
import { builder } from "../../../schema";
import {
  assignExamDuty,
  clearExamDuty,
  dutyCandidates,
  examDutyRoster,
  myExamDuties,
  type DutyCandidateShape,
  type DutyRosterShape,
  type DutyShape,
  type MyDutyShape,
  type SittingShape,
  type TeacherCountShape,
} from "../services/ExamDutyService";

const DutyRef = builder.objectRef<DutyShape>("ExamSittingDuty");
DutyRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    seat: t.exposeInt("seat"),
    teacherId: t.exposeString("teacherId"),
    teacherName: t.exposeString("teacherName"),
    room: t.exposeString("room"),
    // OVERLAP | LEAVE | NO_SITTING
    conflicts: t.exposeStringList("conflicts"),
  }),
});

const SittingRef = builder.objectRef<SittingShape>("ExamDutySitting");
SittingRef.implement({
  fields: (t) => ({
    classId: t.exposeString("classId"),
    classLabelBn: t.exposeString("classLabelBn"),
    level: t.exposeInt("level"),
    dateKey: t.exposeString("dateKey"),
    subject: t.exposeString("subject"),
    kind: t.exposeString("kind"),
    start: t.exposeString("start"),
    end: t.exposeString("end"),
    orphan: t.exposeBoolean("orphan"),
    duties: t.field({ type: [DutyRef], resolve: (s) => s.duties }),
  }),
});

const CountRef = builder.objectRef<TeacherCountShape>("ExamDutyCount");
CountRef.implement({
  fields: (t) => ({
    teacherId: t.exposeString("teacherId"),
    teacherName: t.exposeString("teacherName"),
    count: t.exposeInt("count"),
  }),
});

const RosterRef = builder.objectRef<DutyRosterShape>("ExamDutyRoster");
RosterRef.implement({
  fields: (t) => ({
    examId: t.exposeString("examId"),
    examName: t.exposeString("examName"),
    sittings: t.field({ type: [SittingRef], resolve: (r) => r.sittings }),
    counts: t.field({ type: [CountRef], resolve: (r) => r.counts }),
    conflictCount: t.exposeInt("conflictCount"),
    emptyCount: t.exposeInt("emptyCount"),
  }),
});

const MineRef = builder.objectRef<MyDutyShape>("MyExamDuty");
MineRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    examId: t.exposeString("examId"),
    examName: t.exposeString("examName"),
    dateKey: t.exposeString("dateKey"),
    subject: t.exposeString("subject"),
    kind: t.exposeString("kind"),
    classLabelBn: t.exposeString("classLabelBn"),
    start: t.exposeString("start"),
    end: t.exposeString("end"),
    room: t.exposeString("room"),
  }),
});

const CandidateRef = builder.objectRef<DutyCandidateShape>("ExamDutyCandidate");
CandidateRef.implement({
  fields: (t) => ({
    userId: t.exposeString("userId"),
    name: t.exposeString("name"),
  }),
});

builder.queryField("sittingDutyRoster", (t) =>
  t.field({
    type: RosterRef,
    description: "Every sitting of the exam routine with its invigilators, conflicts and per-teacher counts (D-#1660).",
    authScopes: { hasPermission: "exam_routine:manage" },
    args: { examId: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => examDutyRoster(ctx, args.examId),
  }),
);

builder.queryField("sittingDutyCandidates", (t) =>
  t.field({
    type: [CandidateRef],
    authScopes: { hasPermission: "exam_routine:manage" },
    resolve: (_r, _a, ctx) => dutyCandidates(ctx),
  }),
);

builder.queryField("mySittingDuties", (t) =>
  t.field({
    type: [MineRef],
    description: "The caller's own upcoming exam duties (D-#1660).",
    authScopes: { hasAnyPermission: ["exam_routine:view", "exam_routine:manage"] },
    resolve: (_r, _a, ctx) => myExamDuties(ctx),
  }),
);

builder.mutationField("assignSittingDuty", (t) =>
  t.field({
    type: DutyRef,
    description: "Put a teacher on a sitting seat, or swap the one already there (a reason is then required).",
    authScopes: { hasPermission: "exam_routine:manage" },
    args: {
      examId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      dateKey: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      kind: t.arg.string({ required: true }),
      seat: t.arg.int({ required: false }),
      teacherId: t.arg.string({ required: true }),
      room: t.arg.string({ required: false }),
      reason: t.arg.string({ required: false }),
    },
    resolve: (_r, a, ctx) => assignExamDuty(ctx, a),
  }),
);

builder.mutationField("clearSittingDuty", (t) =>
  t.boolean({
    description: "Take a duty off a sitting (reason required).",
    authScopes: { hasPermission: "exam_routine:manage" },
    args: { dutyId: t.arg.string({ required: true }), reason: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => clearExamDuty(ctx, a.dutyId, a.reason),
  }),
);
