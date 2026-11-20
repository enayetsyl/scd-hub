/**
 * D-#1655 — the read paths (pending alerts, work board, recon report, assignment summary,
 * class-note report) honour real pause windows. In-memory MongoDB, the REAL pause service
 * and real models; rows go in raw (collection.insertOne) so only the fields each path
 * reads need to exist. Only the permission check is stubbed.
 */
// The real pause service (jest.config setupFilesAfterEnv stubs it for every other suite).
jest.unmock("../modules/academic-pause/services/AcademicPauseService");
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const mockPerms = new Set<string>();
jest.mock("@scd/shared", () => ({
  ...jest.requireActual("@scd/shared"),
  callerHasPermission: (_a: unknown, perm: string) => mockPerms.has(perm),
}));

import { createPause } from "../modules/academic-pause/services/AcademicPauseService";
import { AcademicPause } from "../modules/academic-pause/models/AcademicPause";
import { pendingWorkFor } from "../modules/routine/services/PendingAlertService";
import { classNoteSubmissionReport } from "../modules/routine/services/RoutineTriggerService";
import { boardFor } from "../modules/workboard/services/WorkBoardService";
import { reconciliationReport } from "../modules/trackers/services/ReconReportService";
import { assignmentSummary } from "../modules/trackers/services/AssignmentSummaryService";
import { weekNumberFor } from "../modules/trackers/assignmentCalendar";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { ClassNote } from "../modules/routine/models/ClassNote";
import { Section } from "../modules/foundation/models/Section";
import { HomeworkItem } from "../modules/trackers/models/HomeworkItem";
import { AssignmentItem } from "../modules/trackers/models/AssignmentItem";
import { AssignmentSchedule } from "../modules/trackers/models/AssignmentSchedule";

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([AcademicPause.init(), RoutineSlot.init(), HomeworkItem.init(), AssignmentItem.init(), Section.init()]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const T = new Types.ObjectId(); // the teacher
const SEC = new Types.ObjectId();
const SEC2 = new Types.ObjectId();
const CLS = new Types.ObjectId();
const YEAR = new Types.ObjectId();
const WED = new Date(2026, 11, 2); // Wed 2 Dec 2026 — inside the 1–10 Dec window

const window = (pauses: string[], fromKey = "2026-12-01", toKey = "2026-12-10") =>
  createPause({ fromKey, toKey, label: "Annual exam", pauses });

async function slot(over: Record<string, unknown> = {}): Promise<Types.ObjectId> {
  const _id = new Types.ObjectId();
  await RoutineSlot.collection.insertOne({
    _id,
    groupType: "section",
    groupId: SEC,
    classId: CLS,
    dayOfWeek: "WED",
    periodNumber: 1,
    subject: "MATH",
    track: "general",
    teacherId: T,
    active: true,
    isBreak: false,
    effectiveFrom: new Date(2026, 0, 1),
    effectiveTo: null,
    createdBy: T,
    ...over,
  });
  return _id;
}

beforeEach(async () => {
  mockPerms.clear();
  await Promise.all(
    [AcademicPause, RoutineSlot, ClassNote, Section, HomeworkItem, AssignmentItem, AssignmentSchedule].map((m) =>
      m.collection.deleteMany({}),
    ),
  );
});

describe("pendingWorkFor (Today alerts)", () => {
  const ctx = { auth: { userId: T.toString() } } as never;
  const kinds = async (): Promise<string[]> => (await pendingWorkFor(ctx, WED)).alerts.map((a) => a.kind);

  beforeEach(async () => {
    mockPerms.add("class_note:create");
    mockPerms.add("homework:confirm_day");
    await slot();
    await Section.collection.insertOne({ _id: SEC, classId: CLS, active: true, classTeacherId: T, code: "A" });
    await HomeworkItem.collection.insertOne({
      hwId: "HW-1",
      sectionId: SEC,
      classId: CLS,
      status: "declared",
      qCount: 5,
      dateGiven: new Date(2026, 11, 2, 9),
    });
  });

  it("outside any window both the class-note and homework-confirm alerts show", async () => {
    expect((await kinds()).sort()).toEqual(["class_note", "hw_reconcile"]);
  });

  it("a CLASS_NOTE_CHASE window drops the class_note alert", async () => {
    await window(["CLASS_NOTE_CHASE"]);
    expect(await kinds()).toEqual(["hw_reconcile"]);
  });

  it("a HOMEWORK_REQUIRED window keeps hw_reconcile for a day with a DECLARED item (it must not stall)", async () => {
    await window(["HOMEWORK_REQUIRED"]);
    expect((await kinds()).sort()).toEqual(["class_note", "hw_reconcile"]);
  });

  it("a HOMEWORK_REQUIRED window with nothing declared shows no hw_reconcile", async () => {
    await HomeworkItem.deleteMany({});
    await window(["HOMEWORK_REQUIRED"]);
    expect(await kinds()).toEqual(["class_note"]);
  });
});

describe("work board period cards", () => {
  const users = [{ _id: T, name: "T", role: "TEACHER" }];
  const periodCards = async (): Promise<number> =>
    (await boardFor(users as never, "2026-12-02", "2026-12-02", new Date(2026, 10, 20))).filter((c) => c.kind === "PERIOD")
      .length;

  it("a CLASS_NOTE_CHASE window removes the card, other windows and no window keep it", async () => {
    await slot();
    expect(await periodCards()).toBe(1); // control: the adapter really runs
    await window(["HOMEWORK_REQUIRED", "ASSIGNMENT_CHASE"]);
    expect(await periodCards()).toBe(1);
    await window(["CLASS_NOTE_CHASE"]);
    expect(await periodCards()).toBe(0);
  });
});

describe("reconciliationReport", () => {
  const run = () => reconciliationReport("2026-12-01", "2026-12-10", new Date(2026, 11, 11), { skipNotPrinted: true });

  beforeEach(async () => {
    await HomeworkItem.collection.insertOne({
      hwId: "HW-1",
      sectionId: SEC,
      classId: CLS,
      status: "declared",
      timeDecl: 20,
      dateGiven: new Date(2026, 11, 2, 9),
    });
    await AssignmentItem.collection.insertOne({
      asId: "AS-1",
      sectionId: SEC,
      classId: CLS,
      weekNumber: 49,
      status: "DRAFT",
      estMinutes: 10,
      deliveryDate: new Date(2026, 11, 3, 9),
    });
  });

  it("outside any window both miss rows are listed", async () => {
    const r = await run();
    expect(r.hwMisses).toHaveLength(1);
    expect(r.asMisses).toHaveLength(1);
  });

  it("HOMEWORK_REQUIRED keeps a declared-but-unconfirmed day listed; ASSIGNMENT_GENERATION drops the paused delivery day", async () => {
    await window(["HOMEWORK_REQUIRED", "ASSIGNMENT_GENERATION"]);
    const r = await run();
    expect(r.hwMisses).toHaveLength(1);
    expect(r.asMisses).toHaveLength(0);
  });
});

describe("assignmentSummary suspension", () => {
  const termStart = new Date(2026, 0, 4); // a Sunday
  const week = weekNumberFor(termStart, new Date(2026, 10, 26)); // week delivered Thu 26 Nov

  beforeEach(async () => {
    await AssignmentSchedule.collection.insertOne({
      academicYearId: YEAR,
      termStartDate: termStart,
      deliveryDayOfWeek: 4,
      dueDayOfWeek: 0,
      entries: [1, 2, 3, 4].map((cycleWeek) => ({
        _id: new Types.ObjectId(),
        cycleWeek,
        classId: CLS,
        classLevel: 1,
        sectionId: SEC,
        subject: "MATH",
        teacherId: T,
      })),
    });
  });
  const run = () =>
    assignmentSummary({ academicYearId: YEAR.toString(), weekFrom: week, weekTo: week, asOf: new Date(2026, 11, 5) });

  it("a week is expected normally outside a window", async () => {
    const r = await run();
    expect(r.suspendedWeeks).toEqual([]);
    expect(r.scheduledTotal).toBe(1);
  });

  it("an ASSIGNMENT_GENERATION window on the delivery day suspends the week; other kinds do not", async () => {
    await window(["ASSIGNMENT_CHASE", "HOMEWORK_REQUIRED"], "2026-11-26", "2026-11-26");
    expect((await run()).suspendedWeeks).toEqual([]);
    await window(["ASSIGNMENT_GENERATION"], "2026-11-26", "2026-11-26");
    const r = await run();
    expect(r.suspendedWeeks).toEqual([week]);
    expect(r.scheduledTotal).toBe(0);
  });
});

describe("classNoteSubmissionReport", () => {
  beforeEach(async () => {
    const posted = await slot({ subject: "MATH", periodNumber: 1 });
    await slot({ subject: "BAN", periodNumber: 2 }); // same group, not posted
    await slot({ subject: "ENG", periodNumber: 3, groupId: SEC2 }); // other group, nothing posted
    await ClassNote.collection.insertOne({ slotId: posted, groupType: "section", groupId: SEC, date: new Date(2026, 11, 2, 9) });
  });
  const rows = async () => (await classNoteSubmissionReport(WED)).sort((a, b) => a.groupId.localeCompare(b.groupId));

  it("outside a window pending subjects are reported", async () => {
    const r = await rows();
    expect(r.reduce((n, x) => n + x.pendingCount, 0)).toBe(2);
    expect(r).toHaveLength(2);
  });

  it("inside a CLASS_NOTE_CHASE window nothing is pending and only groups with a posted note remain", async () => {
    await window(["CLASS_NOTE_CHASE"]);
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0].publishedSubjects).toEqual(["MATH"]);
    expect(r[0].pendingSubjects).toEqual([]);
    expect(r[0].pendingCount).toBe(0);
  });
});
