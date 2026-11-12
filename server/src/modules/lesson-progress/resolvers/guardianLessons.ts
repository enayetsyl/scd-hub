/**
 * Lesson-plan progress LP-4 guardian resolver (D-#828) + GH-4 (D-#1528): the lessons a linked child
 * missed this academic year, paged (D-#761), each with the class note, the homework and the loaded
 * home guide; and the Principal's home-guide import. The list is guardian:read_child + the guardian
 * link (assertGuardianOfStudent); the import is home_guide:import.
 */
import { callerHasPermission } from "@scd/shared";
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import { assertGuardianOfStudent, ForbiddenError } from "../../../middleware/authz";
import { writeAudit } from "../../platform/services/AuditService";
import { isLessonPlanQuestionOn } from "../services/LessonPlanQuestionSwitch";
import { childMissedLessonsPage, type MissedHomework, type MissedLesson } from "../services/GuardianLessonService";
import { importSessionHomeGuides, type HomeGuideImportResult, type SessionHomeGuideView } from "../services/HomeGuideService";

const ClassworkItemRef = builder.objectRef<SessionHomeGuideView["classworkItems"][number]>("HomeGuideClassworkItem").implement({
  fields: (t) => ({
    label: t.exposeString("label"),
    textBn: t.exposeString("textBn"),
  }),
});

const HomeGuideRef = builder.objectRef<SessionHomeGuideView>("SessionHomeGuideView").implement({
  fields: (t) => ({
    steps: t.exposeStringList("steps"),
    classworkItems: t.field({ type: [ClassworkItemRef], resolve: (g) => g.classworkItems }),
    homeTimeMin: t.exposeInt("homeTimeMin"),
  }),
});

const MissedSessionRef = builder.objectRef<MissedLesson["sessions"][number]>("MissedLessonSession").implement({
  fields: (t) => ({
    chapter: t.exposeString("chapter"),
    anchorWord: t.exposeString("anchorWord"),
    sessionIndex: t.exposeInt("sessionIndex"),
    sessionOf: t.exposeInt("sessionOf"),
    titleBn: t.exposeString("titleBn"),
    finished: t.exposeBoolean("finished"),
    guide: t.field({ type: HomeGuideRef, nullable: true, resolve: (s) => s.guide }),
  }),
});

const MissedHomeworkRef = builder.objectRef<MissedHomework>("MissedLessonHomework").implement({
  fields: (t) => ({
    description: t.string({ nullable: true, resolve: (h) => h.description }),
    qCount: t.exposeInt("qCount"),
    timeDecl: t.exposeInt("timeDecl"),
  }),
});

const MissedLessonRef = builder.objectRef<MissedLesson>("MissedLesson").implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    subject: t.exposeString("subject"),
    sessions: t.field({ type: [MissedSessionRef], resolve: (m) => m.sessions }),
    noteBn: t.string({ nullable: true, resolve: (m) => m.noteBn }),
    homework: t.field({ type: MissedHomeworkRef, nullable: true, resolve: (m) => m.homework }),
    onLeave: t.exposeBoolean("onLeave"),
  }),
});

const MissedLessonPageRef = pageRef("MissedLessonPage", MissedLessonRef);

builder.queryField("childMissedLessonsPage", (t) =>
  t.field({
    type: MissedLessonPageRef,
    description:
      "LP-4 (D-#828) + GH-4 (D-#1528): the classes this academic year where the linked child was listed absent while a " +
      "lesson-plan session was taught — subject, the session(s), the teacher's class-note text, the linked homework and " +
      "each session's home guide (steps + classwork items) when one is loaded; newest first. Link-gated.",
    authScopes: { hasPermission: "guardian:read_child" },
    args: { studentId: t.arg.string({ required: true }), page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: async (_r, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return childMissedLessonsPage(args.studentId, { page: args.page, pageSize: args.pageSize });
    },
  }),
);

builder.queryField("lessonProgressOn", (t) =>
  t.boolean({
    description:
      "GH-4 (D-#1528): the school's lesson-progress switch (D-#952, default OFF) for guardians, so the missed-lessons entry points show only once the school uses lesson plans.",
    authScopes: { hasPermission: "guardian:read_child" },
    resolve: () => isLessonPlanQuestionOn(),
  }),
);

const HomeGuideImportRef = builder.objectRef<HomeGuideImportResult>("HomeGuideImportResult").implement({
  fields: (t) => ({
    dryRun: t.exposeBoolean("dryRun"),
    total: t.exposeInt("total"),
    created: t.exposeInt("created"),
    updated: t.exposeInt("updated"),
    unchanged: t.exposeInt("unchanged"),
    errors: t.exposeStringList("errors"),
  }),
});

builder.mutationField("importSessionHomeGuides", (t) =>
  t.field({
    type: HomeGuideImportRef,
    description:
      "GH-4 (D-#1528): load a plan pack's session home guides ({ guides: [...] }). Requires home_guide:import (Principal). " +
      "dryRun defaults to TRUE and writes nothing; a file with any problem writes nothing either way.",
    authScopes: { hasPermission: "home_guide:import" },
    args: { json: t.arg.string({ required: true }), dryRun: t.arg.boolean({ required: false }) },
    resolve: async (_r, args, ctx) => {
      if (!ctx.auth || !callerHasPermission(ctx.auth, "home_guide:import")) throw new ForbiddenError();
      const dryRun = args.dryRun !== false;
      const res = await importSessionHomeGuides(args.json, ctx.auth.userId, { dryRun });
      if (!dryRun && res.errors.length === 0) {
        await writeAudit({
          eventKind: "HOME_GUIDES_IMPORTED",
          actorId: ctx.auth.userId,
          targetKind: "SessionHomeGuide",
          meta: { total: res.total, created: res.created, updated: res.updated, unchanged: res.unchanged },
        });
      }
      return res;
    },
  }),
);
