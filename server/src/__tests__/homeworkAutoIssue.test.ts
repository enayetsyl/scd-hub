/**
 * D-#314 — homework auto-issue sweep.
 *
 * The system confirms a class's day ONLY when nothing is left for the human:
 *   - attendance fully captured (roster is real; incomplete → defer)
 *   - the confirm's own gates pass (coverage D-#310, ceiling, double-issue);
 *     any throw = defer silently (the pending ladder keeps nagging)
 *   - actor = the all-zero system sentinel, autoIssued stamped
 *   - the confirmer is notified once per class+day
 *
 * DB-free: models + confirm + emitter mocked; the sweep's orchestration is real.
 */
import mongoose from "mongoose";

const mockItemFind = jest.fn();
jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: { find: (f: unknown) => ({ select: () => ({ lean: () => mockItemFind(f) }) }) },
}));

const mockReconFind = jest.fn();
jest.mock("../modules/trackers/models/HomeworkReconciliation", () => ({
  HomeworkReconciliation: { find: (f: unknown) => ({ select: () => ({ lean: () => mockReconFind(f) }) }) },
  reconDayKey: (date: Date) => {
    const d = new Date(date.getTime());
    d.setHours(0, 0, 0, 0);
    return d;
  },
}));

const mockStudentFind = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: (f: unknown) => ({ select: () => ({ lean: () => mockStudentFind(f) }) }) },
}));

const mockDayFind = jest.fn();
jest.mock("../modules/attendance/models/StudentAttendanceDay", () => ({
  StudentAttendanceDay: { find: (f: unknown) => ({ lean: () => mockDayFind(f) }) },
}));

const mockResolveUnits = jest.fn();
jest.mock("../modules/attendance/attendanceUnit", () => ({
  resolveUnits: (...a: unknown[]) => mockResolveUnits(...a),
  unitKey: (u: { unitType: string; unitId: string }) => `${u.unitType}:${u.unitId}`,
}));

const mockConfirm = jest.fn();
jest.mock("../modules/trackers/services/HomeworkReconciliationService", () => ({
  confirmHomeworkDay: (...a: unknown[]) => mockConfirm(...a),
}));

const mockEmitAutoIssued = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/notifications/services/emitters", () => ({
  emitHwAutoIssued: (...a: unknown[]) => mockEmitAutoIssued(...a),
}));

// Import AFTER mocks
import {
  sweepHomeworkAutoIssue,
  buildIssueRoster,
  HW_AUTO_ISSUE_ACTOR_ID,
} from "../modules/trackers/services/HomeworkAutoIssueService";

const oid = () => new mongoose.Types.ObjectId();
const CLASS_ID = oid();
const SECTION_ID = oid();
const S1 = oid();
const S2 = oid();
const NOW = new Date(2026, 6, 14, 13, 0, 0); // Tue 13:00 local

const student = (id: mongoose.Types.ObjectId) => ({ _id: id, sectionId: SECTION_ID, classId: CLASS_ID });

beforeEach(() => {
  jest.clearAllMocks();
  mockItemFind.mockResolvedValue([{ classId: CLASS_ID, sectionId: SECTION_ID }]);
  mockReconFind.mockResolvedValue([]);
  mockStudentFind.mockResolvedValue([student(S1), student(S2)]);
  // Both students attend via their section; the section's day record is marked.
  mockResolveUnits.mockResolvedValue(
    new Map([
      [S1.toString(), { unitType: "section", unitId: SECTION_ID.toString() }],
      [S2.toString(), { unitType: "section", unitId: SECTION_ID.toString() }],
    ]),
  );
  mockDayFind.mockResolvedValue([{ sectionId: SECTION_ID, absentStudentIds: [S2] }]);
  mockConfirm.mockResolvedValue({ issuedItems: 3, dayTotal: 90 });
});

describe("D-#314 buildIssueRoster", () => {
  test("attendance-backed roster: marked unit + absent flag per student", async () => {
    const roster = await buildIssueRoster(SECTION_ID.toString(), "2026-07-14");
    expect(roster).toEqual([
      { studentId: S1.toString(), present: true },
      { studentId: S2.toString(), present: false },
    ]);
  });

  test("ANY student without a marked unit → null (defer, never guess)", async () => {
    mockDayFind.mockResolvedValue([]); // nothing marked today
    expect(await buildIssueRoster(SECTION_ID.toString(), "2026-07-14")).toBeNull();
  });
});

describe("D-#314 sweepHomeworkAutoIssue", () => {
  test("a ready class is confirmed with the system actor + autoIssued and the confirmer notified", async () => {
    const res = await sweepHomeworkAutoIssue(NOW);
    expect(res).toEqual({ issued: 1, deferred: 0 });
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    const input = mockConfirm.mock.calls[0][0] as {
      classId: string;
      actorId: string;
      autoIssued: boolean;
      roster: Array<{ studentId: string; present: boolean }>;
    };
    expect(input.classId).toBe(CLASS_ID.toString());
    expect(input.actorId).toBe(HW_AUTO_ISSUE_ACTOR_ID);
    expect(input.autoIssued).toBe(true);
    expect(input.roster).toContainEqual({ studentId: S2.toString(), present: false });
    expect(mockEmitAutoIssued).toHaveBeenCalledWith(
      expect.objectContaining({ classId: CLASS_ID.toString(), issuedItems: 3, dayTotal: 90 }),
    );
  });

  test("attendance incomplete → deferred; confirm never runs", async () => {
    mockDayFind.mockResolvedValue([]);
    const res = await sweepHomeworkAutoIssue(NOW);
    expect(res).toEqual({ issued: 0, deferred: 1 });
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockEmitAutoIssued).not.toHaveBeenCalled();
  });

  test("a confirm-gate throw (coverage / ceiling / raced confirm) defers silently", async () => {
    mockConfirm.mockRejectedValue(new Error("Day total 130 min exceeds the 120-min ceiling"));
    const res = await sweepHomeworkAutoIssue(NOW);
    expect(res).toEqual({ issued: 0, deferred: 1 });
    expect(mockEmitAutoIssued).not.toHaveBeenCalled();
  });

  test("an already-reconciled class is filtered before any confirm attempt", async () => {
    mockReconFind.mockResolvedValue([{ classId: CLASS_ID }]);
    const res = await sweepHomeworkAutoIssue(NOW);
    expect(res).toEqual({ issued: 0, deferred: 0 });
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  test("no declared items today → nothing to do", async () => {
    mockItemFind.mockResolvedValue([]);
    const res = await sweepHomeworkAutoIssue(NOW);
    expect(res).toEqual({ issued: 0, deferred: 0 });
    expect(mockStudentFind).not.toHaveBeenCalled();
  });
});
