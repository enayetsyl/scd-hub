/**
 * D-#316 — adminToday: the Principal/Office dashboard aggregate.
 *
 * The service COMPOSES existing module reads into generic cards; each block is
 * best-effort (a failing module yields an `error` badge card, never a 500), rows
 * cap at 5 with moreCount, and the recon read is fetched ONCE for two cards.
 *
 * DB-free: every composed service/model is mocked; the composition is real.
 */
const mockPresence = jest.fn();
const mockUnmarked = jest.fn();
jest.mock("../modules/attendance/services/AttendanceReportService", () => ({
  classPresenceForDate: (d: unknown) => mockPresence(d),
  unmarkedSections: (d: unknown) => mockUnmarked(d),
}));

const mockRecon = jest.fn();
jest.mock("../modules/trackers/services/ReconReportService", () => ({
  reconciliationReport: (...a: unknown[]) => mockRecon(...a),
}));

const mockLifecycle = jest.fn();
jest.mock("../modules/trackers/services/HomeworkLifecycleReportService", () => ({
  homeworkLifecycleReport: (...a: unknown[]) => mockLifecycle(...a),
}));

const mockReconModelFind = jest.fn();
jest.mock("../modules/trackers/models/HomeworkReconciliation", () => ({
  HomeworkReconciliation: {
    find: (f: unknown) => ({ select: () => ({ lean: () => mockReconModelFind(f) }) }),
  },
  reconDayKey: (date: Date) => {
    const d = new Date(date.getTime());
    d.setHours(0, 0, 0, 0);
    return d;
  },
}));

const mockClassFind = jest.fn();
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: (f: unknown) => ({ select: () => ({ lean: () => mockClassFind(f) }) }) },
}));

const mockListLeave = jest.fn();
jest.mock("../modules/hr/services/StaffLeaveService", () => ({
  listLeave: (f: unknown) => mockListLeave(f),
}));
const mockNeedsCover = jest.fn();
jest.mock("../modules/hr/services/CoverService", () => ({
  needsCoverSlots: (...a: unknown[]) => mockNeedsCover(...a),
}));
const mockStaffProfileFind = jest.fn();
jest.mock("../modules/foundation/models/StaffProfile", () => ({
  StaffProfile: { find: (f: unknown) => ({ select: () => ({ lean: () => mockStaffProfileFind(f) }) }) },
}));

const mockObsCount = jest.fn();
const mockObsFind = jest.fn();
jest.mock("../modules/classroom-observation/models/ClassroomObservation", () => ({
  ClassroomObservation: {
    countDocuments: (f: unknown) => mockObsCount(f),
    find: (f: unknown) => ({
      sort: () => ({ limit: () => ({ select: () => ({ lean: () => mockObsFind(f) }) }) }),
    }),
  },
}));
const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (f: unknown) => ({ select: () => ({ lean: () => mockUserFind(f) }) }) },
}));

const mockReviewInbox = jest.fn();
jest.mock("../modules/comments/services/StudentCommentService", () => ({
  reviewInbox: () => mockReviewInbox(),
}));
const mockCommentCount = jest.fn();
jest.mock("../modules/comments/models/StudentComment", () => ({
  StudentComment: { countDocuments: (f: unknown) => mockCommentCount(f) },
}));

const mockPrintQueue = jest.fn();
jest.mock("../modules/trackers/services/ClassTestService", () => ({
  listPrintQueue: () => mockPrintQueue(),
}));
const mockCtrDistinct = jest.fn();
jest.mock("../modules/trackers/models/ClassTestResult", () => ({
  ClassTestResult: { distinct: (f: unknown, q: unknown) => mockCtrDistinct(f, q) },
}));

const mockPrintCounts = jest.fn();
jest.mock("../modules/printing/services/PrintRequestService", () => ({
  printQueueCounts: () => mockPrintCounts(),
}));

import { adminToday } from "../modules/dashboard/services/AdminTodayService";

const EMPTY_RECON = {
  fromKey: "2026-07-14",
  toKey: "2026-07-14",
  hwMisses: [],
  asMisses: [],
  hwNotDeclared: [],
  hwNilDeclared: [],
  asNilDeclared: [],
  asNotDeclared: [],
  asNotPrinted: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPresence.mockResolvedValue([]);
  mockUnmarked.mockResolvedValue([]);
  mockRecon.mockResolvedValue(EMPTY_RECON);
  mockLifecycle.mockResolvedValue({ backlog: [] });
  mockReconModelFind.mockResolvedValue([]);
  mockClassFind.mockResolvedValue([]);
  mockListLeave.mockResolvedValue([]);
  mockNeedsCover.mockResolvedValue([]);
  mockStaffProfileFind.mockResolvedValue([]);
  mockObsCount.mockResolvedValue(0);
  mockObsFind.mockResolvedValue([]);
  mockUserFind.mockResolvedValue([]);
  mockReviewInbox.mockResolvedValue([]);
  mockCommentCount.mockResolvedValue(0);
  mockPrintQueue.mockResolvedValue([]);
  mockCtrDistinct.mockResolvedValue([]);
  mockPrintCounts.mockResolvedValue({ requested: 0, printed: 0 });
});

const CARD_KEYS = [
  "attendance",
  "hwCycle",
  "hwLifecycle",
  "assignments",
  "leave",
  "observations",
  "comments",
  "classTests",
  "print",
];

describe("D-#316 adminToday", () => {
  test("returns the nine cards in registry order, one recon fetch for two cards", async () => {
    const cards = await adminToday("2026-07-14");
    expect(cards.map((c) => c.key)).toEqual(CARD_KEYS);
    expect(mockRecon).toHaveBeenCalledTimes(1);
  });

  test("attendance badges sum presence; incomplete class rows go danger", async () => {
    mockPresence.mockResolvedValue([
      { classId: "a", classLevel: 1, classNameBn: "", markedCount: 7, presentCount: 7, absentCount: 0, totalCount: 7, complete: true },
      { classId: "b", classLevel: -1, classNameBn: "", markedCount: 15, presentCount: 15, absentCount: 6, totalCount: 21, complete: false },
    ]);
    mockUnmarked.mockResolvedValue([{ sectionId: "s" }]);
    const [attendance] = await adminToday("2026-07-14");
    expect(attendance.badges).toEqual([
      { key: "present", value: 22, tone: "ok" },
      { key: "absent", value: 6, tone: "warn" },
      { key: "unmarked", value: 1, tone: "danger" },
    ]);
    expect(attendance.rows[1]).toMatchObject({ title: "N", tone: "danger" });
  });

  test("rows cap at 5 with moreCount carrying the rest", async () => {
    mockReviewInbox.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({
        studentName: `S${i}`,
        authorName: "T",
        type: "GENERAL",
        sentiment: "POSITIVE",
      })),
    );
    const cards = await adminToday("2026-07-14");
    const comments = cards.find((c) => c.key === "comments")!;
    expect(comments.rows).toHaveLength(5);
    expect(comments.moreCount).toBe(3);
    expect(comments.badges).toContainEqual({ key: "commentsPendingReview", value: 8, tone: "warn" });
  });

  test("hwCycle marks auto-issued confirms and pending misses", async () => {
    mockRecon.mockResolvedValue({
      ...EMPTY_RECON,
      hwMisses: [
        { dateKey: "2026-07-14", sectionId: "s", sectionNameBn: "মূল", classLevel: 3, confirmerName: "CT", declaredItems: 2, declaredMinutes: 55 },
      ],
    });
    mockReconModelFind.mockResolvedValue([{ classId: "c1", autoIssued: true }]);
    mockClassFind.mockResolvedValue([{ _id: "c1", level: 2 }]);
    const cards = await adminToday("2026-07-14");
    const hw = cards.find((c) => c.key === "hwCycle")!;
    expect(hw.badges).toContainEqual({ key: "pendingConfirm", value: 1, tone: "danger" });
    expect(hw.badges).toContainEqual({ key: "autoIssued", value: 1, tone: "info" });
    expect(hw.rows[0]).toMatchObject({ title: "C3 — মূল", tone: "danger" });
    expect(hw.rows[1]).toMatchObject({ title: "C2", value: "🤖 ✓" });
  });

  test("a failing module yields its error card without sinking the rest", async () => {
    mockObsCount.mockRejectedValue(new Error("observation module down"));
    const cards = await adminToday("2026-07-14");
    const obs = cards.find((c) => c.key === "observations")!;
    expect(obs.badges).toEqual([{ key: "error", value: 1, tone: "danger" }]);
    expect(cards.find((c) => c.key === "print")!.badges).toContainEqual({
      key: "printRequested",
      value: 0,
      tone: "ok",
    });
  });

  test("a recon failure degrades hwCycle/assignments to empty, not an exception", async () => {
    mockRecon.mockRejectedValue(new Error("recon down"));
    const cards = await adminToday("2026-07-14");
    expect(cards.find((c) => c.key === "assignments")!.badges).toContainEqual({
      key: "declarePending",
      value: 0,
      tone: "ok",
    });
  });

  test("an invalid date key throws before any module runs", async () => {
    await expect(adminToday("not-a-date")).rejects.toThrow();
    expect(mockPresence).not.toHaveBeenCalled();
  });
});
