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
