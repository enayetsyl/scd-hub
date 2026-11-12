/**
 * PR-D (docs/prd-mastery-homework-from-lesson.md, D-#1321–#1326) — homework from the lesson taught,
 * and extra homework for weak children. Reuses the existing mastery actions (no new permission):
 *
 *   masteryHomeworkDraft          — mastery:create; no write — the class homework from that day's lesson
 *   masteryExtraHomeworkPreview   — mastery:create; no write — per child, up to N unseen gold questions
 *   createMasteryExtraHomework    — mastery:create; re-checks, then one OPEN extra sheet + record rows
 *   masterySectionSwitch          — mastery:view; is the add-on on for a section × subject this year (+ class level)
 *
 * Row rule (routine holder or mastery:edit_all) and the switch are checked in the service.
 */
import { builder } from "../../../schema";
import type { MasterySubject } from "@scd/shared";
import {
  createExtraHomework,
  extraHomeworkPreview,
  homeworkDraft,
  type DraftItem,
  type ExtraItem,
  type ExtraStudent,
  type HomeworkDraft,
} from "../services/MasteryHomeworkService";
import { sectionContext, type Auth } from "../services/MasteryWorkService";
import { Class } from "../../foundation/models/Class";
import { isMasteryEnabled } from "../services/MasteryCatalogueService";
import { PaperRef } from "./masteryWork";

function authOf(ctx: { auth: Auth | null }): Auth {
  if (!ctx.auth) throw new Error("লগইন প্রয়োজন।");
  return ctx.auth;
}

const DraftItemRef = builder.objectRef<DraftItem>("MasteryHomeworkDraftItem");
DraftItemRef.implement({
  fields: (t) => ({
    origin: t.exposeString("origin"),
    artifactId: t.string({ nullable: true, resolve: (i) => i.artifactId }),
    qid: t.string({ nullable: true, resolve: (i) => i.qid }),
    textBn: t.string({ nullable: true, resolve: (i) => i.textBn }),
    loCode: t.exposeString("loCode"),
    questionTypeCode: t.exposeString("questionTypeCode"),
    marks: t.exposeFloat("marks"),
    fromBook: t.exposeBoolean("fromBook"),
  }),
});

const DraftRef = builder.objectRef<HomeworkDraft>("MasteryHomeworkDraft");
DraftRef.implement({
  fields: (t) => ({
    reason: t.string({ nullable: true, description: "NO_LESSON_MARKED / NO_CODES_ON_PLAN when there is nothing to propose.", resolve: (d) => d.reason }),
    items: t.field({ type: [DraftItemRef], resolve: (d) => d.items }),
    rubricCodes: t.exposeStringList("rubricCodes"),
    gaps: t.exposeStringList("gaps"),
    leftOut: t.exposeStringList("leftOut"),
    hwItemId: t.string({ nullable: true, resolve: (d) => d.hwItemId }),
  }),
});

const ExtraItemRef = builder.objectRef<ExtraItem>("MasteryExtraHomeworkItem");
ExtraItemRef.implement({
  fields: (t) => ({
    artifactId: t.exposeString("artifactId"),
    qid: t.exposeString("qid"),
    textBn: t.string({ nullable: true, resolve: (i) => i.textBn }),
    loCode: t.exposeString("loCode"),
    labelBn: t.exposeString("labelBn"),
    questionTypeCode: t.exposeString("questionTypeCode"),
    marks: t.exposeFloat("marks"),
    reasonBn: t.exposeString("reasonBn"),
  }),
});

const ExtraStudentRef = builder.objectRef<ExtraStudent>("MasteryExtraHomeworkStudent");
ExtraStudentRef.implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    rollNumber: t.string({ nullable: true, resolve: (s) => s.rollNumber }),
    items: t.field({ type: [ExtraItemRef], resolve: (s) => s.items }),
    cause: t.string({ nullable: true, description: "NOT_WEAK / NO_UNSEEN_QUESTION when there is nothing to give.", resolve: (s) => s.cause }),
  }),
});

const SwitchRef = builder.objectRef<{ enabled: boolean; classLevel: number | null }>("MasterySectionSwitch");
SwitchRef.implement({
  fields: (t) => ({
    enabled: t.exposeBoolean("enabled"),
    classLevel: t.int({ nullable: true, resolve: (s) => s.classLevel }),
  }),
});

const ExtraItemInput = builder.inputType("MasteryExtraHomeworkItemInput", {
  fields: (t) => ({ artifactId: t.string({ required: true }), loCode: t.string({ required: true }) }),
});
const ExtraSheetInput = builder.inputType("MasteryExtraHomeworkSheetInput", {
  fields: (t) => ({
    studentId: t.string({ required: true }),
    items: t.field({ type: [ExtraItemInput], required: true }),
  }),
});

builder.queryFields((t) => ({
  masteryHomeworkDraft: t.field({
    type: DraftRef,
    description:
      "PR-D (D-#1321): the class homework drafted from the session plans marked taught that day (no write). Bank questions " +
      "nobody in the section has seen; the book's exercises when the bank has none; gaps / leftOut / rubricCodes named.",
    authScopes: { hasPermission: "mastery:create" },
    args: {
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      dateKey: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) => homeworkDraft(args.sectionId, args.subject as MasterySubject, args.dateKey, authOf(ctx)),
  }),

  masteryExtraHomeworkPreview: t.field({
    type: [ExtraStudentRef],
    description:
      "PR-D (D-#1322): per roster child with a WEAK (or, by policy, IMPROVING) row, up to the policy's number of unseen gold " +
      "questions, oldest weak row first, each with a one-line reason; children with nothing to give carry a cause. One section's roster.",
    authScopes: { hasPermission: "mastery:create" },
    args: { sectionId: t.arg.string({ required: true }), subject: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => extraHomeworkPreview(args.sectionId, args.subject as MasterySubject, authOf(ctx)),
  }),

  masterySectionSwitch: t.field({
    type: SwitchRef,
    description: "PR-D: is the mastery add-on switched on for this section's class × subject this year, and the class level (the class-note link). No student data.",
    authScopes: { hasPermission: "mastery:view" },
    args: { sectionId: t.arg.string({ required: true }), subject: t.arg.string({ required: true }) },
    resolve: async (_r, args) => {
      const ctx = await sectionContext(args.sectionId).catch(() => null);
      if (!ctx) return { enabled: false, classLevel: null };
      const cls = await Class.findById(ctx.classId).select("level").lean();
      return {
        enabled: await isMasteryEnabled(ctx.academicYearId, ctx.classToken, args.subject as MasterySubject),
        classLevel: (cls?.level as number | undefined) ?? null,
      };
    },
  }),
}));

builder.mutationFields((t) => ({
  createMasteryExtraHomework: t.field({
    type: PaperRef,
    description:
      "PR-D (D-#1323): one OPEN extra-homework sheet (source HW, per-child items, title \"বাড়তি বাড়ির কাজ\") after re-checking " +
      "every item (gold, tagged with that code, unseen by that child, row still WEAK / IMPROVING). One per section × subject × date.",
    authScopes: { hasPermission: "mastery:create" },
    args: {
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
      sheets: t.arg({ type: [ExtraSheetInput], required: true }),
    },
    resolve: async (_r, args, ctx) =>
      createExtraHomework(
        {
          sectionId: args.sectionId,
          subject: args.subject as MasterySubject,
          date: args.date,
          sheets: args.sheets.map((s) => ({ studentId: s.studentId, items: s.items.map((i) => ({ artifactId: i.artifactId, loCode: i.loCode })) })),
        },
        authOf(ctx),
      ),
  }),
}));
