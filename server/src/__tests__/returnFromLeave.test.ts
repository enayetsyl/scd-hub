/**
 * RL-1/RL-2 tests — the return-from-leave card and its push (D-#552/#553).
 *
 * The rules that matter:
 *   - "back today" = absent on the last MARKED day, not absent today
 *   - the two groups are never mixed: ABSENT_REDELIVER is "hand it out",
 *     DUE/CHASE is "take it in"
 *   - a student with nothing outstanding is not a card row
 *   - a subject teacher sees only their own subject's items
 *   - EXPECTED (leave register) is card-only and is NEVER the push's source
 *
 * DB-free: every model is mocked.
 */
import mongoose from "mongoose";

const mockAttFind = jest.fn();
const mockLeaveFind = jest.fn();
const mockStudentFind = jest.fn();
const mockHwFind = jest.fn();
const mockAsFind = jest.fn();
const mockHwItemFind = jest.fn();
const mockAsItemFind = jest.fn();

jest.mock("../modules/attendance/models/StudentAttendanceDay", () => ({
  StudentAttendanceDay: {
    find: (q: unknown) => ({
      sort: () => ({ limit: () => ({ lean: () => mockAttFind(q) }) }),
    }),
  },
}));
jest.mock("../modules/attendance/models/StudentLeaveApplication", () => ({
  StudentLeaveApplication: {
    find: (q: unknown) => ({ select: () => ({ lean: () => mockLeaveFind(q) }) }),
  },
}));
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: (q: unknown) => ({ select: () => ({ lean: () => mockStudentFind(q) }) }) },
}));
jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: { find: (q: unknown) => ({ lean: () => mockHwFind(q) }) },
}));
jest.mock("../modules/trackers/models/AssignmentStudentRecord", () => ({
  AssignmentStudentRecord: { find: (q: unknown) => ({ lean: () => mockAsFind(q) }) },
}));
jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: { find: (q: unknown) => ({ select: () => ({ lean: () => mockHwItemFind(q) }) }) },
}));
jest.mock("../modules/trackers/models/AssignmentItem", () => ({
  AssignmentItem: { find: (q: unknown) => ({ select: () => ({ lean: () => mockAsItemFind(q) }) }) },
}));

import {
  returningStudentsFor,
  attendanceConfirmedReturns,
  previousSchoolDayKey,
} from "../modules/trackers/services/ReturnFromLeaveService";

const oid = () => new mongoose.Types.ObjectId();
const SECTION = oid();
const AYESHA = oid();
const RAIHAN = oid();
const HW_ITEM = oid();
const AS_ITEM = oid();

beforeEach(() => {
  jest.clearAllMocks();
  mockAttFind.mockResolvedValue([]);
  mockLeaveFind.mockResolvedValue([]);
  mockStudentFind.mockResolvedValue([
    { _id: AYESHA, nameBn: "আয়েশা সিদ্দিকা", sectionId: SECTION },
    { _id: RAIHAN, nameBn: "রায়হান কবির", sectionId: SECTION },
  ]);
  mockHwFind.mockResolvedValue([]);
  mockAsFind.mockResolvedValue([]);
  mockHwItemFind.mockResolvedValue([]);
  mockAsItemFind.mockResolvedValue([]);
});

/** Sun–Thu open, Fri/Sat closed. */
const isOpen = async (d: Date) => d.getDay() !== 5 && d.getDay() !== 6;

describe("attendanceConfirmedReturns — who is actually back", () => {
  test("absent on the last marked day, present today → returning", async () => {
    mockAttFind.mockResolvedValue([
      { sectionId: SECTION, dateKey: "2026-08-25", absentStudentIds: [] },
      { sectionId: SECTION, dateKey: "2026-08-24", absentStudentIds: [AYESHA] },
      { sectionId: SECTION, dateKey: "2026-08-23", absentStudentIds: [AYESHA] },
    ]);
    const back = await attendanceConfirmedReturns([SECTION.toString()], "2026-08-25");
    expect(back.has(AYESHA.toString())).toBe(true);
    expect(back.get(AYESHA.toString())!.daysAbsent).toBe(2);
  });

  test("still absent today → NOT returning", async () => {
    mockAttFind.mockResolvedValue([
      { sectionId: SECTION, dateKey: "2026-08-25", absentStudentIds: [AYESHA] },
      { sectionId: SECTION, dateKey: "2026-08-24", absentStudentIds: [AYESHA] },
    ]);
    const back = await attendanceConfirmedReturns([SECTION.toString()], "2026-08-25");
    expect(back.size).toBe(0);
  });

  test("present all along → not returning", async () => {
    mockAttFind.mockResolvedValue([
      { sectionId: SECTION, dateKey: "2026-08-25", absentStudentIds: [] },
      { sectionId: SECTION, dateKey: "2026-08-24", absentStudentIds: [] },
    ]);
    const back = await attendanceConfirmedReturns([SECTION.toString()], "2026-08-25");
    expect(back.size).toBe(0);
  });

  test("today not marked yet → nothing confirmed (the card's EXPECTED half covers it)", async () => {
    mockAttFind.mockResolvedValue([
      { sectionId: SECTION, dateKey: "2026-08-24", absentStudentIds: [AYESHA] },
    ]);
    const back = await attendanceConfirmedReturns([SECTION.toString()], "2026-08-25");
    expect(back.size).toBe(0);
  });
});

describe("returningStudentsFor — the card", () => {
  function backYesterday() {
    mockAttFind.mockResolvedValue([
      { sectionId: SECTION, dateKey: "2026-08-25", absentStudentIds: [] },
      { sectionId: SECTION, dateKey: "2026-08-24", absentStudentIds: [AYESHA] },
    ]);
  }

  test("the two groups are split, never mixed", async () => {
    backYesterday();
    mockHwFind.mockResolvedValue([
      { _id: oid(), studentId: AYESHA, hwId: "HW-1", hwItemId: HW_ITEM, state: "ABSENT_REDELIVER", chaseCount: 0 },
      { _id: oid(), studentId: AYESHA, hwId: "HW-2", hwItemId: HW_ITEM, state: "CHASE", chaseCount: 1 },
    ]);
    mockHwItemFind.mockResolvedValue([{ _id: HW_ITEM, subject: "MATH", description: "d" }]);

    const rows = await returningStudentsFor([SECTION.toString()], "2026-08-25", "2026-08-24");
    expect(rows).toHaveLength(1);
    const groups = rows[0].items.map((i) => i.group).sort();
    expect(groups).toEqual(["COLLECT", "REDELIVER"]);
  });

  test("a returning student with NOTHING outstanding is not a row", async () => {
    backYesterday();
    const rows = await returningStudentsFor([SECTION.toString()], "2026-08-25", "2026-08-24");
    expect(rows).toEqual([]);
  });

  test("assignments appear beside homework", async () => {
    backYesterday();
    mockAsFind.mockResolvedValue([
      { _id: oid(), studentId: AYESHA, asId: "AS-1", asItemId: AS_ITEM, state: "ABSENT_REDELIVER", chaseCount: 0 },
    ]);
    mockAsItemFind.mockResolvedValue([{ _id: AS_ITEM, subject: "BAN", title: "t" }]);
    const rows = await returningStudentsFor([SECTION.toString()], "2026-08-25", "2026-08-24");
    expect(rows[0].items[0].tracker).toBe("ASSIGNMENT");
  });

  test("a SUBJECT teacher sees only their own subject's items (D-#553)", async () => {
    backYesterday();
    const mathItem = oid();
    const banItem = oid();
    mockHwFind.mockResolvedValue([
      { _id: oid(), studentId: AYESHA, hwId: "HW-M", hwItemId: mathItem, state: "CHASE", chaseCount: 1 },
      { _id: oid(), studentId: AYESHA, hwId: "HW-B", hwItemId: banItem, state: "CHASE", chaseCount: 1 },
    ]);
    mockHwItemFind.mockResolvedValue([
      { _id: mathItem, subject: "MATH", description: null },
      { _id: banItem, subject: "BAN", description: null },
    ]);

    const rows = await returningStudentsFor([SECTION.toString()], "2026-08-25", "2026-08-24", ["MATH"]);
    expect(rows[0].items).toHaveLength(1);
    expect(rows[0].items[0].subject).toBe("MATH");
  });

  test("the leave register alone yields an EXPECTED row — the morning signal", async () => {
    mockAttFind.mockResolvedValue([]); // nothing marked yet
    mockLeaveFind.mockResolvedValue([{ studentId: RAIHAN, toKey: "2026-08-24" }]);
    mockHwFind.mockResolvedValue([
      { _id: oid(), studentId: RAIHAN, hwId: "HW-9", hwItemId: HW_ITEM, state: "ABSENT_REDELIVER", chaseCount: 0 },
    ]);
    mockHwItemFind.mockResolvedValue([{ _id: HW_ITEM, subject: "MATH", description: null }]);

    const rows = await returningStudentsFor([SECTION.toString()], "2026-08-25", "2026-08-24");
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("EXPECTED");
    expect(rows[0].leaveEndedKey).toBe("2026-08-24");
  });

  test("a student on BOTH sources appears once, as RETURNED", async () => {
    backYesterday();
    mockLeaveFind.mockResolvedValue([{ studentId: AYESHA, toKey: "2026-08-24" }]);
    mockHwFind.mockResolvedValue([
      { _id: oid(), studentId: AYESHA, hwId: "HW-1", hwItemId: HW_ITEM, state: "CHASE", chaseCount: 1 },
    ]);
    mockHwItemFind.mockResolvedValue([{ _id: HW_ITEM, subject: "MATH", description: null }]);

    const rows = await returningStudentsFor([SECTION.toString()], "2026-08-25", "2026-08-24");
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("RETURNED");
  });

  test("no sections is a cheap no-op", async () => {
    expect(await returningStudentsFor([], "2026-08-25", "2026-08-24")).toEqual([]);
  });
});

describe("previousSchoolDayKey", () => {
  test("Sunday looks back past Fri/Sat to Thursday", async () => {
    // 2026-08-30 is a Sunday; 08-27 the Thursday before.
    expect(await previousSchoolDayKey(new Date("2026-08-30T08:00:00"), isOpen)).toBe("2026-08-27");
  });

  test("Tuesday looks back one day", async () => {
    expect(await previousSchoolDayKey(new Date("2026-08-25T08:00:00"), isOpen)).toBe("2026-08-24");
  });
});
