/**
 * Student profile SP-2 — the three subject-free panels (prd-student-profile §5.5/§5.6).
 *
 * Pure derivations first (they are where a wrong answer misleads a guardian meeting):
 *   · absentStreakMaxOf — a RUN of absences reads worse than a total;
 *   · monthlyAttendanceOf — the chart series;
 *   · leaveDaysInWindow — inclusive day counting, clipped to the window, by KEY
 *     comparison only (never Date instants — the D-#354 rule);
 *   · attendanceSplitOf — the ONE recent-vs-earlier definition, now shared with the
 *     whole-picture band (D-#359).
 *
 * Then the composed reads with the existing services mocked, pinning that the profile
 * REUSES them rather than re-deriving: uncovered absences exclude leave-covered days,
 * and the comment panel windows by date key + joins author names.
 */
const mockAttendanceHistory = jest.fn();
const mockStudentComments = jest.fn();
const mockTimeline = jest.fn();
const mockLeaveFind = jest.fn();
const mockUserFind = jest.fn();

jest.mock("../modules/attendance/services/AttendanceReportService", () => ({
  studentAttendanceHistory: (...a: unknown[]) => mockAttendanceHistory(...a),
}));
jest.mock("../modules/comments/services/StudentCommentService", () => ({
  studentComments: (...a: unknown[]) => mockStudentComments(...a),
}));
jest.mock("../modules/comments/services/MeetingCommentService", () => ({
  studentCommentTimeline: (...a: unknown[]) => mockTimeline(...a),
}));
jest.mock("../modules/attendance/models/StudentLeaveApplication", () => ({
  StudentLeaveApplication: {
    find: (f: unknown) => ({ sort: () => ({ lean: async () => mockLeaveFind(f) }) }),
  },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    find: (f: unknown) => ({ select: () => ({ lean: async () => mockUserFind(f) }) }),
    findById: () => ({ select: () => ({ lean: async () => null }) }),
  },
}));

import {
  absentStreakMaxOf,
  leaveDaysInWindow,
  monthlyAttendanceOf,
  studentProfileAttendance,
  studentProfileComments,
} from "../modules/trackers/services/StudentProfileContextService";
import { attendanceSplitOf } from "../modules/trackers/services/WholePictureService";

const STUDENT = "64b7f9c2e4b0a1d2c3e4f5a6";
const FROM = "2026-06-01";
const TO = "2026-07-31";

const day = (dateKey: string, absent = false, leaveCovered = false) => ({ dateKey, absent, leaveCovered });

beforeEach(() => {
  jest.clearAllMocks();
  mockLeaveFind.mockReturnValue([]);
  mockUserFind.mockReturnValue([]);
  mockStudentComments.mockResolvedValue([]);
  mockTimeline.mockResolvedValue({
    studentId: STUDENT,
    meetingComments: [],
    rollupSinceLastMeeting: [],
    sinceMeetingId: null,
    sinceMeetingDate: null,
  });
});

describe("absentStreakMaxOf (pure)", () => {
  test("finds the longest consecutive run, not the total", () => {
    const days = [
      day("2026-06-01", true),
      day("2026-06-02", true),
      day("2026-06-03"),
      day("2026-06-04", true),
      day("2026-06-07", true),
      day("2026-06-08", true),
    ];
    expect(absentStreakMaxOf(days)).toBe(3); // the trailing run, not 5
  });

  test("no absences ⇒ 0; all absent ⇒ the length", () => {
    expect(absentStreakMaxOf([day("2026-06-01"), day("2026-06-02")])).toBe(0);
    expect(absentStreakMaxOf([day("2026-06-01", true), day("2026-06-02", true)])).toBe(2);
    expect(absentStreakMaxOf([])).toBe(0);
  });
});

describe("monthlyAttendanceOf (pure)", () => {
  test("groups by YYYY-MM, oldest first, with a per-month percent", () => {
    const rows = monthlyAttendanceOf([
      day("2026-07-02", true),
      day("2026-06-01"),
      day("2026-06-02", true),
      day("2026-06-03"),
      day("2026-06-04"),
      day("2026-07-01"),
    ]);
    expect(rows.map((r) => r.monthKey)).toEqual(["2026-06", "2026-07"]);
    expect(rows[0]).toEqual({ monthKey: "2026-06", markedDays: 4, absentDays: 1, presentPct: 75 });
    expect(rows[1]).toEqual({ monthKey: "2026-07", markedDays: 2, absentDays: 1, presentPct: 50 });
  });

  test("empty input ⇒ no rows (not a zero-filled year)", () => {
    expect(monthlyAttendanceOf([])).toEqual([]);
  });
});

describe("leaveDaysInWindow (pure)", () => {
  test("counts inclusively", () => {
    expect(leaveDaysInWindow({ fromKey: "2026-06-10", toKey: "2026-06-12" }, FROM, TO)).toBe(3);
    expect(leaveDaysInWindow({ fromKey: "2026-06-10", toKey: "2026-06-10" }, FROM, TO)).toBe(1);
  });

  test("clips a leave that overhangs the window on either side", () => {
    expect(leaveDaysInWindow({ fromKey: "2026-05-28", toKey: "2026-06-02" }, FROM, TO)).toBe(2);
    expect(leaveDaysInWindow({ fromKey: "2026-07-30", toKey: "2026-08-04" }, FROM, TO)).toBe(2);
  });

  test("a leave entirely outside the window counts 0", () => {
    expect(leaveDaysInWindow({ fromKey: "2026-04-01", toKey: "2026-04-05" }, FROM, TO)).toBe(0);
  });

  test("spans a month boundary and a leap-ish month end correctly", () => {
    expect(leaveDaysInWindow({ fromKey: "2026-06-29", toKey: "2026-07-02" }, FROM, TO)).toBe(4);
  });
});

describe("attendanceSplitOf (pure, shared with the whole picture)", () => {
  test("a decline shows in the recent half before the average moves", () => {
    const days = [
      day("2026-06-01"), day("2026-06-02"), day("2026-06-03"), day("2026-06-04"),
      day("2026-06-05", true), day("2026-06-08", true), day("2026-06-09", true), day("2026-06-10"),
    ];
    const split = attendanceSplitOf(days);
    expect(split.earlierPresentPct).toBe(100);
    expect(split.recentPresentPct).toBe(25);
    expect(split.trajectory).toBe("down");
  });

  test("too few days ⇒ nulls and no verdict", () => {
    expect(attendanceSplitOf([])).toEqual({
      recentPresentPct: null,
      earlierPresentPct: null,
      trajectory: "na",
    });
  });
});

describe("studentProfileAttendance", () => {
  test("uncovered absences EXCLUDE leave-covered days; totals come from the existing read", async () => {
    mockAttendanceHistory.mockResolvedValue({
      studentId: STUDENT,
      sectionId: "sec",
      markedDays: 5,
      absentDays: 3,
      presentPct: 40,
      days: [
        day("2026-06-01"),
        day("2026-06-02", true, true), // covered by leave
        day("2026-06-03", true, true), // covered by leave
        day("2026-06-04", true), // NOT covered
        day("2026-06-05"),
      ],
    });
    mockLeaveFind.mockReturnValue([
      {
        _id: { toString: () => "leave1" },
        fromKey: "2026-06-02",
        toKey: "2026-06-03",
        reason: "জ্বর",
        submittedAt: new Date(2026, 5, 2),
      },
    ]);

    const p = await studentProfileAttendance(STUDENT, FROM, TO);
    expect(p.markedDays).toBe(5);
    expect(p.absentDays).toBe(3);
    expect(p.absentUncoveredDays).toBe(1); // the truancy number
    expect(p.absentStreakMax).toBe(3);
    expect(p.monthly).toHaveLength(1);
    expect(p.leaves[0]).toMatchObject({ leaveId: "leave1", reason: "জ্বর", daysInWindow: 2 });
    // The overlap query must be a two-sided range, or a leave spanning the window edge is missed.
    expect(mockLeaveFind.mock.calls[0][0]).toMatchObject({
      fromKey: { $lte: TO },
      toKey: { $gte: FROM },
    });
  });

  test("an unmarked window yields zeros, no rows, and no crash", async () => {
    mockAttendanceHistory.mockResolvedValue({
      studentId: STUDENT, sectionId: "sec", markedDays: 0, absentDays: 0, presentPct: 0, days: [],
    });
    const p = await studentProfileAttendance(STUDENT, FROM, TO);
    expect(p.presentPct).toBe(0);
    expect(p.absentStreakMax).toBe(0);
    expect(p.monthly).toEqual([]);
    expect(p.trajectory).toBe("na");
  });
});

describe("studentProfileComments", () => {
  const comment = (over: Record<string, unknown> = {}) => ({
    id: "c1",
    studentId: STUDENT,
    sectionId: "sec",
    authorUserId: "64b7f9c2e4b0a1d2c3e4f5b1",
    type: "BEHAVIOUR",
    sentiment: "CONCERN",
    text: "ক্লাসে মনোযোগ কম",
    attachmentIds: [],
    deliveredAt: null,
    deliveryChannels: [],
    createdAt: new Date(2026, 5, 15, 10).toISOString(),
    updatedAt: new Date(2026, 5, 15, 10).toISOString(),
    ...over,
  });

  test("windows by DATE KEY and tallies sentiment + undelivered", async () => {
    mockStudentComments.mockResolvedValue([
      comment({ id: "in1" }),
      comment({ id: "in2", sentiment: "POSITIVE", deliveredAt: new Date(2026, 5, 16).toISOString() }),
      comment({ id: "out", createdAt: new Date(2026, 3, 2).toISOString() }), // before FROM
    ]);
    mockUserFind.mockReturnValue([
      { _id: { toString: () => "64b7f9c2e4b0a1d2c3e4f5b1" }, name: "Nuha Karim" },
    ]);

    const p = await studentProfileComments(STUDENT, FROM, TO);
    expect(p.comments.map((c) => c.id)).toEqual(["in1", "in2"]);
    expect(p.tally).toEqual({ total: 2, concern: 1, positive: 1, undelivered: 1 });
    expect(p.comments[0].authorName).toBe("Nuha Karim");
  });

  test("a comment on the window's LAST day is included (inclusive bounds)", async () => {
    mockStudentComments.mockResolvedValue([
      comment({ id: "edge", createdAt: new Date(2026, 6, 31, 23, 30).toISOString() }),
    ]);
    const p = await studentProfileComments(STUDENT, FROM, TO);
    expect(p.comments.map((c) => c.id)).toEqual(["edge"]);
  });

  test("meeting notes ride along from the existing CM-5 timeline (not re-derived)", async () => {
    mockTimeline.mockResolvedValue({
      studentId: STUDENT,
      meetingComments: [
        {
          id: "m1", meetingId: "mt1", instanceLabel: "১ম সভা", meetingDate: "2026-05-10T00:00:00.000Z",
          studentId: STUDENT, authorUserId: "u1", positiveText: "আদব ভালো", concernText: "গণিতে দুর্বল",
          createdAt: "2026-05-10T00:00:00.000Z", updatedAt: "2026-05-10T00:00:00.000Z",
        },
      ],
      rollupSinceLastMeeting: [],
      sinceMeetingId: "mt1",
      sinceMeetingDate: "2026-05-10T00:00:00.000Z",
    });

    const p = await studentProfileComments(STUDENT, FROM, TO);
    expect(mockTimeline).toHaveBeenCalledWith(STUDENT);
    expect(p.timeline.meetingComments[0].concernText).toBe("গণিতে দুর্বল");
    expect(p.timeline.sinceMeetingDate).toBe("2026-05-10T00:00:00.000Z");
  });

  test("no author rows ⇒ authorName is null, never a crash", async () => {
    mockStudentComments.mockResolvedValue([comment()]);
    mockUserFind.mockReturnValue([]);
    const p = await studentProfileComments(STUDENT, FROM, TO);
    expect(p.comments[0].authorName).toBeNull();
  });
});
