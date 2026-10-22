/**
 * Lesson-plan progress LP-4 guardian resolver (D-#828): the lessons a linked child missed this
 * academic year, paged (D-#761). guardian:read_child + the guardian link (assertGuardianOfStudent).
 */
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import { assertGuardianOfStudent } from "../../../middleware/authz";
import { childMissedLessonsPage, type MissedLesson } from "../services/GuardianLessonService";

const MissedSessionRef = builder.objectRef<MissedLesson["sessions"][number]>("MissedLessonSession").implement({
  fields: (t) => ({
    chapter: t.exposeString("chapter"),
    anchorWord: t.exposeString("anchorWord"),
    sessionIndex: t.exposeInt("sessionIndex"),
    sessionOf: t.exposeInt("sessionOf"),
    titleBn: t.exposeString("titleBn"),
    finished: t.exposeBoolean("finished"),
  }),
});

const MissedLessonRef = builder.objectRef<MissedLesson>("MissedLesson").implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    subject: t.exposeString("subject"),
    sessions: t.field({ type: [MissedSessionRef], resolve: (m) => m.sessions }),
    noteBn: t.string({ nullable: true, resolve: (m) => m.noteBn }),
    onLeave: t.exposeBoolean("onLeave"),
  }),
});

const MissedLessonPageRef = pageRef("MissedLessonPage", MissedLessonRef);

builder.queryField("childMissedLessonsPage", (t) =>
  t.field({
    type: MissedLessonPageRef,
    description:
      "LP-4 (D-#828): the classes this academic year where the linked child was listed absent while a lesson-plan session " +
      "was taught — subject, the session(s) and the teacher's class-note text, newest first. Link-gated.",
    authScopes: { hasPermission: "guardian:read_child" },
    args: { studentId: t.arg.string({ required: true }), page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: async (_r, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return childMissedLessonsPage(args.studentId, { page: args.page, pageSize: args.pageSize });
    },
  }),
);
