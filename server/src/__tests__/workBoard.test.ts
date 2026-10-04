/**
 * Work board (WB-1..WB-3, D-#701) — the pure rules, DB-free.
 *
 *   1. templateDueOn — SCHOOL_DAYS / WEEKLY / MONTHLY (31 clamps to month end)
 *   2. slotForMinute + sortCards — overdue first, DONE last, slot → clock → priority
 *   3. aggregateLoad — open minutes per user per day, PER-CATEGORY colouring
 *   4. digestLines / overdueLines — one line per recipient, assigner included once
 *   5. TaskService — who may create/status/block/reassign/cancel; DONE stamps + notifies
 */
import { Types } from "mongoose";
import { loadLevelFor } from "@scd/shared";

const mockCreate = jest.fn();
const mockFindById = jest.fn();
const mockUserFindById = jest.fn();
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);
const mockEmitAssigned = jest.fn().mockResolvedValue(undefined);
const mockEmitDone = jest.fn().mockResolvedValue(undefined);
const mockEmitBlocked = jest.fn().mockResolvedValue(undefined);

jest.mock("../modules/workboard/models/Task", () => ({
  Task: {
    create: (d: unknown) => mockCreate(d),
    findById: (id: unknown) => mockFindById(id),
    find: () => ({ sort: () => ({ lean: () => Promise.resolve([]), limit: () => ({ lean: () => Promise.resolve([]) }) }) }),
  },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    findById: (id: unknown) => ({ select: () => ({ lean: () => mockUserFindById(id) }) }),
    find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
  },
}));
const mockObservationFind = jest.fn();
jest.mock("../modules/classroom-observation/models/ClassroomObservation", () => ({
  ClassroomObservation: {
    find: (q: unknown) => ({ select: () => ({ lean: () => mockObservationFind(q) }) }),
  },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));
jest.mock("../modules/workboard/services/workBoardNotifications", () => ({
  emitTaskAssigned: (...a: unknown[]) => mockEmitAssigned(...a),
  emitTaskDone: (...a: unknown[]) => mockEmitDone(...a),
  emitTaskBlocked: (...a: unknown[]) => mockEmitBlocked(...a),
}));

import { templateDueOn } from "../modules/workboard/services/TaskTemplateService";
import { applyPulls, observationCards, slotForMinute, sortCards, type WorkCard } from "../modules/workboard/services/WorkBoardService";
import { deskUncovered, officeRecipients } from "../modules/workboard/services/OfficeCoverService";
import { aggregateLoad } from "../modules/workboard/services/LoadService";
import { digestLines, overdueLines } from "../modules/workboard/services/TaskSweepService";
import {
  cancelTask,
  createTask,
  reassignTask,
  setTaskBlocked,
  setTaskStatus,
} from "../modules/workboard/services/TaskService";
import type { AuthPayload } from "../context";

// ---------------------------------------------------------------------------
// 1. Recurrence
// ---------------------------------------------------------------------------

describe("templateDueOn", () => {
  const wed = new Date(2026, 8, 30); // 2026-09-30, a Wednesday, last day of September
  test("SCHOOL_DAYS fires on any school day", () => {
    expect(templateDueOn({ recurrence: "SCHOOL_DAYS", weekdays: [] }, wed)).toBe(true);
  });
  test("WEEKLY fires only on its weekdays", () => {
    expect(templateDueOn({ recurrence: "WEEKLY", weekdays: [3] }, wed)).toBe(true);
    expect(templateDueOn({ recurrence: "WEEKLY", weekdays: [0, 1] }, wed)).toBe(false);
    expect(templateDueOn({ recurrence: "WEEKLY", weekdays: [] }, wed)).toBe(false);
  });
  test("MONTHLY_WEEKDAY: the Nth weekday of the month; 5 = the last one", () => {
    // September 2026: Saturdays fall on 5, 12, 19, 26 → the 26th is both 4th and last.
    const sat = (d: number) => new Date(2026, 8, d);
    const first = { recurrence: "MONTHLY_WEEKDAY" as const, weekdays: [6], weekOfMonth: 1 };
    expect(templateDueOn(first, sat(5))).toBe(true);
    expect(templateDueOn(first, sat(12))).toBe(false);
    expect(templateDueOn(first, new Date(2026, 8, 6))).toBe(false); // a Sunday
    expect(templateDueOn({ ...first, weekOfMonth: 4 }, sat(26))).toBe(true);
    expect(templateDueOn({ ...first, weekOfMonth: 5 }, sat(26))).toBe(true);
    expect(templateDueOn({ ...first, weekOfMonth: 5 }, sat(19))).toBe(false);
    // October 2026 has five Saturdays (3, 10, 17, 24, 31): "last" is the 31st, "4th" is the 24th.
    expect(templateDueOn({ ...first, weekOfMonth: 5 }, new Date(2026, 9, 31))).toBe(true);
    expect(templateDueOn({ ...first, weekOfMonth: 5 }, new Date(2026, 9, 24))).toBe(false);
    expect(templateDueOn({ ...first, weekOfMonth: 4 }, new Date(2026, 9, 24))).toBe(true);
    expect(templateDueOn({ recurrence: "MONTHLY_WEEKDAY", weekdays: [], weekOfMonth: 1 }, sat(5))).toBe(false);
  });
  test("MONTHLY fires on its date, and a 31 clamps to the month's last day", () => {
    expect(templateDueOn({ recurrence: "MONTHLY", weekdays: [], monthDay: 30 }, wed)).toBe(true);
    expect(templateDueOn({ recurrence: "MONTHLY", weekdays: [], monthDay: 31 }, wed)).toBe(true);
    expect(templateDueOn({ recurrence: "MONTHLY", weekdays: [], monthDay: 15 }, wed)).toBe(false);
    expect(templateDueOn({ recurrence: "MONTHLY", weekdays: [] }, wed)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Slots + ordering
// ---------------------------------------------------------------------------

const card = (over: Partial<WorkCard>): WorkCard => ({
  key: over.key ?? Math.random().toString(36),
  kind: "TASK",
  userId: "u1",
  titleBn: "x",
  detailBn: null,
  dateKey: "2026-09-30",
  slot: "ANY",
  startMin: null,
  effortMin: 30,
  status: "TODO",
  overdue: false,
  priority: null,
  blockedReason: null,
  assignedById: null,
  assignedByName: null,
  forLabel: null,
  taskId: null,
  sourceId: null,
  link: null,
  ...over,
});

describe("slotForMinute + sortCards", () => {
  test("slot boundaries: before 11:00 morning, 11:00–13:29 midday, 13:30+ afternoon, null → ANY", () => {
    expect(slotForMinute(9 * 60)).toBe("MORNING");
    expect(slotForMinute(11 * 60)).toBe("MIDDAY");
    expect(slotForMinute(13 * 60 + 29)).toBe("MIDDAY");
    expect(slotForMinute(13 * 60 + 30)).toBe("AFTERNOON");
    expect(slotForMinute(null)).toBe("ANY");
  });
  test("overdue first, DONE last, then slot order, clock, priority", () => {
    const sorted = sortCards([
      card({ key: "done-morning", status: "DONE", slot: "MORNING", startMin: 540 }),
      card({ key: "afternoon", slot: "AFTERNOON" }),
      card({ key: "midday-later", slot: "MIDDAY", priority: "LATER" }),
      card({ key: "midday-urgent", slot: "MIDDAY", priority: "URGENT" }),
      card({ key: "morning-p2", slot: "MORNING", startMin: 600 }),
      card({ key: "morning-p1", slot: "MORNING", startMin: 540 }),
      card({ key: "overdue", overdue: true, dateKey: "2026-09-28", slot: "AFTERNOON" }),
    ]).map((c) => c.key);
    expect(sorted).toEqual(["overdue", "morning-p1", "morning-p2", "midday-urgent", "midday-later", "afternoon", "done-morning"]);
  });
});

// ---------------------------------------------------------------------------
// 3. Load grid
// ---------------------------------------------------------------------------

describe("aggregateLoad", () => {
  test("sums OPEN minutes per user per day and colours per category", () => {
    const keys = ["2026-09-30", "2026-10-01"];
    const rows = aggregateLoad(
      [
        { id: "t", name: "Kainat", category: "teacher" },
        { id: "o", name: "Akmol", category: "office_accounts" },
      ],
      [
        card({ userId: "t", effortMin: 200 }),
        card({ userId: "t", effortMin: 120 }),
        card({ userId: "t", effortMin: 999, status: "DONE" }), // finished work is not load
        card({ userId: "o", effortMin: 320 }),
        card({ userId: "o", effortMin: 60, dateKey: "2026-10-01" }),
      ],
      keys,
    );
    const kainat = rows.find((r) => r.userId === "t")!;
    const akmol = rows.find((r) => r.userId === "o")!;
    expect(kainat.cells.map((c) => c.minutes)).toEqual([320, 0]);
    expect(kainat.cells[0].level).toBe("amber"); // teacher amber ≥ 300
    expect(kainat.cells[0].openCards).toBe(2);
    expect(akmol.cells[0].level).toBe("ok"); // office amber ≥ 360
    expect(akmol.weekMinutes).toBe(380);
  });
  test("thresholds: red at/above the category's red line; unknown category reads as teacher", () => {
    expect(loadLevelFor("teacher", 390)).toBe("red");
    expect(loadLevelFor("office_accounts", 449)).toBe("amber");
    expect(loadLevelFor(null, 300)).toBe("amber");
  });
});

// ---------------------------------------------------------------------------
// 3b. Office cover + pulls (WB-5, D-#702)
// ---------------------------------------------------------------------------

describe("office cover: desk, backups, pulls", () => {
  const akmol = { _id: "akmol", role: "OFFICE", additionalTemplates: [] as string[] };
  const tazkir = { _id: "tazkir", role: "TEACHER", additionalTemplates: ["OFFICE"] };
  const principal = { _id: "principal", role: "PRINCIPAL", additionalTemplates: [] as string[] };
  const plainTeacher = { _id: "kainat", role: "TEACHER", additionalTemplates: [] as string[] };
  const all = [akmol, tazkir, principal, plainTeacher];

  test("deskUncovered: no desk login, or every desk login absent", () => {
    expect(deskUncovered([], new Set())).toBe(true);
    expect(deskUncovered(["akmol"], new Set())).toBe(false);
    expect(deskUncovered(["akmol"], new Set(["akmol"]))).toBe(true);
    expect(deskUncovered(["akmol", "b"], new Set(["akmol"]))).toBe(false);
  });

  test("office cards go to the desk alone normally, and to the backups too while uncovered", () => {
    expect(officeRecipients(all, false).map((u) => u._id)).toEqual(["akmol"]);
    expect(officeRecipients(all, true).map((u) => u._id)).toEqual(["akmol", "tazkir", "principal"]);
  });

  test("applyPulls: a pulled card shows on the puller's board alone; a backup's unpulled card is pullable; the desk's never is", () => {
    const job = (userId: string) => card({ key: `PRINT_JOB:j1:${userId}`, kind: "PRINT_JOB", userId, sourceId: "j1" });
    const other = card({ key: "PERIOD:s:d:akmol", kind: "PERIOD", userId: "akmol", sourceId: "s" });
    const names = new Map([["tazkir", "Tazkir"]]);

    const unpulled = applyPulls([job("akmol"), job("tazkir"), job("principal"), other], [], all, names);
    expect(unpulled.map((c) => [c.userId, c.canPull ?? false])).toEqual([
      ["akmol", false],
      ["tazkir", true],
      ["principal", true],
      ["akmol", false],
    ]);

    const pulled = applyPulls(
      [job("akmol"), job("tazkir"), job("principal"), other],
      [{ kind: "PRINT_JOB", sourceId: "j1", userId: "tazkir" }],
      all,
      names,
    );
    expect(pulled.map((c) => c.key)).toEqual(["PRINT_JOB:j1:tazkir", "PERIOD:s:d:akmol"]);
    expect(pulled[0].pulledByName).toBe("Tazkir");
    expect(pulled[0].canPull).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3c. Observation cards
// ---------------------------------------------------------------------------

describe("observationCards", () => {
  test("a cancelled plan (still state ASSIGNED) is not a card — the board matches the review queue", async () => {
    const observer = new Types.ObjectId();
    const open = { _id: new Types.ObjectId(), observerId: observer, teacherId: new Types.ObjectId(), classDate: "2026-10-04", subject: "MATH" };
    mockObservationFind.mockResolvedValueOnce([open]);

    const cards = await observationCards([observer.toString()], "2026-10-04");

    const filter = mockObservationFind.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.state).toBe("ASSIGNED");
    expect(filter).toHaveProperty("cancelledAt", null);
    expect(cards.map((c) => c.key)).toEqual([`OBSERVATION:${open._id.toString()}`]);
  });
});

// ---------------------------------------------------------------------------
// 4. Sweeps
// ---------------------------------------------------------------------------

describe("digestLines / overdueLines", () => {
  const a = new Types.ObjectId();
  const b = new Types.ObjectId();
  const tasks = [
    { assigneeUserId: a, assignedBy: b, dueKey: "2026-09-30", status: "TODO" as const, titleBn: "today-1" },
    { assigneeUserId: a, assignedBy: a, dueKey: "2026-09-28", status: "DOING" as const, titleBn: "late-self" },
    { assigneeUserId: a, assignedBy: b, dueKey: "2026-10-02", status: "TODO" as const, titleBn: "future" },
    { assigneeUserId: b, assignedBy: a, dueKey: "2026-09-29", status: "DONE" as const, titleBn: "done" },
  ];
  test("digest: today vs overdue per assignee; future and DONE excluded", () => {
    const lines = digestLines(tasks, "2026-09-30");
    expect(lines).toEqual([{ recipientId: a.toString(), today: 1, overdue: 1 }]);
  });
  test("overdue: assignee AND assigner, the self-assigned task names its owner once", () => {
    const lines = overdueLines(tasks, "2026-09-30");
    const forA = lines.find((l) => l.recipientId === a.toString())!;
    const forB = lines.find((l) => l.recipientId === b.toString())!;
    expect(forA.titles).toEqual(["today-1", "late-self"]);
    expect(forB.titles).toEqual(["today-1"]);
  });
});

// ---------------------------------------------------------------------------
// 5. TaskService
// ---------------------------------------------------------------------------

const ID = new Types.ObjectId().toString();
const teacher = (id: string): AuthPayload => ({ userId: id, role: "TEACHER" });
const assigner = (id: string): AuthPayload => ({ userId: id, role: "TEACHER", grantedPermissions: ["tasks:assign"] });

function fakeDoc(over: Record<string, unknown> = {}) {
  const doc: Record<string, unknown> = {
    _id: new Types.ObjectId(),
    titleBn: "t",
    assigneeUserId: new Types.ObjectId(),
    assignedBy: new Types.ObjectId(),
    priority: "NORMAL",
    dueKey: "2026-09-30",
    slot: "ANY",
    effortMin: 30,
    status: "TODO",
    save: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
  return doc;
}

describe("TaskService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindById.mockResolvedValue({ role: "TEACHER", active: true, name: "X" });
    mockCreate.mockImplementation(async (d: Record<string, unknown>) => fakeDoc(d));
  });

  test("anyone creates a task for THEMSELVES without a permission; nobody is notified", async () => {
    const me = new Types.ObjectId().toString();
    const doc = await createTask(teacher(me), { titleBn: "নিজের কাজ", assigneeUserId: me, dueKey: "2026-09-30", effortMin: 30 });
    expect(doc.status).toBe("TODO");
    expect(mockEmitAssigned).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "TASK_WRITE", meta: expect.objectContaining({ action: "create" }) }));
  });

  test("creating for someone ELSE needs tasks:assign; with it, the assignee is notified", async () => {
    const me = new Types.ObjectId().toString();
    const other = new Types.ObjectId().toString();
    await expect(createTask(teacher(me), { titleBn: "x", assigneeUserId: other, dueKey: "2026-09-30", effortMin: 30 })).rejects.toThrow(/অনুমতি/);
    await createTask(assigner(me), { titleBn: "x", assigneeUserId: other, dueKey: "2026-09-30", effortMin: 30 });
    expect(mockEmitAssigned).toHaveBeenCalledTimes(1);
  });

  test("validation: empty title, bad date, effort out of range", async () => {
    const me = new Types.ObjectId().toString();
    await expect(createTask(teacher(me), { titleBn: "  ", assigneeUserId: me, dueKey: "2026-09-30", effortMin: 30 })).rejects.toThrow();
    await expect(createTask(teacher(me), { titleBn: "x", assigneeUserId: me, dueKey: "30/09/2026", effortMin: 30 })).rejects.toThrow();
    await expect(createTask(teacher(me), { titleBn: "x", assigneeUserId: me, dueKey: "2026-09-30", effortMin: 2 })).rejects.toThrow();
  });

  test("DONE stamps doneAt/doneBy, clears a block, and tells the assigner; a stranger may not", async () => {
    const assignee = new Types.ObjectId();
    const boss = new Types.ObjectId();
    const doc = fakeDoc({ assigneeUserId: assignee, assignedBy: boss, blockedReason: "stuck", blockedAt: new Date() });
    mockFindById.mockResolvedValue(doc);
    await expect(setTaskStatus(teacher(new Types.ObjectId().toString()), ID, "DONE")).rejects.toThrow();
    const out = await setTaskStatus(teacher(assignee.toString()), ID, "DONE");
    expect(out.status).toBe("DONE");
    expect(out.doneAt).toBeInstanceOf(Date);
    expect(out.doneBy?.toString()).toBe(assignee.toString());
    expect(out.blockedReason).toBeUndefined();
    expect(mockEmitDone).toHaveBeenCalledTimes(1);
  });

  test("reopening clears the DONE stamp; DOING stamps startedAt once", async () => {
    const assignee = new Types.ObjectId();
    const doc = fakeDoc({ assigneeUserId: assignee, status: "DONE", doneAt: new Date(), doneBy: assignee });
    mockFindById.mockResolvedValue(doc);
    const out = await setTaskStatus(teacher(assignee.toString()), ID, "DOING");
    expect(out.status).toBe("DOING");
    expect(out.doneAt).toBeUndefined();
    expect(out.startedAt).toBeInstanceOf(Date);
  });

  test("blocking needs a reason and notifies the assigner; unblocking clears it", async () => {
    const assignee = new Types.ObjectId();
    const doc = fakeDoc({ assigneeUserId: assignee });
    mockFindById.mockResolvedValue(doc);
    await expect(setTaskBlocked(teacher(assignee.toString()), ID, "   ")).rejects.toThrow();
    const blocked = await setTaskBlocked(teacher(assignee.toString()), ID, "টেমপ্লেট নেই");
    expect(blocked.blockedReason).toBe("টেমপ্লেট নেই");
    expect(mockEmitBlocked).toHaveBeenCalledTimes(1);
    const cleared = await setTaskBlocked(teacher(assignee.toString()), ID, null);
    expect(cleared.blockedReason).toBeUndefined();
  });

  test("reassign: the assignee alone may not; the assigner may; the new person is notified; a DONE task cannot move", async () => {
    const assignee = new Types.ObjectId();
    const boss = new Types.ObjectId();
    const other = new Types.ObjectId().toString();
    const doc = fakeDoc({ assigneeUserId: assignee, assignedBy: boss });
    mockFindById.mockResolvedValue(doc);
    await expect(reassignTask(teacher(assignee.toString()), ID, other)).rejects.toThrow();
    const out = await reassignTask(teacher(boss.toString()), ID, other);
    expect(out.assigneeUserId.toString()).toBe(other);
    expect(mockEmitAssigned).toHaveBeenCalledTimes(1);
    mockFindById.mockResolvedValue(fakeDoc({ assigneeUserId: assignee, assignedBy: boss, status: "DONE" }));
    await expect(reassignTask(teacher(boss.toString()), ID, other)).rejects.toThrow();
  });

  test("cancel: hides an open task (never deletes); a DONE task cannot be cancelled", async () => {
    const boss = new Types.ObjectId();
    const doc = fakeDoc({ assignedBy: boss });
    mockFindById.mockResolvedValue(doc);
    const out = await cancelTask(teacher(boss.toString()), ID);
    expect(out.cancelledAt).toBeInstanceOf(Date);
    mockFindById.mockResolvedValue(fakeDoc({ assignedBy: boss, status: "DONE" }));
    await expect(cancelTask(teacher(boss.toString()), ID)).rejects.toThrow();
  });
});

describe("Task template index", () => {
  // Source reads (the model is mocked above); CRLF-normalised for Windows checkouts.
  const read = (rel: string): string =>
    require("fs").readFileSync(require("path").join(__dirname, rel), "utf8").replace(/\r\n/g, "\n");
  const MODEL = read("../modules/workboard/models/Task.ts");

  test("the template-per-day unique index is PARTIAL on templateId, never sparse", () => {
    // Compound + sparse still indexes every row (all have dueKey), so manual tasks
    // shared the (null, dueKey) slot: one manual task per date, school-wide.
    const decl = MODEL.slice(MODEL.indexOf("TaskSchema.index(\n  { templateId: 1, dueKey: 1 }"));
    expect(decl).toMatch(/unique: true, partialFilterExpression: \{ templateId: \{ \$type: "objectId" \} \}/);
    expect(MODEL).not.toMatch(/templateId: 1, dueKey: 1 \}, \{[^}]*sparse/);
  });

  test("a migration exists, because Mongoose cannot replace a same-named index", () => {
    const script = read("../../scripts/migrate-task-template-index.ts");
    expect(script).toContain("templateId_1_dueKey_1");
    expect(script).toMatch(/Task\.syncIndexes\(\)/);
    expect(script).toMatch(/partial template index is NOT present/);
  });
});
