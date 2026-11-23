/**
 * AL-11 (D-#1675) resolvers: the Office's term target dates. Reading the board and saving both need
 * `lesson_progress:set_targets` (AC-A4 — a teacher's call is refused); the on-track read itself rides on the
 * existing lesson-progress rows. Not behind the 2027 switch (§3.6).
 */
import { builder } from "../../../schema";
import {
  setSyllabusTargets,
  syllabusTargetBoard,
  type SetTargetsResult,
  targetYears,
  type TargetBoardRow,
  type TargetYear,
  type TargetView,
} from "../services/SyllabusTargetService";
import type { PlanSession } from "../services/LessonDeliveryService";

const PlanSessionRef = builder.objectRef<PlanSession>("SyllabusPlanSession").implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    chapter: t.exposeString("chapter"),
    chapterTitle: t.string({ nullable: true, resolve: (s) => s.chapterTitle }),
    sessionIndex: t.exposeInt("sessionIndex"),
    sessionOf: t.exposeInt("sessionOf"),
    titleBn: t.exposeString("titleBn"),
  }),
});

const TargetViewRef = builder.objectRef<TargetView>("SyllabusTargetView").implement({
  fields: (t) => ({
    term: t.exposeString("term"),
    targetDate: t.exposeString("targetDate"),
    endChapter: t.exposeString("endChapter"),
    endSessionIndex: t.exposeInt("endSessionIndex"),
    endKey: t.exposeString("endKey"),
  }),
});

const BoardRowRef = builder.objectRef<TargetBoardRow>("SyllabusTargetBoardRow").implement({
  fields: (t) => ({
    subject: t.exposeString("subject"),
    sessions: t.field({ type: [PlanSessionRef], resolve: (r) => r.sessions }),
    halfYearly: t.field({ type: TargetViewRef, nullable: true, resolve: (r) => r.halfYearly }),
    annual: t.field({ type: TargetViewRef, nullable: true, resolve: (r) => r.annual }),
  }),
});

const TargetInputRef = builder.inputType("SyllabusTargetInput", {
  fields: (t) => ({
    classLevel: t.int({ required: true }),
    subject: t.string({ required: true }),
    /** HALF_YEARLY | ANNUAL */
    term: t.string({ required: true }),
    /** Empty / null clears this term's target. */
    targetDate: t.string({ required: false }),
    endChapter: t.string({ required: false }),
    endSessionIndex: t.int({ required: false }),
  }),
});

const YearRef = builder.objectRef<TargetYear>("SyllabusTargetYear").implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    label: t.exposeString("label"),
    current: t.exposeBoolean("current"),
    startKey: t.exposeString("startKey"),
    endKey: t.exposeString("endKey"),
  }),
});

const SetResultRef = builder.objectRef<SetTargetsResult>("SetSyllabusTargetsResult").implement({
  fields: (t) => ({
    saved: t.exposeInt("saved"),
    cleared: t.exposeInt("cleared"),
  }),
});

builder.queryField("syllabusTargetYears", (t) =>
  t.field({
    type: [YearRef],
    description: "AL-11: the years targets may be set for — the current one, and the prepared next one when it exists.",
    authScopes: { hasPermission: "lesson_progress:set_targets" },
    resolve: () => targetYears(),
  }),
);

builder.queryField("syllabusTargetBoard", (t) =>
  t.field({
    type: [BoardRowRef],
    description: "AL-11 (D-#1675): one class level's plan subjects with their sessions (book order) and the saved half-yearly / annual targets.",
    authScopes: { hasPermission: "lesson_progress:set_targets" },
    args: { classLevel: t.arg.int({ required: true }), academicYearId: t.arg.string({ required: false }) },
    resolve: (_r, args) => syllabusTargetBoard(args.classLevel, args.academicYearId),
  }),
);

builder.mutationField("setSyllabusTargets", (t) =>
  t.field({
    type: SetResultRef,
    description:
      "AL-11 (D-#1675): save or clear term targets per class × subject × term (HALF_YEARLY needs an end session; ANNUAL defaults to the last). All-or-nothing validation.",
    authScopes: { hasPermission: "lesson_progress:set_targets" },
    args: { inputs: t.arg({ type: [TargetInputRef], required: true }), academicYearId: t.arg.string({ required: false }) },
    resolve: (_r, args, ctx) => setSyllabusTargets(args.inputs, ctx.auth!.userId, args.academicYearId),
  }),
);
