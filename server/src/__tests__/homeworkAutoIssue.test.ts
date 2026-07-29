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
  autoIssueWindow,
  HW_AUTO_ISSUE_LOOKBACK_SCHOOL_DAYS,
} from "../modules/trackers/services/HomeworkAutoIssueService";

const oid = () => new mongoose.Types.ObjectId();
const CLASS_ID = oid();
const SECTION_ID = oid();
const S1 = oid();
const S2 = oid();
const NOW = new Date(2026, 6, 14, 13, 0, 0); // Tue 13:00 local

const student = (id: mongoose.Types.ObjectId) => ({ _id: id, sectionId: SECTION_ID, classId: CLASS_ID });

/** Midnight of a Date, the key the sweep's per-day query is built from. */
const midnight = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * D-#389: the sweep now queries ONE DAY AT A TIME across a lookback window, so a
 * blanket mockResolvedValue would hand the same class back on all five days and
 * every count would be 5×. This helper answers only for the days named, which is
 * what "there is a declared item on day X" actually means.
 */
function declaredOn(days: Date[]): void {
  const wanted = new Set(days.map(midnight));
  mockItemFind.mockImplementation((filter: { dateGiven?: { $gte?: Date } }) => {
    const from = filter?.dateGiven?.$gte;
    if (!from || !wanted.has(midnight(from))) return Promise.resolve([]);
    return Promise.resolve([{ classId: CLASS_ID, sectionId: SECTION_ID }]);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  declaredOn([NOW]);
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

  test("D-#319: a reconciled class with still-declared items gets a top-up confirm attempt", async () => {
    // The class map is built FROM still-declared items, so a reconciled class in
    // it is by definition a late top-up candidate — the sweep no longer filters
    // it out; confirm itself refuses fully-issued days.
    mockReconFind.mockResolvedValue([{ classId: CLASS_ID }]);
    const res = await sweepHomeworkAutoIssue(NOW);
    expect(res).toEqual({ issued: 1, deferred: 0 });
    expect(mockConfirm).toHaveBeenCalledTimes(1);
  });

  test("no declared items today → nothing to do", async () => {
    mockItemFind.mockResolvedValue([]);
    const res = await sweepHomeworkAutoIssue(NOW);
    expect(res).toEqual({ issued: 0, deferred: 0 });
    expect(mockStudentFind).not.toHaveBeenCalled();
  });
});

/**
 * D-#389 — the sweep looks back over recent school days, not just today.
 *
 * The bug it closes: the sweep queried `dateGiven` = TODAY only and ran 12:00–17:00,
 * so a class whose last declaration or attendance landed after 17:00 was never looked
 * at again and its items stayed `declared` forever. 6 of the 24 items purged on
 * 2026-07-28 died that way with every gate passing.
 */
describe("D-#389 lookback window", () => {
  test("returns school days only, newest first, bounded by the lookback", () => {
    // Tue 2026-07-14. Walking back: Tue, Mon, Sun, then Sat+Fri are NOT school days,
    // so the window must skip them and reach back into the prior week.
    const days = autoIssueWindow(NOW);
    expect(days).toHaveLength(HW_AUTO_ISSUE_LOOKBACK_SCHOOL_DAYS);
    expect(days.every((d) => d.getDay() !== 5 && d.getDay() !== 6)).toBe(true);
    for (let i = 1; i < days.length; i += 1) {
      expect(days[i].getTime()).toBeLessThan(days[i - 1].getTime());
    }
    expect(days[0].getDate()).toBe(NOW.getDate()); // today is included
  });

  test("a day stranded BEFORE today is still recovered", async () => {
    const twoSchoolDaysAgo = autoIssueWindow(NOW)[2];
    declaredOn([twoSchoolDaysAgo]); // nothing declared today at all

    const res = await sweepHomeworkAutoIssue(NOW);

    expect(res).toEqual({ issued: 1, deferred: 0 });
    // Confirmed as ITSELF — the stale day, never `now`.
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    const { date } = mockConfirm.mock.calls[0][0];
    expect(midnight(date)).toBe(midnight(twoSchoolDaysAgo));
  });

  test("each day's roster is built from THAT day's attendance", async () => {
    const older = autoIssueWindow(NOW)[1];
    declaredOn([older]);

    await sweepHomeworkAutoIssue(NOW);

    // buildIssueRoster keys attendance by dateKey; using today's would spawn records
    // off the wrong day's absentees.
    const dateKeys = mockDayFind.mock.calls.map((c) => (c[0] as { dateKey: string }).dateKey);
    expect(dateKeys.every((k) => k !== undefined)).toBe(true);
    expect(new Set(dateKeys).size).toBe(1);
    expect(dateKeys[0]).not.toBe("2026-07-14"); // not today
  });

  test("several stranded days are each issued once", async () => {
    const w = autoIssueWindow(NOW);
    declaredOn([w[0], w[2], w[3]]);

    const res = await sweepHomeworkAutoIssue(NOW);

    expect(res).toEqual({ issued: 3, deferred: 0 });
    expect(mockConfirm).toHaveBeenCalledTimes(3);
  });

  test("a quiet window costs nothing beyond the per-day item query", async () => {
    declaredOn([]);
    const res = await sweepHomeworkAutoIssue(NOW);
    expect(res).toEqual({ issued: 0, deferred: 0 });
    expect(mockItemFind).toHaveBeenCalledTimes(HW_AUTO_ISSUE_LOOKBACK_SCHOOL_DAYS);
    expect(mockStudentFind).not.toHaveBeenCalled();
  });
});
