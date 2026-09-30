import { Schema, model, Document, Types } from "mongoose";
import type { DaySlot, TaskPriority, TaskStatus } from "@scd/shared";
import { DAY_SLOTS, TASK_PRIORITIES, TASK_STATUSES } from "@scd/shared";

/**
 * Task (WB-1, D-#701) — ONE manual card on someone's work board.
 *
 * The board shows two kinds of card. This row is the MANUAL kind: a person typed
 * it (for themselves, or — holding `tasks:assign` — for a colleague). The AUTO
 * kind (a routine period, homework awaiting checking, class-test marks, a print
 * job…) is NEVER stored here: it is a projection over the source module's own
 * record (WorkBoardService), so it can never drift from what that module knows.
 *
 * Three statuses, no fourth: "blocked" is a FLAG with a reason on an open task
 * (owner ruling 2026-09-30), so a stuck task stays in its column and the
 * assigner is told why. `cancelledAt` hides a task the assigner withdrew; rows are
 * never deleted (the audit log names the task by id).
 *
 * `templateId` + `dueKey` are unique together: the scheduler materialises a
 * recurring task once per school day and a retried tick is a no-op. Manual tasks
 * carry no `templateId` and sit outside that index (see below).
 *
 * Identity plane (names people) — no corpus path (ADR-005).
 */
export interface ITask extends Document {
  _id: Types.ObjectId;
  titleBn: string;
  notes?: string;
  assigneeUserId: Types.ObjectId;
  assignedBy: Types.ObjectId;
  /** "On behalf of" — work done FOR a support-staff member who has no login
   *  (Khala, Pion); the card sits on the office assistant's board. */
  forLabel?: string;
  priority: TaskPriority;
  /** Local date key YYYY-MM-DD (the attendance convention). */
  dueKey: string;
  slot: DaySlot;
  /** Typed by the assigner — the ONE effort the load grid cannot derive. */
  effortMin: number;
  status: TaskStatus;
  blockedReason?: string;
  blockedAt?: Date;
  startedAt?: Date;
  doneAt?: Date;
  doneBy?: Types.ObjectId;
  cancelledAt?: Date;
  cancelledBy?: Types.ObjectId;
  templateId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>(
  {
    titleBn: { type: String, required: true, trim: true, maxlength: 200 },
    notes: { type: String, trim: true, maxlength: 2000 },
    assigneeUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    forLabel: { type: String, trim: true, maxlength: 120 },
    priority: { type: String, enum: TASK_PRIORITIES, required: true, default: "NORMAL" },
    dueKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    slot: { type: String, enum: DAY_SLOTS, required: true, default: "ANY" },
    effortMin: { type: Number, required: true, min: 5, max: 480 },
    status: { type: String, enum: TASK_STATUSES, required: true, default: "TODO" },
    blockedReason: { type: String, trim: true, maxlength: 500 },
    blockedAt: { type: Date },
    startedAt: { type: Date },
    doneAt: { type: Date },
    doneBy: { type: Schema.Types.ObjectId, ref: "User" },
    cancelledAt: { type: Date },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User" },
    templateId: { type: Schema.Types.ObjectId, ref: "TaskTemplate" },
  },
  { timestamps: true },
);

// My board: one person's open work, by day.
TaskSchema.index({ assigneeUserId: 1, status: 1, dueKey: 1 });
// "আমার দেওয়া কাজ": what I put on other people's boards.
TaskSchema.index({ assignedBy: 1, status: 1, dueKey: -1 });
// One materialised task per template per day (the retried-tick guard). PARTIAL, not
// sparse: a compound sparse index still indexes a row that has ANY of its keys, and
// every row has `dueKey` — so manual tasks (no templateId) all shared the
// (null, dueKey) slot and only ONE manual task per date could exist school-wide.
TaskSchema.index(
  { templateId: 1, dueKey: 1 },
  { unique: true, partialFilterExpression: { templateId: { $type: "objectId" } } },
);

export const Task = model<ITask>("Task", TaskSchema);
