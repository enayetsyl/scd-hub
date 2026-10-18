/**
 * D-#761 — the `<name>Page` reads added for the admin / HR / finance / workboard lists:
 * reconciliationHistoryPage, listLeavePage, proxyGrantsPage, personActivityPage,
 * importedDatesPage, tasksAssignedByPage, listImpersonationTargetsPage and the two
 * observation pages. Real queries against mongodb-memory-server (rows are inserted raw,
 * so only the fields each read touches are seeded).
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import { ReconciliationEntry } from "../modules/finance/models/ReconciliationEntry";
import { reconciliationHistoryPage } from "../modules/finance/services/ReconciliationService";
import { StaffLeaveApplication } from "../modules/hr/models/StaffLeaveApplication";
import { listLeave, listLeavePage } from "../modules/hr/services/StaffLeaveService";
import { ScopeGrant } from "../modules/foundation/models/ScopeGrant";
import { proxyGrantsPage } from "../modules/foundation/services/ScopeGrantService";
import { Audit } from "../modules/platform/models/Audit";
import { HomeworkStudentRecord } from "../modules/trackers/models/HomeworkStudentRecord";
import { personActivity, personActivityPage } from "../modules/platform/services/ActivityService";
import { TeacherAttendanceDay } from "../modules/attendance/models/TeacherAttendanceDay";
import { importedDates, importedDatesPage } from "../modules/attendance/services/TeacherAttendanceService";
import { Task, type ITask } from "../modules/workboard/models/Task";
import { tasksAssignedBy, tasksAssignedByPage } from "../modules/workboard/services/TaskService";
import { User } from "../modules/foundation/models/User";
import { Guardian } from "../modules/foundation/models/Guardian";
import { listImpersonationTargetsPage } from "../modules/foundation/services/ImpersonationService";
import { Observation } from "../modules/hr/models/Observation";
import { observationsByObserverPage, observationsForStaffPage } from "../modules/hr/services/PerformanceService";

jest.setTimeout(120_000);

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const key = (base: string, i: number): string => {
  const d = new Date(`${base}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
};

/** Walk every page; return all rows in order. */
async function walk<T>(read: (page: number) => Promise<{ rows: T[]; total: number }>): Promise<{ all: T[]; total: number }> {
  const all: T[] = [];
  let total = 0;
  for (let page = 1; page < 50; page++) {
    const p = await read(page);
    total = p.total;
    if (p.rows.length === 0) break;
    all.push(...p.rows);
  }
  return { all, total };
}

describe("reconciliationHistoryPage", () => {
  beforeAll(async () => {
    await ReconciliationEntry.collection.insertMany(
      Array.from({ length: 7 }, (_, i) => ({
        date: new Date(`${key("2026-09-01", i)}T12:00:00.000Z`),
        appBankBalance: i,
        appClosing: { CASH: 0, BANK: 0, ONLINE: 0 },
        createdAt: new Date(),
      })),
    );
  });

  it("pages the [from, to] window newest first with the window total", async () => {
    const p1 = await reconciliationHistoryPage("2026-09-02", "2026-09-06", { page: 1, pageSize: 2 });
    expect(p1.total).toBe(5);
    expect(p1.rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual(["2026-09-06", "2026-09-05"]);
    const p3 = await reconciliationHistoryPage("2026-09-02", "2026-09-06", { page: 3, pageSize: 2 });
    expect(p3.rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual(["2026-09-02"]);
  });

  it("refuses a malformed window", async () => {
    await expect(reconciliationHistoryPage("nope", "2026-09-06", {})).rejects.toThrow();
  });
});

describe("listLeavePage", () => {
  beforeAll(async () => {
    const staff = new Types.ObjectId();
    await StaffLeaveApplication.collection.insertMany(
      Array.from({ length: 9 }, (_, i) => ({
        staffProfileId: staff,
        leaveType: "casual",
        fromKey: key("2026-01-01", i * 3),
        toKey: key("2026-01-01", i * 3 + 1),
        status: i % 3 === 0 ? "rejected" : "approved",
        days: 2,
        reason: "r",
      })),
    );
  });

  it("matches listLeave's filter and order, one page at a time", async () => {
    const all = await listLeave({ status: "approved" });
    const { all: paged, total } = await walk((page) => listLeavePage({ status: "approved" }, { page, pageSize: 4 }));
    expect(total).toBe(6);
    expect(paged.map((r) => r._id.toString())).toEqual(all.map((r) => r._id.toString()));
  });

  it("no status = every leave, total counts them all", async () => {
    const p = await listLeavePage({}, { page: 1, pageSize: 5 });
    expect(p).toMatchObject({ total: 9, page: 1, pageSize: 5 });
    expect(p.rows).toHaveLength(5);
  });
});

describe("proxyGrantsPage", () => {
  const NOW = new Date("2026-10-18T06:00:00.000Z");
  beforeAll(async () => {
    const base = { kind: "proxy", teacherId: new Types.ObjectId(), coveringTeacherId: new Types.ObjectId() };
    await ScopeGrant.collection.insertMany([
      // window ended (1 day, a week ago) but never stamped inactive — the lingering case
      { ...base, active: true, startDate: new Date("2026-10-10T03:00:00.000Z"), durationDays: 1, proxyStatus: "active", createdAt: new Date("2026-10-10") },
      // live today
      { ...base, active: true, startDate: new Date("2026-10-18T02:00:00.000Z"), durationDays: 1, proxyStatus: "active", createdAt: new Date("2026-10-17") },
      // future-dated: not started yet, still listed
      { ...base, active: true, startDate: new Date("2026-10-25T02:00:00.000Z"), durationDays: 3, proxyStatus: "active", createdAt: new Date("2026-10-16") },
      // revoked
      { ...base, active: false, startDate: new Date("2026-10-18T02:00:00.000Z"), durationDays: 1, proxyStatus: "revoked", createdAt: new Date("2026-10-15") },
      // a teaching grant never shows
      { kind: "teaching", teacherId: new Types.ObjectId(), active: true, createdAt: new Date("2026-10-18") },
    ]);
  });

  it("active list leaves out revoked AND window-ended grants, newest first", async () => {
    const p = await proxyGrantsPage(true, { page: 1, pageSize: 50 }, NOW);
    expect(p.total).toBe(2);
    expect(p.rows.map((g) => g.startDate?.slice(0, 10))).toEqual(["2026-10-18", "2026-10-25"]);
  });

  it("activeOnly=false is the whole proxy history, paged", async () => {
    const p = await proxyGrantsPage(false, { page: 2, pageSize: 3 }, NOW);
    expect(p.total).toBe(4);
    expect(p.rows).toHaveLength(1);
  });
});

describe("personActivityPage", () => {
  const actor = new Types.ObjectId();
  beforeAll(async () => {
    // 7 audit events + 2 folded homework rows (item A: 3 stamps one day; item B: 1 stamp).
    await Audit.collection.insertMany(
      Array.from({ length: 7 }, (_, i) => ({
        eventKind: "TASK_WRITE",
        actorId: actor,
        eventAt: new Date(`2026-10-1${i}T05:00:00.000Z`),
        meta: {},
      })),
    );
    const itemA = new Types.ObjectId();
    const itemB = new Types.ObjectId();
    const stamp = (at: string) => ({ state: "SUBMITTED", at: new Date(at), by: actor });
    await HomeworkStudentRecord.collection.insertMany([
      { hwItemId: itemA, hwId: "HW-A", studentId: new Types.ObjectId(), stateDates: [stamp("2026-10-13T08:00:00.000Z")] },
      { hwItemId: itemA, hwId: "HW-A", studentId: new Types.ObjectId(), stateDates: [stamp("2026-10-13T08:05:00.000Z")] },
      { hwItemId: itemA, hwId: "HW-A", studentId: new Types.ObjectId(), stateDates: [stamp("2026-10-13T08:10:00.000Z")] },
      { hwItemId: itemB, hwId: "HW-B", studentId: new Types.ObjectId(), stateDates: [stamp("2026-10-15T09:00:00.000Z")] },
    ]);
  });

  it("every row in the window is reachable across pages, same order as the list read", async () => {
    const input = { personId: actor.toString(), from: "2026-10-01", to: "2026-10-31" };
    const list = await personActivity({ ...input, limit: 500 });
    const { all, total } = await walk((page) => personActivityPage(input, { page, pageSize: 2 }));
    expect(total).toBe(9);
    expect(all.map((r) => r.id)).toEqual(list.rows.map((r) => r.id));
    expect(new Set(all.map((r) => r.id)).size).toBe(9);
    const folded = all.find((r) => r.targetLabel === "HW-A");
    expect(folded?.count).toBe(3);
  });

  it("source filter narrows both rows and total", async () => {
    const p = await personActivityPage(
      { personId: actor.toString(), from: "2026-10-01", to: "2026-10-31", source: "HOMEWORK" },
      { page: 1, pageSize: 50 },
    );
    expect(p.total).toBe(2);
    expect(p.rows.every((r) => r.source === "HOMEWORK")).toBe(true);
  });

  it("an invalid person id is an empty page, not an error", async () => {
    await expect(personActivityPage({ personId: "x", from: "2026-10-01", to: "2026-10-31" }, {})).resolves.toMatchObject({
      rows: [],
      total: 0,
    });
  });
});

describe("importedDatesPage", () => {
  beforeAll(async () => {
    const rows = [];
    for (let d = 0; d < 65; d++) {
      for (let s = 0; s < 2; s++) {
        rows.push({ staffProfileId: new Types.ObjectId(), dateKey: key("2026-06-01", d), status: "PRESENT" });
      }
    }
    await TeacherAttendanceDay.collection.insertMany(rows);
  });

  it("reaches past the old silent 60-day cap and reports the real total", async () => {
    expect(await importedDates()).toHaveLength(60);
    const p2 = await importedDatesPage({ page: 2, pageSize: 50 });
    expect(p2.total).toBe(65);
    expect(p2.rows).toHaveLength(15);
    expect(p2.rows[p2.rows.length - 1]).toEqual({ dateKey: "2026-06-01", records: 2 });
    const p1 = await importedDatesPage({ page: 1, pageSize: 50 });
    expect(p1.rows[0]).toEqual({ dateKey: key("2026-06-01", 64), records: 2 });
  });
});

describe("tasksAssignedByPage", () => {
  const me = new Types.ObjectId();
  beforeAll(async () => {
    const other = new Types.ObjectId();
    const base = { assignedBy: me, assigneeUserId: other, cancelledAt: null, titleBn: "t", effortMin: 10, slot: "ANY", priority: "NORMAL" };
    await Task.collection.insertMany([
      ...Array.from({ length: 120 }, (_, i) => ({
        ...base,
        status: "DONE",
        dueKey: "2026-09-01",
        doneAt: new Date(Date.UTC(2026, 8, 1, 0, i)),
      })),
      ...Array.from({ length: 3 }, (_, i) => ({ ...base, status: "TODO", dueKey: key("2026-10-01", i) })),
      // a task I gave myself never shows
      { ...base, assigneeUserId: me, status: "TODO", dueKey: "2026-10-01" },
    ]);
  });

  const ids = (docs: ITask[]) => docs.map((d) => d._id.toString());

  it("the done tab reaches past the old 100-row cap", async () => {
    expect(await tasksAssignedBy(me.toString(), false)).toHaveLength(100);
    const { all, total } = await walk((page) => tasksAssignedByPage(me.toString(), false, { page, pageSize: 50 }, (d) => d));
    expect(total).toBe(120);
    expect(new Set(ids(all)).size).toBe(120);
    expect(ids(all).slice(0, 100)).toEqual(ids(await tasksAssignedBy(me.toString(), false)));
  });

  it("the open tab keeps its due-date order and maps only the page", async () => {
    let mapped = 0;
    const p = await tasksAssignedByPage(me.toString(), true, { page: 1, pageSize: 2 }, (d) => {
      mapped += d.length;
      return d.map((t) => t.dueKey);
    });
    expect(p).toMatchObject({ rows: ["2026-10-01", "2026-10-02"], total: 3 });
    expect(mapped).toBe(2);
  });
});

describe("listImpersonationTargetsPage", () => {
  let principalId: string;
  beforeAll(async () => {
    const principal = new Types.ObjectId();
    principalId = principal.toString();
    await User.collection.insertOne({ _id: principal, name: "Principal", role: "PRINCIPAL", active: true });
    await Guardian.collection.insertMany(
      Array.from({ length: 57 }, (_, i) => ({
        name: `Guardian ${String(i).padStart(2, "0")}`,
        // {identifierKind, identifier} is uniquely indexed; set both or every row collides on null.
        identifierKind: "phone",
        identifier: `0171000${String(i).padStart(4, "0")}`,
        active: true,
        loginEnabled: true,
        passwordHash: "x",
      })),
    );
  });

  it("an empty Guardian search reaches every guardian, A→Z", async () => {
    const p2 = await listImpersonationTargetsPage({ callerUserId: principalId, kind: "GUARDIAN" }, { page: 2, pageSize: 50 });
    expect(p2.total).toBe(57);
    expect(p2.rows.map((r) => r.name)).toEqual(Array.from({ length: 7 }, (_, i) => `Guardian ${50 + i}`));
    expect(p2.rows.every((r) => r.eligible)).toBe(true);
  });

  it("search narrows the total", async () => {
    const p = await listImpersonationTargetsPage({ callerUserId: principalId, kind: "GUARDIAN", search: "Guardian 1" }, {});
    expect(p.total).toBe(10);
  });

  it("still refuses a caller without user:view_as", async () => {
    const teacher = new Types.ObjectId();
    await User.collection.insertOne({ _id: teacher, name: "T", role: "TEACHER", active: true });
    await expect(listImpersonationTargetsPage({ callerUserId: teacher.toString(), kind: "STAFF" }, {})).rejects.toThrow();
  });
});

describe("observation pages", () => {
  const staff = new Types.ObjectId();
  const observer = new Types.ObjectId();
  beforeAll(async () => {
    await Observation.collection.insertMany(
      Array.from({ length: 5 }, (_, i) => ({
        staffProfileId: staff,
        observerId: observer,
        dateKey: key("2026-08-01", i),
        notes: `n${i}`,
      })),
    );
  });

  it("pages one staff member's observations newest first", async () => {
    const p = await observationsForStaffPage(staff.toString(), { page: 1, pageSize: 2 });
    expect(p.total).toBe(5);
    expect(p.rows.map((o) => o.dateKey)).toEqual(["2026-08-05", "2026-08-04"]);
  });

  it("pages an observer's own observations", async () => {
    const p = await observationsByObserverPage(observer.toString(), { page: 3, pageSize: 2 });
    expect(p).toMatchObject({ total: 5, page: 3 });
    expect(p.rows.map((o) => o.dateKey)).toEqual(["2026-08-01"]);
  });
});
