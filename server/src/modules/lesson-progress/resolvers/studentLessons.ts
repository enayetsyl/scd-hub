/**
 * Lesson-plan progress LP-3 resolvers (D-#823/#826): a student's lessons with presence. The mastery
 * chapter link (D-#825) is exposed on the mastery types themselves (masteryDiagnosis / masteryAction).
 */
import { builder } from "../../../schema";
import { studentLessonsFor, type StudentLessons, type StudentSession } from "../services/StudentLessonService";

export const StudentSessionRef = builder.objectRef<StudentSession>("StudentLessonSession").implement({
  fields: (t) => ({
    subject: t.exposeString("subject"),
    key: t.exposeString("key"),
    chapter: t.exposeString("chapter"),
    anchorWord: t.exposeString("anchorWord"),
    sessionIndex: t.exposeInt("sessionIndex"),
    sessionOf: t.exposeInt("sessionOf"),
    titleBn: t.exposeString("titleBn"),
    taughtOn: t.exposeStringList("taughtOn"),
    absentOn: t.exposeStringList("absentOn"),
    unknownOn: t.exposeStringList("unknownOn"),
    /** PRESENT | PARTIAL | ABSENT | UNKNOWN */
    presence: t.exposeString("presence"),
    onLeave: t.exposeBoolean("onLeave"),
  }),
});

type SubjectBlock = StudentLessons["subjects"][number];
const PresenceCountsRef = builder.objectRef<SubjectBlock["counts"]>("StudentLessonCounts").implement({
  fields: (t) => ({
    present: t.int({ resolve: (c) => c.PRESENT }),
    partial: t.int({ resolve: (c) => c.PARTIAL }),
    absent: t.int({ resolve: (c) => c.ABSENT }),
    unknown: t.int({ resolve: (c) => c.UNKNOWN }),
  }),
});

const SubjectBlockRef = builder.objectRef<SubjectBlock>("StudentLessonSubject").implement({
  fields: (t) => ({
    subject: t.exposeString("subject"),
    counts: t.field({ type: PresenceCountsRef, resolve: (b) => b.counts }),
    sessions: t.field({ type: [StudentSessionRef], resolve: (b) => b.sessions }),
  }),
});

const StudentLessonsRef = builder.objectRef<StudentLessons & { narrowed: boolean }>("StudentLessons").implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    narrowed: t.exposeBoolean("narrowed"),
    subjects: t.field({ type: [SubjectBlockRef], resolve: (x) => x.subjects }),
  }),
});

builder.queryField("studentLessons", (t) =>
  t.field({
    type: StudentLessonsRef,
    description:
      "LP-3 (D-#823): every session plan taught in the child's শাখা while they were on its roster, with presence from " +
      "the day attendance (PRESENT / PARTIAL / ABSENT / UNKNOWN). A subject teacher sees only their own subjects (`narrowed`).",
    authScopes: { hasAnyPermission: ["lesson_progress:view", "lesson_progress:view_all"] },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => studentLessonsFor(args.studentId, ctx.auth!),
  }),
);
