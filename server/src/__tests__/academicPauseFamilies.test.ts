/**
 * D-#1655 — every chaser / generator honours the pause service. The window store itself is
 * tested in academicPause.test.ts; here the service is stubbed so each family is driven
 * inside and outside a window with no DB.
 */
const mockPausedOn = jest.fn();
const mockPausedOnDate = jest.fn();
const mockPausedNow = jest.fn();
const mockPredicate = jest.fn();
jest.mock("../modules/academic-pause/services/AcademicPauseService", () => ({
  isPausedOn: (k: string, d: string) => mockPausedOn(k, d),
  isPausedOnDate: (k: string, d: Date) => mockPausedOnDate(k, d),
  isPausedNow: (k: string, d: Date) => mockPausedNow(k, d),
  loadPausePredicate: async () => (k: string, d: string) => mockPredicate(k, d),
}));

import { dueItemsToday } from "../modules/trackers/services/MarkReminderService";
import { sweepHomeworkAutoChase } from "../modules/trackers/services/HomeworkChaseSweepService";
import { sweepAssignmentChases } from "../modules/trackers/services/AssignmentService";
import { assignmentChaseList } from "../modules/trackers/services/AssignmentFollowUpService";
import { unwrittenClassNoteSlots, myClassNotePrompts } from "../modules/routine/services/RoutineTriggerService";
import { resolveScheduleWeek } from "../modules/trackers/services/AssignmentScheduleService";
import { weekNumberFor } from "../modules/trackers/assignmentCalendar";
import { AssignmentItem } from "../modules/trackers/models/AssignmentItem";
import { AssignmentStudentRecord } from "../modules/trackers/models/AssignmentStudentRecord";
import { HomeworkStudentRecord } from "../modules/trackers/models/HomeworkStudentRecord";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { RoutineSubstitution } from "../modules/routine/models/RoutineSubstitution";
import { ClassNote } from "../modules/routine/models/ClassNote";
import { HolidayException } from "../modules/routine/models/HolidayException";
import { AssignmentFollowUp } from "../modules/trackers/models/AssignmentFollowUp";
import { Student } from "../modules/foundation/models/Student";

const boom = (): never => {
  throw new Error("DB touched inside a paused day");
};

beforeEach(() => {
  jest.restoreAllMocks();
  mockPausedOn.mockReset().mockResolvedValue(false);
  mockPausedOnDate.mockReset().mockResolvedValue(false);
  mockPausedNow.mockReset().mockResolvedValue(false);
  mockPredicate.mockReset().mockReturnValue(false);
});

describe("ASSIGNMENT_CHASE", () => {
  it("dueItemsToday (mark pop-ups + 09:30 escalation) is empty and reads nothing on a paused day", async () => {
    mockPausedOn.mockImplementation(async (k: string) => k === "ASSIGNMENT_CHASE");
    jest.spyOn(AssignmentItem, "find").mockImplementation(boom as never);
    expect(await dueItemsToday(new Date("2026-12-02T05:00:00Z"))).toEqual([]);
    expect(mockPausedOn).toHaveBeenCalledWith("ASSIGNMENT_CHASE", "2026-12-02");
  });

  it("outside a window dueItemsToday goes on to read the items", async () => {
    const find = jest
      .spyOn(AssignmentItem, "find")
      .mockReturnValue({ select: () => ({ lean: async () => [] }) } as never);
    expect(await dueItemsToday(new Date("2026-12-11T05:00:00Z"))).toEqual([]);
    expect(find).toHaveBeenCalled();
  });

  it("sweepAssignmentChases does nothing on a paused day, and runs outside", async () => {
    const find = jest.spyOn(AssignmentStudentRecord, "find").mockResolvedValue([] as never);
    mockPausedNow.mockResolvedValue(true);
    expect(await sweepAssignmentChases(new Date())).toBe(0);
    expect(find).not.toHaveBeenCalled();
    mockPausedNow.mockResolvedValue(false);
    await sweepAssignmentChases(new Date());
    expect(find).toHaveBeenCalled();
  });

  it("the chase list is empty on a paused day", async () => {
    mockPausedNow.mockResolvedValue(true);
    jest.spyOn(AssignmentStudentRecord, "find").mockImplementation(boom as never);
    expect(await assignmentChaseList(new Date())).toEqual([]);
  });
});

describe("ASSIGNMENT_CHASE — due day inside a window (same rule as homework)", () => {
  // Window = 1..10 Dec. A record due 10 Dec is never listed/chased afterwards; one due 11 Dec is normal.
  const inWindow = (k: string, d: string) => k === "ASSIGNMENT_CHASE" && d >= "2026-12-01" && d <= "2026-12-10";
  const rec = (id: string, due: Date) => ({
    _id: id,
    state: "CHASE",
    chaseCount: 1,
    dueDate: due,
    asItemId: "i1",
    asId: "AS-1",
    studentId: "st1",
    sectionId: "sec1",
    classId: "c1",
  });

  function stubChaseJoins(): void {
    jest.spyOn(AssignmentItem, "find").mockReturnValue({ lean: async () => [] } as never);
    jest.spyOn(Student, "find").mockReturnValue({ select: () => ({ lean: async () => [] }) } as never);
    jest.spyOn(AssignmentFollowUp, "find").mockReturnValue({ select: () => ({ lean: async () => [] }) } as never);
  }

  it("the chase list on 11 Dec omits a record due 10 Dec (in window) and keeps one due 11 Dec", async () => {
    mockPredicate.mockImplementation(inWindow);
    stubChaseJoins();
    jest
      .spyOn(AssignmentStudentRecord, "find")
      .mockReturnValue({ lean: async () => [rec("a", new Date(2026, 11, 10, 9)), rec("b", new Date(2026, 11, 11, 9))] } as never);
    const rows = await assignmentChaseList(new Date(2026, 11, 12, 9));
    expect(rows.map((r) => r.recordId)).toEqual(["b"]);
    expect(rows[0].daysOverdue).toBe(1);
  });

  it("the sweep on 12 Dec never chases a record due 10 Dec, and chases one due 11 Dec", async () => {
    mockPredicate.mockImplementation(inWindow);
    const mk = (due: Date) => ({ dueDate: due, state: "DUE", chaseCount: 0, stateDates: [] as unknown[], save: jest.fn() });
    const a = mk(new Date(2026, 11, 10, 9));
    const b = mk(new Date(2026, 11, 11, 9));
    jest.spyOn(AssignmentStudentRecord, "find").mockResolvedValue([a, b] as never);
    expect(await sweepAssignmentChases(new Date(2026, 11, 12, 9))).toBe(1);
    expect(a.save).not.toHaveBeenCalled();
    expect(a.state).toBe("DUE");
    expect(b.state).toBe("CHASE");
  });
});

describe("HOMEWORK_REQUIRED", () => {
  it("the 17:30 auto-chase sweeps nothing on a paused day", async () => {
    mockPausedOn.mockImplementation(async (k: string) => k === "HOMEWORK_REQUIRED");
    jest.spyOn(HomeworkStudentRecord, "find").mockImplementation(boom as never);
    expect(await sweepHomeworkAutoChase(new Date(2026, 11, 2, 17, 30))).toBe(0);
  });

  it("a record that fell due on a paused day is never chased later", async () => {
    mockPredicate.mockImplementation((k: string, d: string) => k === "HOMEWORK_REQUIRED" && d === "2026-12-01");
    const rec = {
      _id: "r1",
      state: "DUE",
      chaseCount: 0,
      dueDate: new Date(2026, 11, 1, 9, 0),
      hwItemId: "i1",
      hwId: "HW-1",
    };
    const find = jest
      .spyOn(HomeworkStudentRecord, "find")
      .mockReturnValue({ select: () => ({ lean: async () => [rec] }) } as never);
    expect(await sweepHomeworkAutoChase(new Date(2026, 11, 2, 17, 30))).toBe(0);
    expect(find).toHaveBeenCalled();
  });
});

describe("CLASS_NOTE_CHASE", () => {
  it("unwrittenClassNoteSlots (ladder, escalation, in-app prompt) is empty on a paused day", async () => {
    mockPausedOnDate.mockImplementation(async (k: string) => k === "CLASS_NOTE_CHASE");
    jest.spyOn(RoutineSlot, "find").mockImplementation(boom as never);
    expect(await unwrittenClassNoteSlots(new Date(2026, 11, 2))).toEqual([]);
    expect(await myClassNotePrompts(new Date(2026, 11, 2), "t1")).toEqual([]);
  });

  it("outside the window the routine slots are read as before", async () => {
    const chain = { sort: () => ({ lean: async () => [] }) };
    const find = jest.spyOn(RoutineSlot, "find").mockReturnValue(chain as never);
    // The cover overlay + written-note lookups follow; stub them so the suite stays DB-free.
    const selectLean = { select: () => ({ lean: async () => [] }) };
    jest.spyOn(RoutineSubstitution, "find").mockReturnValue(selectLean as never);
    jest.spyOn(ClassNote, "find").mockReturnValue(selectLean as never);
    expect(await unwrittenClassNoteSlots(new Date(2026, 11, 11))).toEqual([]);
    expect(find).toHaveBeenCalled();
  });
});

describe("ASSIGNMENT_GENERATION", () => {
  const termStart = new Date(2026, 0, 4); // a Sunday
  const schedule = { termStartDate: termStart, deliveryDayOfWeek: 4, dueDayOfWeek: 0 } as never;
  const week = weekNumberFor(termStart, new Date(2026, 10, 26)); // week of Thu 26 Nov
  const onlyNov26 = async (k: string, d: Date): Promise<boolean> =>
    k === "ASSIGNMENT_GENERATION" && d.getDate() === 26 && d.getMonth() === 10;

  beforeEach(() => {
    jest.spyOn(HolidayException, "find").mockReturnValue({ lean: async () => [] } as never);
  });

  it("a week delivered on 26 Nov (inside the window) is suspended with no dates", async () => {
    mockPausedOnDate.mockImplementation(onlyNov26);
    const r = await resolveScheduleWeek(schedule, week);
    expect(r.suspended).toBe(true);
    expect(r.deliveryDate).toBeNull();
    expect(r.dueDate).toBeNull();
  });

  it("the week before (delivery 19 Nov, outside) is untouched", async () => {
    mockPausedOnDate.mockImplementation(onlyNov26);
    const r = await resolveScheduleWeek(schedule, week - 1);
    expect(r.suspended).toBe(false);
    expect(r.deliveryDate).not.toBeNull();
  });
});
