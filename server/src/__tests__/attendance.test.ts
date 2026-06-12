/**
 * AT-2/AT-3/AT-5 — student attendance capture, marker gate (CT-2), leave
 * linkage + history roll-up (prd-attendance §6/§8, D-#63–#67). Pure helpers
 * exercised directly; services run against mocked models (DB-free).
 */
import mongoose from "mongoose";

const mockSectionFindById = jest.fn();
const mockStudentFind = jest.fn();
const mockStudentFindById = jest.fn();
const mockUserFindById = jest.fn();
const mockAssignFind = jest.fn();
const mockAssignCreate = jest.fn();
const mockDayFindOne = jest.fn();
const mockDayCreate = jest.fn();
const mockLeaveCreate = jest.fn();
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);
const mockResolveDayType = jest.fn();

jest.mock("../modules/foundation/models/Section", () => ({
  Section: { findById: (id: unknown) => ({ lean: () => mockSectionFindById(id) }) },
}));
jest.mock("../modules/foundation/models/Student", () => ({
  Student: {
    find: (f: unknown) => mockStudentFind(f),
    findById: (id: unknown) => ({ lean: () => mockStudentFindById(id) }),
  },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { findById: (id: unknown) => ({ lean: () => mockUserFindById(id) }) },
}));
jest.mock("../modules/attendance/models/SectionAttendanceAssignment", () => ({
  SectionAttendanceAssignment: {
    find: (f: unknown) => mockAssignFind(f),
    create: (d: unknown) => mockAssignCreate(d),
  },
}));
jest.mock("../modules/attendance/models/StudentAttendanceDay", () => ({
  StudentAttendanceDay: {
    findOne: (f: unknown) => mockDayFindOne(f),
    create: (d: unknown) => mockDayCreate(d),
  },
}));
jest.mock("../modules/attendance/models/StudentLeaveApplication", () => ({
  StudentLeaveApplication: { create: (d: unknown) => mockLeaveCreate(d) },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));
jest.mock("../modules/routine/calendar", () => ({
  resolveDayType: (d: Date) => mockResolveDayType(d),
}));

import {
  pickCoveringAssignment,
  markerForDate,
  assignSectionMarker,
  markSectionAttendance,
  amendStudentAttendance,
  AttendanceError,
} from "../modules/attendance/services/StudentAttendanceService";
import {
  applicationCovers,
  submitLeaveApplication,
} from "../modules/attendance/services/LeaveApplicationService";
import { buildStudentHistory } from "../modules/attendance/services/AttendanceReportService";
import { ForbiddenError } from "../middleware/authz";
import type { AppContext } from "../context";

const SECTION = new mongoose.Types.ObjectId();
const TEACHER = new mongoose.Types.ObjectId();
const OTHER = new mongoose.Types.ObjectId();
const STUDENT_A = new mongoose.Types.ObjectId();
const STUDENT_B = new mongoose.Types.ObjectId();
const ACTOR = new mongoose.Types.ObjectId().toString();

const teacherCtx = (userId: string): AppContext =>
  ({ auth: { userId, role: "TEACHER" } }) as unknown as AppContext;

const lean = (v: unknown) => ({ lean: () => Promise.resolve(v) });
const selectLean = (v: unknown) => ({
  select: () => ({ lean: () => Promise.resolve(v) }),
  lean: () => Promise.resolve(v),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveDayType.mockResolvedValue("FULL");
});

// ---------------------------------------------------------------------------
// Marker resolution (CT-2, AT2.1/AT2.2)
// ---------------------------------------------------------------------------

describe("pickCoveringAssignment (pure)", () => {
  const a = (teacherId: string, fromKey: string, toKey: string, createdAt: string) => ({
    teacherId,
    fromKey,
    toKey,
    createdAt: new Date(createdAt),
  });

  test("returns null when nothing covers the date", () => {
    expect(pickCoveringAssignment([a("t1", "2026-06-01", "2026-06-05", "2026-06-01")], "2026-06-10")).toBeNull();
  });

  test("the latest-created covering assignment wins an overlap", () => {
    const winner = pickCoveringAssignment(
      [
        a("t1", "2026-06-01", "2026-06-30", "2026-06-01"),
        a("t2", "2026-06-10", "2026-06-12", "2026-06-09"),
      ],
      "2026-06-11",
    );
    expect(winner?.teacherId).toBe("t2");
  });
});

describe("markerForDate — override else class teacher (AT2.2)", () => {
  test("a covering assignment overrides the class teacher", async () => {
    mockAssignFind.mockReturnValue(
      lean([{ teacherId: OTHER, fromKey: "2026-06-11", toKey: "2026-06-11", createdAt: new Date() }]),
    );
    const marker = await markerForDate(SECTION.toString(), "2026-06-11");
    expect(marker).toEqual({ teacherId: OTHER.toString(), source: "assignment" });
  });

  test("falls back to the section's class teacher; null when unassigned", async () => {
    mockAssignFind.mockReturnValue(lean([]));
    mockSectionFindById.mockResolvedValueOnce({ _id: SECTION, classTeacherId: TEACHER });
    expect(await markerForDate(SECTION.toString(), "2026-06-11")).toEqual({
      teacherId: TEACHER.toString(),
      source: "class_teacher",
    });
    mockAssignFind.mockReturnValue(lean([]));
    mockSectionFindById.mockResolvedValueOnce({ _id: SECTION, classTeacherId: null });
    expect((await markerForDate(SECTION.toString(), "2026-06-11")).teacherId).toBeNull();
  });
});

describe("assignSectionMarker (AT2.1)", () => {
  test("validates the assignee is a TEACHER and audits the assignment", async () => {
    mockSectionFindById.mockResolvedValue({ _id: SECTION });
    mockUserFindById.mockResolvedValue({ _id: OTHER, role: "TEACHER" });
    mockAssignCreate.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });

    await assignSectionMarker(SECTION.toString(), OTHER.toString(), "2026-06-11", "2026-06-12", ACTOR);
    expect(mockAssignCreate).toHaveBeenCalledWith(
      expect.objectContaining({ fromKey: "2026-06-11", toKey: "2026-06-12", active: true }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "ATTENDANCE_MARKER_ASSIGNED" }),
    );
  });

  test("rejects a non-teacher assignee and an inverted range", async () => {
    mockSectionFindById.mockResolvedValue({ _id: SECTION });
    mockUserFindById.mockResolvedValue({ _id: OTHER, role: "OFFICE" });
    await expect(
      assignSectionMarker(SECTION.toString(), OTHER.toString(), "2026-06-11", "2026-06-11", ACTOR),
    ).rejects.toThrow(AttendanceError);
    await expect(
      assignSectionMarker(SECTION.toString(), OTHER.toString(), "2026-06-12", "2026-06-11", ACTOR),
    ).rejects.toThrow(AttendanceError);
  });
});

// ---------------------------------------------------------------------------
// Marking (AT2.3/AT2.4 + O2 lock)
// ---------------------------------------------------------------------------

describe("markSectionAttendance", () => {
  const NOW = new Date(2026, 5, 11, 11, 30); // Thu 2026-06-11, a FULL day
  const asMarker = () => {
    mockAssignFind.mockReturnValue(lean([]));
    mockSectionFindById.mockResolvedValue({ _id: SECTION, classTeacherId: TEACHER });
  };

  test("the marker writes today's absent-only record (everyone else present)", async () => {
    asMarker();
    mockStudentFind.mockReturnValue(selectLean([{ _id: STUDENT_A }]));
    mockDayFindOne.mockResolvedValue(null);
    mockDayCreate.mockImplementation((d) => Promise.resolve({ _id: new mongoose.Types.ObjectId(), ...d }));

    const day = await markSectionAttendance(
      teacherCtx(TEACHER.toString()),
      SECTION.toString(),
      "2026-06-11",
      [STUDENT_A.toString()],
      NOW,
    );
    expect(day.absentStudentIds).toHaveLength(1);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "ATTENDANCE_MARKED", meta: expect.objectContaining({ absent: 1, amended: false }) }),
    );
  });

  test("a non-marker is denied (CT-2) — even another teacher", async () => {
    asMarker();
    await expect(
      markSectionAttendance(teacherCtx(OTHER.toString()), SECTION.toString(), "2026-06-11", [], NOW),
    ).rejects.toThrow(ForbiddenError);
  });

  test("same-day re-mark overwrites (editable until end of day, O2)", async () => {
    asMarker();
    mockStudentFind.mockReturnValue(selectLean([{ _id: STUDENT_B }]));
    const existing = {
      absentStudentIds: [STUDENT_A],
      markedBy: TEACHER,
      markedAt: NOW,
      save: jest.fn().mockImplementation(function (this: Record<string, unknown>) {
        return Promise.resolve({ ...this, _id: new mongoose.Types.ObjectId() });
      }),
    };
    mockDayFindOne.mockResolvedValue(existing);

    await markSectionAttendance(
      teacherCtx(TEACHER.toString()),
      SECTION.toString(),
      "2026-06-11",
      [STUDENT_B.toString()],
      NOW,
    );
    expect(existing.save).toHaveBeenCalled();
    expect(existing.absentStudentIds.map(String)).toEqual([STUDENT_B.toString()]);
  });

  test("past days are locked for the marker (O2) and future days reject", async () => {
    asMarker();
    await expect(
      markSectionAttendance(teacherCtx(TEACHER.toString()), SECTION.toString(), "2026-06-10", [], NOW),
    ).rejects.toThrow(/locked/);
    asMarker();
    await expect(
      markSectionAttendance(teacherCtx(TEACHER.toString()), SECTION.toString(), "2026-06-12", [], NOW),
    ).rejects.toThrow(/future/);
  });

  test("rejects a non-FULL day (Fri/holiday — attendance not expected, D-#50)", async () => {
    asMarker();
    mockResolveDayType.mockResolvedValue("OFF");
    await expect(
      markSectionAttendance(teacherCtx(TEACHER.toString()), SECTION.toString(), "2026-06-11", [], NOW),
    ).rejects.toThrow(/not expected/);
  });

  test("rejects an absentee who isn't an active student of the section", async () => {
    asMarker();
    mockStudentFind.mockReturnValue(selectLean([])); // lookup finds nobody
    await expect(
      markSectionAttendance(
        teacherCtx(TEACHER.toString()),
        SECTION.toString(),
        "2026-06-11",
        [STUDENT_A.toString()],
        NOW,
      ),
    ).rejects.toThrow(/active student/);
  });
});

describe("amendStudentAttendance — Principal/Office unlock (O2)", () => {
  test("amends a past day with the amender stamped + audited", async () => {
    mockSectionFindById.mockResolvedValue({ _id: SECTION, classTeacherId: TEACHER });
    mockStudentFind.mockReturnValue(selectLean([{ _id: STUDENT_A }]));
    mockDayFindOne.mockResolvedValue(null);
    mockDayCreate.mockImplementation((d) => Promise.resolve({ _id: new mongoose.Types.ObjectId(), ...d }));

    await amendStudentAttendance(
      SECTION.toString(),
      "2026-06-10",
      [STUDENT_A.toString()],
      ACTOR,
      new Date(2026, 5, 11),
    );
    const created = mockDayCreate.mock.calls[0][0] as { amendedBy?: unknown };
    expect(created.amendedBy).toBeDefined();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ amended: true }) }),
    );
  });
});

// ---------------------------------------------------------------------------
// Leave linkage (AT-3) + history roll-up (AT-5)
// ---------------------------------------------------------------------------

describe("applicationCovers (pure, AT3.2)", () => {
  const apps = [{ studentId: STUDENT_A, fromKey: "2026-06-10", toKey: "2026-06-12" }];

  test("covers inside the range, not outside, not another student", () => {
    expect(applicationCovers(apps, STUDENT_A.toString(), "2026-06-11")).toBe(true);
    expect(applicationCovers(apps, STUDENT_A.toString(), "2026-06-13")).toBe(false);
    expect(applicationCovers(apps, STUDENT_B.toString(), "2026-06-11")).toBe(false);
  });
});

describe("submitLeaveApplication (AT3.1 — recorded only)", () => {
  test("records + audits; validates range and reason", async () => {
    mockStudentFindById.mockResolvedValue({ _id: STUDENT_A, active: true });
    mockLeaveCreate.mockImplementation((d) => Promise.resolve({ _id: new mongoose.Types.ObjectId(), ...d }));

    await submitLeaveApplication(STUDENT_A.toString(), "2026-06-10", "2026-06-12", "অসুস্থতা", ACTOR);
    expect(mockLeaveCreate).toHaveBeenCalledWith(expect.objectContaining({ reason: "অসুস্থতা" }));
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "LEAVE_APPLICATION_SUBMITTED" }),
    );

    await expect(
      submitLeaveApplication(STUDENT_A.toString(), "2026-06-12", "2026-06-10", "x", ACTOR),
    ).rejects.toThrow(AttendanceError);
    await expect(
      submitLeaveApplication(STUDENT_A.toString(), "2026-06-10", "2026-06-12", "   ", ACTOR),
    ).rejects.toThrow(AttendanceError);
  });
});

describe("buildStudentHistory (pure, §8)", () => {
  test("per-day absent/leave flags + present %", () => {
    const days = [
      { dateKey: "2026-06-09", absentStudentIds: [STUDENT_B] },
      { dateKey: "2026-06-10", absentStudentIds: [STUDENT_A] },
      { dateKey: "2026-06-11", absentStudentIds: [STUDENT_A, STUDENT_B] },
      { dateKey: "2026-06-14", absentStudentIds: [] },
    ];
    const apps = [{ studentId: STUDENT_A, fromKey: "2026-06-10", toKey: "2026-06-10" }];
    const h = buildStudentHistory(STUDENT_A.toString(), SECTION.toString(), days, apps);

    expect(h.markedDays).toBe(4);
    expect(h.absentDays).toBe(2);
    expect(h.presentPct).toBe(50);
    expect(h.days.find((d) => d.dateKey === "2026-06-10")).toMatchObject({ absent: true, leaveCovered: true });
    expect(h.days.find((d) => d.dateKey === "2026-06-11")).toMatchObject({ absent: true, leaveCovered: false });
  });

  test("no marked days → 0%", () => {
    expect(buildStudentHistory(STUDENT_A.toString(), SECTION.toString(), [], []).presentPct).toBe(0);
  });
});
