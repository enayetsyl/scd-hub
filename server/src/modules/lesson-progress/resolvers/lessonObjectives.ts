/**
 * OT-5 resolvers (docs/prd-objective-tree.md §8.3, D-#949–#951): objective codes on taught lessons.
 *
 *   lessonObjectiveStatus — lesson_progress:view / view_all + the tracker's row rule (D-#826): one
 *                           শাখা × subject per objective row — taught on / not yet, absent that day.
 *
 * The refs are shared: `LessonPlanForSlot.objectives` (lessonDelivery.ts, the class-note card) and
 * the mastery trail / student fields (masteryDiagnosis.ts) ride their own gates.
 */
import { Types } from "mongoose";
import { builder } from "../../../schema";
import { LessonProgressError } from "../services/LessonDeliveryService";
import { assertMayViewSection } from "../services/LessonProgressService";
import {
  sectionObjectiveRows,
  type ObjectiveDay,
  type SectionObjectiveRow,
  type StudentObjectiveLesson,
} from "../services/ObjectiveLessonService";

const AbsentStudentRef = builder.objectRef<ObjectiveDay["absent"][number]>("LessonObjectiveAbsentStudent").implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
  }),
});

const ObjectiveDayRef = builder.objectRef<ObjectiveDay>("LessonObjectiveDay").implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    attendanceTaken: t.exposeBoolean("attendanceTaken"),
    absent: t.field({ type: [AbsentStudentRef], resolve: (d) => d.absent }),
  }),
});

const ObjectiveSessionRef = builder.objectRef<SectionObjectiveRow["sessions"][number]>("LessonObjectiveSession").implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    chapter: t.exposeString("chapter"),
    anchorWord: t.exposeString("anchorWord"),
    sessionIndex: t.exposeInt("sessionIndex"),
    sessionOf: t.exposeInt("sessionOf"),
    titleBn: t.exposeString("titleBn"),
  }),
});

export const SectionObjectiveRowRef = builder.objectRef<SectionObjectiveRow>("LessonObjectiveRow").implement({
  description: "OT-5: one objective row of a শাখা × subject — the plan sessions that teach it, the days it was taught, who was absent.",
  fields: (t) => ({
    code: t.exposeString("code"),
    labelBn: t.string({ nullable: true, resolve: (r) => r.labelBn }),
    chapterNumber: t.int({ nullable: true, resolve: (r) => r.chapterNumber }),
    inCatalogue: t.exposeBoolean("inCatalogue"),
    sessions: t.field({ type: [ObjectiveSessionRef], resolve: (r) => r.sessions }),
    /** [] = not taught yet in this শাখা. */
    taught: t.field({ type: [ObjectiveDayRef], resolve: (r) => r.taught }),
    absentCount: t.exposeInt("absentCount"),
  }),
});

export const StudentObjectiveLessonRef = builder.objectRef<StudentObjectiveLesson>("StudentObjectiveLesson").implement({
  description:
    "OT-5 (D-#950): was this objective taught in the child's শাখা, and was the child there? " +
    "status TAUGHT | MISSED (absent on a day it was taught) | UNKNOWN (no attendance those days) | NOT_TAUGHT.",
  fields: (t) => ({
    loCode: t.exposeString("loCode"),
    status: t.exposeString("status"),
    taughtOn: t.exposeStringList("taughtOn"),
    absentOn: t.exposeStringList("absentOn"),
    onLeave: t.exposeBoolean("onLeave"),
  }),
});

builder.queryField("lessonObjectiveStatus", (t) =>
  t.field({
    type: [SectionObjectiveRowRef],
    description:
      "OT-5 (prd-objective-tree §8.3): one শাখা × subject per objective row (plan codes + tagged catalogue rows) — " +
      "taught on which days or not yet, and who on that day's roster was absent. Same row rule as the tracker.",
    authScopes: { hasAnyPermission: ["lesson_progress:view", "lesson_progress:view_all"] },
    args: { sectionId: t.arg.string({ required: true }), subject: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => {
      if (!Types.ObjectId.isValid(args.sectionId)) throw new LessonProgressError("শাখা পাওয়া যায়নি।");
      await assertMayViewSection(ctx.auth!, args.sectionId, args.subject);
      return sectionObjectiveRows(args.sectionId, args.subject);
    },
  }),
);
