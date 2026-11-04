/**
 * The class note's lesson-plan question switch (D-#952). OFF unless the Principal (or whoever
 * holds `routine:settings`) turns it on; a missing config row is OFF (prod has none).
 *
 * Read by `lessonPlanForSlot` (OFF → `applies: false`, so every app build — old bundles with
 * LP-1 included — hides the block and sends no answer) and by `prepareDelivery` (OFF → the
 * answer is ignored, so publish / edit never require or write a LessonDelivery). Existing
 * LessonDelivery rows stay readable either way.
 */
import { Types } from "mongoose";
import { LessonProgressConfig } from "../models/LessonProgressConfig";

export interface LessonPlanQuestionSetting {
  on: boolean;
  updatedAt: Date | null;
}

export async function lessonPlanQuestionSetting(): Promise<LessonPlanQuestionSetting> {
  const row = (await LessonProgressConfig.findOne({ key: "SINGLETON" })
    .select("classNoteQuestionOn updatedAt")
    .lean()) as unknown as { classNoteQuestionOn?: boolean; updatedAt?: Date } | null;
  return { on: row?.classNoteQuestionOn === true, updatedAt: row?.updatedAt ?? null };
}

export async function isLessonPlanQuestionOn(): Promise<boolean> {
  return (await lessonPlanQuestionSetting()).on;
}

export async function setLessonPlanQuestionOn(on: boolean, actorId: string): Promise<LessonPlanQuestionSetting> {
  await LessonProgressConfig.findOneAndUpdate(
    { key: "SINGLETON" },
    { $set: { classNoteQuestionOn: on, updatedBy: new Types.ObjectId(actorId) } },
    { upsert: true },
  );
  return lessonPlanQuestionSetting();
}
