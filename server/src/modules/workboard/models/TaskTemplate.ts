import { Schema, model, Document, Types } from "mongoose";
import type { DaySlot, TaskPriority, TaskRecurrence } from "@scd/shared";
import { DAY_SLOTS, TASK_PRIORITIES, TASK_RECURRENCES } from "@scd/shared";

/**
 * TaskTemplate (WB-2, D-#701) — a RECURRING manual task. The notification
 * scheduler (the one 60-second ticker, no second scheduler) materialises one
 * `Task` per matching SCHOOL day, behind the same OFF/HOLIDAY gate as the
 * class-note prompts, so "daily cash entry" is never created on a holiday and
 * never typed twice.
 *
 *   SCHOOL_DAYS — every school day
 *   WEEKLY      — school days whose weekday is in `weekdays` (0 = Sunday … 6)
 *   MONTHLY     — the school day whose date-of-month is `monthDay`; a `monthDay`
 *                 past the month's end clamps to the last day (31 = month end)
 *   MONTHLY_WEEKDAY — the `weekOfMonth`-th (1..4, 5 = last) `weekdays[0]` of the
 *                 month, e.g. the first Saturday (owner ask 2026-09-30). If that day
 *                 is a holiday the instance is simply not created that month.
 *
 * A template is deactivated, never deleted — its past tasks keep pointing at it.
 */
export interface ITaskTemplate extends Document {
  _id: Types.ObjectId;
  titleBn: string;
  notes?: string;
  assigneeUserId: Types.ObjectId;
  createdBy: Types.ObjectId;
  forLabel?: string;
  priority: TaskPriority;
  slot: DaySlot;
  effortMin: number;
  recurrence: TaskRecurrence;
  weekdays: number[];
  monthDay?: number;
  /** MONTHLY_WEEKDAY only: 1..4, or 5 = the last such weekday of the month. */
  weekOfMonth?: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TaskTemplateSchema = new Schema<ITaskTemplate>(
  {
    titleBn: { type: String, required: true, trim: true, maxlength: 200 },
    notes: { type: String, trim: true, maxlength: 2000 },
    assigneeUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    forLabel: { type: String, trim: true, maxlength: 120 },
    priority: { type: String, enum: TASK_PRIORITIES, required: true, default: "NORMAL" },
    slot: { type: String, enum: DAY_SLOTS, required: true, default: "ANY" },
    effortMin: { type: Number, required: true, min: 5, max: 480 },
    recurrence: { type: String, enum: TASK_RECURRENCES, required: true },
    weekdays: { type: [Number], default: [] },
    monthDay: { type: Number, min: 1, max: 31 },
    weekOfMonth: { type: Number, min: 1, max: 5 },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

TaskTemplateSchema.index({ active: 1, assigneeUserId: 1 });

export const TaskTemplate = model<ITaskTemplate>("TaskTemplate", TaskTemplateSchema);
