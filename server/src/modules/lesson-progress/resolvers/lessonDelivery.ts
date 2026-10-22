/**
 * Lesson-plan progress LP-1 resolvers (D-#820–#822). Marking rides the class-note mutations
 * (`publishClassNote` / `updateClassNote` take `lessonPlan`, see routineTriggers.ts); this file
 * holds the card's read and the shared types.
 */
import { callerHasPermission } from "@scd/shared";
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { ClassNote } from "../../routine/models/ClassNote";
import { RoutineSlot, type IRoutineSlot } from "../../routine/models/RoutineSlot";
import { resolveNoteAuthorization } from "../../routine/services/RoutineTriggerService";
import {
  lessonPlanForSlot,
  type LessonDeliveryView,
  type LessonPlanForSlot,
  type LessonPlanSessionView,
} from "../services/LessonDeliveryService";

const LessonPlanSessionRef = builder.objectRef<LessonPlanSessionView>("LessonPlanSession").implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    chapter: t.exposeString("chapter"),
    anchorWord: t.exposeString("anchorWord"),
    chapterTitle: t.string({ nullable: true, resolve: (s) => s.chapterTitle }),
    sessionIndex: t.exposeInt("sessionIndex"),
    sessionOf: t.exposeInt("sessionOf"),
    titleBn: t.exposeString("titleBn"),
    artifactId: t.exposeString("artifactId"),
    finishedOn: t.exposeStringList("finishedOn"),
    startedOn: t.exposeStringList("startedOn"),
  }),
});

type DeliverySessionView = LessonDeliveryView["sessions"][number];
const LessonDeliverySessionRef = builder.objectRef<DeliverySessionView>("LessonDeliverySession").implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    chapter: t.exposeString("chapter"),
    anchorWord: t.exposeString("anchorWord"),
    sessionIndex: t.exposeInt("sessionIndex"),
    sessionOf: t.exposeInt("sessionOf"),
    titleBn: t.exposeString("titleBn"),
    finished: t.exposeBoolean("finished"),
  }),
});

export const LessonDeliveryRef = builder.objectRef<LessonDeliveryView>("LessonDelivery").implement({
  fields: (t) => ({
    noteId: t.exposeString("noteId"),
    dateKey: t.exposeString("dateKey"),
    sessions: t.field({ type: [LessonDeliverySessionRef], resolve: (d) => d.sessions }),
    noneReason: t.string({ nullable: true, resolve: (d) => d.noneReason }),
    noneNote: t.string({ nullable: true, resolve: (d) => d.noneNote }),
  }),
});

const LessonPlanForSlotRef = builder.objectRef<LessonPlanForSlot>("LessonPlanForSlot").implement({
  fields: (t) => ({
    applies: t.exposeBoolean("applies"),
    sessions: t.field({ type: [LessonPlanSessionRef], resolve: (p) => p.sessions }),
    suggestedKey: t.string({ nullable: true, resolve: (p) => p.suggestedKey }),
    delivery: t.field({ type: LessonDeliveryRef, nullable: true, resolve: (p) => p.delivery }),
  }),
});

const LessonPlanSessionInput = builder.inputType("LessonPlanSessionInput", {
  fields: (t) => ({
    key: t.string({ required: true }),
    finished: t.boolean({ required: true }),
  }),
});

/** The class note's lesson-plan answer: sessions, OR a reason (D-#821). */
export const LessonPlanInputRef = builder.inputType("LessonPlanInput", {
  fields: (t) => ({
    sessions: t.field({ type: [LessonPlanSessionInput], required: false }),
    noneReason: t.string({ required: false }),
    noneNote: t.string({ required: false }),
  }),
});

function parseDate(s: string): Date {
  const d = new Date(s);
  if (isNaN(d.getTime())) throw new Error("Invalid date");
  return d;
}

/** Slot teacher / cover / class_note:edit_all — or the author of that day's note (the archive edit path). */
async function assertMayMarkSlot(ctx: AppContext, slotId: string, date: Date): Promise<IRoutineSlot> {
  const canManage = callerHasPermission(ctx.auth!, "class_note:edit_all");
  try {
    return await resolveNoteAuthorization({ slotId, date, actorId: ctx.auth!.userId, canManage });
  } catch (e) {
    if (!(e instanceof ForbiddenError)) throw e;
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000 - 1);
    const own = await ClassNote.exists({ slotId, date: { $gte: dayStart, $lte: dayEnd }, publishedBy: ctx.auth!.userId });
    if (!own) throw e;
    return (await RoutineSlot.findById(slotId).lean()) as unknown as IRoutineSlot;
  }
}

builder.queryField("lessonPlanForSlot", (t) =>
  t.field({
    type: LessonPlanForSlotRef,
    description:
      "LP-1 (D-#820): the class × subject's session plans in book order with this শাখা's progress, the suggested " +
      "next session and this slot × date's own marks. `applies: false` = no lesson plan, no answer needed.",
    authScopes: { hasAnyPermission: ["class_note:create", "class_note:edit", "class_note:edit_all"] },
    args: { slotId: t.arg.string({ required: true }), date: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => {
      const date = parseDate(args.date);
      const slot = await assertMayMarkSlot(ctx, args.slotId, date);
      return lessonPlanForSlot(slot, date);
    },
  }),
);
