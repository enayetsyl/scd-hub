/**
 * Work-board resolvers (WB-1..WB-3, D-#701).
 *
 * RBAC:
 *   authenticated (any staff)  — my board, my counts, tasks for myself, my templates,
 *                                status/block on my own cards
 *   tasks:assign               — anyone's board, the load grid, the staff picker,
 *                                tasks/templates for OTHER people, move/reassign/cancel
 * Every gate is re-checked in the service (the resolver's `authScopes` is the
 * declarative half; TaskService holds the row rules). Identity plane only.
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission, DAY_SLOTS, TASK_PRIORITIES, TASK_RECURRENCES, TASK_STATUSES } from "@scd/shared";
import type { DaySlot, TaskPriority, TaskRecurrence, TaskStatus } from "@scd/shared";
import type { AppContext } from "../../../context";
import { dateKeyOf, isValidDateKey } from "../../attendance/dates";
import { User } from "../../foundation/models/User";
import type { ITask } from "../models/Task";
import type { ITaskTemplate } from "../models/TaskTemplate";
import {
  assertCanReadTask,
  cancelTask,
  createTask,
  moveTask,
  reassignTask,
  setTaskBlocked,
  setTaskStatus,
  taskById,
  tasksAssignedBy,
  updateTask,
} from "../services/TaskService";
import { createTaskTemplate, listTaskTemplates, setTaskTemplateActive } from "../services/TaskTemplateService";
import {
  allStaffUsers,
  boardCountsFor,
  boardFor,
  categoriesFor,
  loadBoardUsers,
  type WorkBoardCounts,
  type WorkCard,
  type WorkCardLink,
} from "../services/WorkBoardService";
import { loadGrid, type LoadCell, type LoadRow } from "../services/LoadService";
import { loadLevelFor, type HrCategory } from "@scd/shared";

// ---------------------------------------------------------------------------
// Gates + helpers
// ---------------------------------------------------------------------------

function requireAuth(ctx: AppContext) {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return ctx.auth;
}

function assertAssigner(ctx: AppContext): void {
  const auth = requireAuth(ctx);
  if (!callerHasPermission(auth, "tasks:assign")) throw new ForbiddenError("অন্যের বোর্ড দেখার অনুমতি নেই");
}

function assertKeys(fromKey: string, toKey: string): void {
  if (!isValidDateKey(fromKey) || !isValidDateKey(toKey) || fromKey > toKey) throw new Error("তারিখের সীমা সঠিক নয়");
}

const TaskStatusEnum = builder.enumType("TaskStatus", { values: TASK_STATUSES });
const TaskPriorityEnum = builder.enumType("TaskPriority", { values: TASK_PRIORITIES });
const DaySlotEnum = builder.enumType("DaySlot", { values: DAY_SLOTS });
const TaskRecurrenceEnum = builder.enumType("TaskRecurrence", { values: TASK_RECURRENCES });

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

interface TaskView {
  doc: ITask;
  assigneeName: string | null;
  assignedByName: string | null;
}

async function decorate(docs: ITask[]): Promise<TaskView[]> {
  if (docs.length === 0) return [];
  const ids = [...new Set(docs.flatMap((d) => [d.assigneeUserId.toString(), d.assignedBy.toString()]))];
  const users = await User.find({ _id: { $in: ids } }).select("name").lean();
  const name = new Map(users.map((u) => [u._id.toString(), u.name]));
  return docs.map((doc) => ({
    doc,
    assigneeName: name.get(doc.assigneeUserId.toString()) ?? null,
    assignedByName: name.get(doc.assignedBy.toString()) ?? null,
  }));
}
const decorateOne = async (doc: ITask): Promise<TaskView> => (await decorate([doc]))[0];

const iso = (d?: Date | null): string | null => (d ? new Date(d).toISOString() : null);

const TaskRef = builder.objectRef<TaskView>("Task");
TaskRef.implement({
  description: "A manual work-board task (WB-1, D-#701). Statuses TODO → DOING → DONE; blocked is a flag with a reason.",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.doc._id.toString() }),
    titleBn: t.string({ resolve: (v) => v.doc.titleBn }),
    notes: t.string({ nullable: true, resolve: (v) => v.doc.notes ?? null }),
    assigneeUserId: t.string({ resolve: (v) => v.doc.assigneeUserId.toString() }),
    assigneeName: t.string({ nullable: true, resolve: (v) => v.assigneeName }),
    assignedBy: t.string({ resolve: (v) => v.doc.assignedBy.toString() }),
    assignedByName: t.string({ nullable: true, resolve: (v) => v.assignedByName }),
    forLabel: t.string({ nullable: true, resolve: (v) => v.doc.forLabel ?? null }),
    priority: t.field({ type: TaskPriorityEnum, resolve: (v) => v.doc.priority }),
    dueKey: t.string({ resolve: (v) => v.doc.dueKey }),
    slot: t.field({ type: DaySlotEnum, resolve: (v) => v.doc.slot }),
    effortMin: t.int({ resolve: (v) => v.doc.effortMin }),
    status: t.field({ type: TaskStatusEnum, resolve: (v) => v.doc.status }),
    blockedReason: t.string({ nullable: true, resolve: (v) => v.doc.blockedReason ?? null }),
    blockedAt: t.string({ nullable: true, resolve: (v) => iso(v.doc.blockedAt) }),
    startedAt: t.string({ nullable: true, resolve: (v) => iso(v.doc.startedAt) }),
    doneAt: t.string({ nullable: true, resolve: (v) => iso(v.doc.doneAt) }),
    templateId: t.string({ nullable: true, resolve: (v) => v.doc.templateId?.toString() ?? null }),
    createdAt: t.string({ resolve: (v) => new Date(v.doc.createdAt).toISOString() }),
  }),
});

const WorkCardLinkRef = builder.objectRef<WorkCardLink>("WorkCardLink").implement({
  description: "Where tapping the card goes: an app stack screen + string params. The app maps the screen to its tab.",
  fields: (t) => ({
    screen: t.exposeString("screen"),
    /** JSON-encoded string→string params. */
    paramsJson: t.string({ resolve: (l) => JSON.stringify(l.params) }),
  }),
});

const WorkCardRef = builder.objectRef<WorkCard>("WorkCard").implement({
  description:
    "One card on a work board (WB-1/WB-2, D-#701). kind = TASK for a manual task (taskId set), otherwise an AUTO " +
    "projection over another module's record — read-only here; it finishes when its source changes.",
  fields: (t) => ({
    key: t.exposeString("key"),
    kind: t.exposeString("kind"),
    userId: t.exposeString("userId"),
    titleBn: t.exposeString("titleBn"),
    detailBn: t.string({ nullable: true, resolve: (c) => c.detailBn }),
    dateKey: t.exposeString("dateKey"),
    slot: t.field({ type: DaySlotEnum, resolve: (c) => c.slot }),
    startMin: t.int({ nullable: true, resolve: (c) => c.startMin }),
    effortMin: t.exposeInt("effortMin"),
    status: t.field({ type: TaskStatusEnum, resolve: (c) => c.status }),
    overdue: t.exposeBoolean("overdue"),
    priority: t.field({ type: TaskPriorityEnum, nullable: true, resolve: (c) => c.priority }),
    blockedReason: t.string({ nullable: true, resolve: (c) => c.blockedReason }),
    assignedById: t.string({ nullable: true, resolve: (c) => c.assignedById }),
    assignedByName: t.string({ nullable: true, resolve: (c) => c.assignedByName }),
    forLabel: t.string({ nullable: true, resolve: (c) => c.forLabel }),
    taskId: t.string({ nullable: true, resolve: (c) => c.taskId }),
    sourceId: t.string({ nullable: true, resolve: (c) => c.sourceId }),
    link: t.field({ type: WorkCardLinkRef, nullable: true, resolve: (c) => c.link }),
  }),
});

const WorkBoardCountsRef = builder.objectRef<WorkBoardCounts>("WorkBoardCounts").implement({
  description: "The drawer badge: open cards due today, and open cards past their day.",
  fields: (t) => ({
    openToday: t.exposeInt("openToday"),
    overdue: t.exposeInt("overdue"),
  }),
});

const LoadCellRef = builder.objectRef<LoadCell>("WorkLoadCell").implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    minutes: t.exposeInt("minutes"),
    openCards: t.exposeInt("openCards"),
    level: t.exposeString("level"),
  }),
});

const LoadRowRef = builder.objectRef<LoadRow>("WorkLoadRow").implement({
  description: "One staff member's open minutes per day (WB-3). `level` is per-category: ok | amber | red.",
  fields: (t) => ({
    userId: t.exposeString("userId"),
    name: t.exposeString("name"),
    category: t.string({ nullable: true, resolve: (r) => r.category }),
    cells: t.field({ type: [LoadCellRef], resolve: (r) => r.cells }),
    weekMinutes: t.exposeInt("weekMinutes"),
  }),
});

interface AssignableStaff {
  userId: string;
  name: string;
  role: string;
  category: string | null;
  todayMinutes: number;
  todayLevel: string;
}

const AssignableStaffRef = builder.objectRef<AssignableStaff>("AssignableStaff").implement({
  description: "A staff login the caller may put work on, with today's open load beside the name (the form's picker).",
  fields: (t) => ({
    userId: t.exposeString("userId"),
    name: t.exposeString("name"),
    role: t.exposeString("role"),
    category: t.string({ nullable: true, resolve: (r) => r.category }),
    todayMinutes: t.exposeInt("todayMinutes"),
    todayLevel: t.exposeString("todayLevel"),
  }),
});

interface TemplateView {
  doc: ITaskTemplate;
  assigneeName: string | null;
}

const TaskTemplateRef = builder.objectRef<TemplateView>("TaskTemplate").implement({
  description: "A recurring manual task (WB-2). The scheduler creates one Task per matching school day.",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.doc._id.toString() }),
    titleBn: t.string({ resolve: (v) => v.doc.titleBn }),
    notes: t.string({ nullable: true, resolve: (v) => v.doc.notes ?? null }),
    assigneeUserId: t.string({ resolve: (v) => v.doc.assigneeUserId.toString() }),
    assigneeName: t.string({ nullable: true, resolve: (v) => v.assigneeName }),
    forLabel: t.string({ nullable: true, resolve: (v) => v.doc.forLabel ?? null }),
    priority: t.field({ type: TaskPriorityEnum, resolve: (v) => v.doc.priority }),
    slot: t.field({ type: DaySlotEnum, resolve: (v) => v.doc.slot }),
    effortMin: t.int({ resolve: (v) => v.doc.effortMin }),
    recurrence: t.field({ type: TaskRecurrenceEnum, resolve: (v) => v.doc.recurrence }),
    weekdays: t.intList({ resolve: (v) => v.doc.weekdays ?? [] }),
    monthDay: t.int({ nullable: true, resolve: (v) => v.doc.monthDay ?? null }),
    active: t.boolean({ resolve: (v) => v.doc.active }),
  }),
});

async function decorateTemplates(docs: ITaskTemplate[]): Promise<TemplateView[]> {
  if (docs.length === 0) return [];
  const ids = [...new Set(docs.map((d) => d.assigneeUserId.toString()))];
  const users = await User.find({ _id: { $in: ids } }).select("name").lean();
  const name = new Map(users.map((u) => [u._id.toString(), u.name]));
  return docs.map((doc) => ({ doc, assigneeName: name.get(doc.assigneeUserId.toString()) ?? null }));
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const TaskInputType = builder.inputType("TaskInput", {
  description: "Create a manual task. assigneeUserId = the caller's own id needs no permission; anyone else needs tasks:assign.",
  fields: (t) => ({
    titleBn: t.string({ required: true }),
    notes: t.string({ required: false }),
    assigneeUserId: t.string({ required: true }),
    forLabel: t.string({ required: false }),
    priority: t.field({ type: TaskPriorityEnum, required: false }),
    dueKey: t.string({ required: true }),
    slot: t.field({ type: DaySlotEnum, required: false }),
    effortMin: t.int({ required: true }),
  }),
});

const TaskPatchType = builder.inputType("TaskPatch", {
  fields: (t) => ({
    titleBn: t.string({ required: false }),
    notes: t.string({ required: false }),
    forLabel: t.string({ required: false }),
    priority: t.field({ type: TaskPriorityEnum, required: false }),
    dueKey: t.string({ required: false }),
    slot: t.field({ type: DaySlotEnum, required: false }),
    effortMin: t.int({ required: false }),
  }),
});

const TaskTemplateInputType = builder.inputType("TaskTemplateInput", {
  fields: (t) => ({
    titleBn: t.string({ required: true }),
    notes: t.string({ required: false }),
    assigneeUserId: t.string({ required: true }),
    forLabel: t.string({ required: false }),
    priority: t.field({ type: TaskPriorityEnum, required: false }),
    slot: t.field({ type: DaySlotEnum, required: false }),
    effortMin: t.int({ required: true }),
    recurrence: t.field({ type: TaskRecurrenceEnum, required: true }),
    weekdays: t.intList({ required: false }),
    monthDay: t.int({ required: false }),
  }),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("myWorkBoard", (t) =>
  t.field({
    type: [WorkCardRef],
    description: "The caller's unified board for [fromKey, toKey]: manual tasks + auto cards, sorted overdue → day → slot → priority.",
    authScopes: { authenticated: true },
    args: { fromKey: t.arg.string({ required: true }), toKey: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const auth = requireAuth(ctx);
      assertKeys(args.fromKey, args.toKey);
      const users = await loadBoardUsers([auth.userId]);
      return boardFor(users, args.fromKey, args.toKey);
    },
  }),
);

builder.queryField("workBoardFor", (t) =>
  t.field({
    type: [WorkCardRef],
    description: "Someone else's board (tasks:assign) — the load grid's drill-down.",
    authScopes: { hasPermission: "tasks:assign" },
    args: {
      userId: t.arg.string({ required: true }),
      fromKey: t.arg.string({ required: true }),
      toKey: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      assertAssigner(ctx);
      assertKeys(args.fromKey, args.toKey);
      const users = await loadBoardUsers([args.userId]);
      return boardFor(users, args.fromKey, args.toKey);
    },
  }),
);

builder.queryField("myWorkBoardCounts", (t) =>
  t.field({
    type: WorkBoardCountsRef,
    description: "Open-today + overdue card counts for the drawer badge.",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      const auth = requireAuth(ctx);
      const [user] = await loadBoardUsers([auth.userId]);
      if (!user) return { openToday: 0, overdue: 0 };
      return boardCountsFor(user);
    },
  }),
);

builder.queryField("task", (t) =>
  t.field({
    type: TaskRef,
    description: "One manual task — the assignee, the assigner, or a tasks:assign holder.",
    authScopes: { authenticated: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const auth = requireAuth(ctx);
      const doc = await taskById(args.id);
      assertCanReadTask(auth, doc);
      return decorateOne(doc);
    },
  }),
);

builder.queryField("tasksAssignedByMe", (t) =>
  t.field({
    type: [TaskRef],
    description: "আমার দেওয়া কাজ — tasks the caller put on OTHER people's boards. open=true (default) → not DONE; false → DONE.",
    authScopes: { authenticated: true },
    args: { open: t.arg.boolean({ required: false }) },
    resolve: async (_root, args, ctx) => {
      const auth = requireAuth(ctx);
      return decorate(await tasksAssignedBy(auth.userId, args.open ?? true));
    },
  }),
);

builder.queryField("workLoadGrid", (t) =>
  t.field({
    type: [LoadRowRef],
    description: "Open minutes per staff member per day over [fromKey, toKey] (≤ 14 days), per-category colouring (WB-3). tasks:assign.",
    authScopes: { hasPermission: "tasks:assign" },
    args: { fromKey: t.arg.string({ required: true }), toKey: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertAssigner(ctx);
      assertKeys(args.fromKey, args.toKey);
      return loadGrid(args.fromKey, args.toKey);
    },
  }),
);

builder.queryField("assignableStaff", (t) =>
  t.field({
    type: [AssignableStaffRef],
    description: "Every active staff login with today's open load — the new-task picker. tasks:assign.",
    authScopes: { hasPermission: "tasks:assign" },
    resolve: async (_root, _args, ctx) => {
      assertAssigner(ctx);
      const todayKey = dateKeyOf(new Date());
      const users = await allStaffUsers();
      const cats = await categoriesFor(users);
      const cards = await boardFor(users, todayKey, todayKey);
      const minutes = new Map<string, number>();
      for (const c of cards) {
        if (c.status === "DONE") continue;
        minutes.set(c.userId, (minutes.get(c.userId) ?? 0) + c.effortMin);
      }
      return users.map((u) => {
        const id = u._id.toString();
        const cat = cats.get(id) ?? null;
        const m = minutes.get(id) ?? 0;
        return { userId: id, name: u.name, role: u.role, category: cat, todayMinutes: m, todayLevel: loadLevelFor(cat as HrCategory | null, m) };
      });
    },
  }),
);

builder.queryField("taskTemplates", (t) =>
  t.field({
    type: [TaskTemplateRef],
    description: "Recurring tasks: every template for tasks:assign holders, otherwise the ones on the caller's own board.",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => decorateTemplates(await listTaskTemplates(requireAuth(ctx))),
  }),
);

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationField("createTask", (t) =>
  t.field({
    type: TaskRef,
    description: "Create a manual task. For someone else: tasks:assign; the assignee is notified (TASK_ASSIGNED). Audited.",
    authScopes: { authenticated: true },
    args: { input: t.arg({ type: TaskInputType, required: true }) },
    resolve: async (_root, args, ctx) =>
      decorateOne(
        await createTask(ctx.auth, {
          ...args.input,
          priority: (args.input.priority ?? null) as TaskPriority | null,
          slot: (args.input.slot ?? null) as DaySlot | null,
        }),
      ),
  }),
);

builder.mutationField("updateTask", (t) =>
  t.field({
    type: TaskRef,
    description: "Edit title/notes/priority/day/slot/effort — the assigner or tasks:assign. Audited.",
    authScopes: { authenticated: true },
    args: { id: t.arg.string({ required: true }), patch: t.arg({ type: TaskPatchType, required: true }) },
    resolve: async (_root, args, ctx) =>
      decorateOne(
        await updateTask(ctx.auth, args.id, {
          ...args.patch,
          priority: (args.patch.priority ?? null) as TaskPriority | null,
          slot: (args.patch.slot ?? null) as DaySlot | null,
        }),
      ),
  }),
);

builder.mutationField("setTaskStatus", (t) =>
  t.field({
    type: TaskRef,
    description: "TODO / DOING / DONE — the assignee, the assigner or tasks:assign. DONE notifies the assigner. Audited.",
    authScopes: { authenticated: true },
    args: { id: t.arg.string({ required: true }), status: t.arg({ type: TaskStatusEnum, required: true }) },
    resolve: async (_root, args, ctx) => decorateOne(await setTaskStatus(ctx.auth, args.id, args.status as TaskStatus)),
  }),
);

builder.mutationField("setTaskBlocked", (t) =>
  t.field({
    type: TaskRef,
    description: "Block with a one-line reason (notifies the assigner), or unblock with reason = null. Audited.",
    authScopes: { authenticated: true },
    args: { id: t.arg.string({ required: true }), reason: t.arg.string({ required: false }) },
    resolve: async (_root, args, ctx) => decorateOne(await setTaskBlocked(ctx.auth, args.id, args.reason ?? null)),
  }),
);

builder.mutationField("reassignTask", (t) =>
  t.field({
    type: TaskRef,
    description: "Hand the task to someone else — the assigner or tasks:assign. The new assignee is notified. Audited.",
    authScopes: { authenticated: true },
    args: { id: t.arg.string({ required: true }), assigneeUserId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => decorateOne(await reassignTask(ctx.auth, args.id, args.assigneeUserId)),
  }),
);

builder.mutationField("moveTask", (t) =>
  t.field({
    type: TaskRef,
    description: "Move to another slot (the assignee may) and/or day (the assigner or tasks:assign). Audited.",
    authScopes: { authenticated: true },
    args: {
      id: t.arg.string({ required: true }),
      dueKey: t.arg.string({ required: false }),
      slot: t.arg({ type: DaySlotEnum, required: false }),
    },
    resolve: async (_root, args, ctx) =>
      decorateOne(await moveTask(ctx.auth, args.id, { dueKey: args.dueKey ?? null, slot: (args.slot ?? null) as DaySlot | null })),
  }),
);

builder.mutationField("cancelTask", (t) =>
  t.field({
    type: TaskRef,
    description: "Withdraw an open task — the assigner or tasks:assign. The row is hidden, never deleted. Audited.",
    authScopes: { authenticated: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => decorateOne(await cancelTask(ctx.auth, args.id)),
  }),
);

builder.mutationField("createTaskTemplate", (t) =>
  t.field({
    type: TaskTemplateRef,
    description: "A recurring task (WB-2). For someone else: tasks:assign. The scheduler creates today's instance each school morning.",
    authScopes: { authenticated: true },
    args: { input: t.arg({ type: TaskTemplateInputType, required: true }) },
    resolve: async (_root, args, ctx) =>
      (
        await decorateTemplates([
          await createTaskTemplate(ctx.auth, {
            ...args.input,
            priority: (args.input.priority ?? null) as TaskPriority | null,
            slot: (args.input.slot ?? null) as DaySlot | null,
            recurrence: args.input.recurrence as TaskRecurrence,
          }),
        ])
      )[0],
  }),
);

builder.mutationField("setTaskTemplateActive", (t) =>
  t.field({
    type: TaskTemplateRef,
    description: "Pause or resume a recurring task. Its creator, its assignee, or tasks:assign.",
    authScopes: { authenticated: true },
    args: { id: t.arg.string({ required: true }), active: t.arg.boolean({ required: true }) },
    resolve: async (_root, args, ctx) => (await decorateTemplates([await setTaskTemplateActive(ctx.auth, args.id, args.active)]))[0],
  }),
);
