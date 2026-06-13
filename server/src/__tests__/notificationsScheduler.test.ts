/**
 * N-2 — the D-#73/#74 in-process trigger scheduler (prd-notifications §8 N2.*).
 *
 * N2.1 — bell ~5 min before each period end → bell-duty admin, once per period
 *        (dedupeKey); no duty assigned ⇒ nothing; Saturday ⇒ quran-track only
 * N2.3 — class-note ladder 12/13/14: one combined prompt per teacher, recomputed
 *        per rung (published notes drop off; all-published teacher gets nothing)
 * N2.4 — escalation 15:00 → all OFFICE, 16:00 → all PRINCIPAL, combined
 *        teacher+group+period list; nothing missing ⇒ no escalation
 * N2.5 — OFF/HOLIDAY days emit nothing at all
 * N2.6 — stale-skip (> 30 min past = never fired) + restart-safety (emission is
 *        dedupe-keyed; the once-per-day guard only saves dispatcher re-scans)
 * D-#96/#99 — attendance tiers CALL dispatchAttendanceReminders (12:10/12:45/
 *        14:00), the library sweep CALLS dispatchLibraryReminders — one truth
 *
 * DB-free: every model + the dispatchers + the seam are mocked; the scheduler
 * logic and its pure timing helpers are real.
 */
const mockResolveDayType = jest.fn();
const mockBellSchedule = jest.fn();
const mockUnwritten = jest.fn();
const mockGridDistinct = jest.fn();
const mockSubjectGroupFind = jest.fn();
const mockSectionFind = jest.fn();
const mockUserFind = jest.fn();
const mockDispatchAttendance = jest.fn();
const mockDispatchLibrary = jest.fn();
const mockEmit = jest.fn();

jest.mock("../modules/routine/calendar", () => ({
  resolveDayType: (d: unknown) => mockResolveDayType(d),
}));
jest.mock("../modules/routine/services/RoutineTriggerService", () => ({
  bellSchedule: (d: unknown, a: unknown) => mockBellSchedule(d, a),
  unwrittenClassNoteSlots: (d: unknown, t?: unknown) => mockUnwritten(d, t),
}));
jest.mock("../modules/routine/models/PeriodGrid", () => ({
  PeriodGrid: { distinct: (f: unknown, q: unknown) => mockGridDistinct(f, q) },
}));
jest.mock("../modules/routine/models/SubjectGroup", () => ({
  SubjectGroup: { find: (f: unknown) => ({ select: () => ({ lean: () => mockSubjectGroupFind(f) }) }) },
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: (f: unknown) => ({ select: () => ({ lean: () => mockSectionFind(f) }) }) },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (f: unknown) => ({ select: () => ({ lean: () => mockUserFind(f) }) }) },
}));
jest.mock("../modules/attendance/services/AttendanceReminderService", () => ({
  dispatchAttendanceReminders: (t: unknown, k: unknown) => mockDispatchAttendance(t, k),
}));
jest.mock("../modules/library/services/LibraryReminderService", () => ({
  dispatchLibraryReminders: (n: unknown) => mockDispatchLibrary(n),
}));
jest.mock("../modules/notifications/services/NotificationService", () => ({
  emit: (input: unknown) => mockEmit(input),
}));

import {
  runSchedulerTick,
  resetSchedulerMemory,
  windowOpen,
  minutesOfDay,
  schedulerDedupeKeys,
  STALE_MINUTES,
} from "../modules/notifications/services/SchedulerService";

const oid = (s: string) => ({ toString: () => s });
// 2026-06-15 is a Monday (FULL when mocked so).
const at = (hour: number, minute: number) => new Date(2026, 5, 15, hour, minute);
const DATE = "2026-06-15";

beforeEach(() => {
  jest.clearAllMocks();
  resetSchedulerMemory();
  mockResolveDayType.mockResolvedValue("FULL");
  mockBellSchedule.mockResolvedValue([]);
  mockUnwritten.mockResolvedValue([]);
  mockGridDistinct.mockResolvedValue([]);
  mockSubjectGroupFind.mockResolvedValue([]);
  mockSectionFind.mockResolvedValue([]);
  mockUserFind.mockResolvedValue([]);
  mockDispatchAttendance.mockResolvedValue({});
  mockDispatchLibrary.mockResolvedValue({ dueSoonEmitted: 0, overdueEmitted: 0 });
  mockEmit.mockResolvedValue({ created: true, dedupeKey: "x" });
});

// ---------------------------------------------------------------------------
// Pure timing helpers (D-#73 stale policy)
// ---------------------------------------------------------------------------

describe("windowOpen / minutesOfDay", () => {
  it("fires from the due minute through due+30, never before, never after", () => {
    expect(windowOpen(719, 720)).toBe(false); // a minute early
    expect(windowOpen(720, 720)).toBe(true); // on the minute
    expect(windowOpen(720 + STALE_MINUTES, 720)).toBe(true); // last valid minute
    expect(windowOpen(720 + STALE_MINUTES + 1, 720)).toBe(false); // stale (N2.6)
  });

  it("minutesOfDay is local clock minutes", () => {
    expect(minutesOfDay(at(12, 5))).toBe(725);
  });
});

// ---------------------------------------------------------------------------
// N2.5 — silent days
// ---------------------------------------------------------------------------

describe("N2.5 — OFF/HOLIDAY ticks emit nothing", () => {
  it.each(["OFF", "HOLIDAY"] as const)("%s → no emits, no dispatcher calls", async (dayType) => {
    mockResolveDayType.mockResolvedValue(dayType);
    const s = await runSchedulerTick(at(12, 15));
    expect(s.dayType).toBe(dayType);
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockDispatchAttendance).not.toHaveBeenCalled();
    expect(mockDispatchLibrary).not.toHaveBeenCalled();
    expect(mockGridDistinct).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// N2.1 — bell
// ---------------------------------------------------------------------------

describe("N2.1 — bell reminder", () => {
  beforeEach(() => {
    mockGridDistinct.mockResolvedValue(["class_1_5"]);
  });

  it("fires ~5 min before a period end to the duty admin, dedupe-keyed", async () => {
    mockBellSchedule.mockResolvedValue([
      { periodNumber: 3, endHHMM: "09:40", isBreak: false, track: "general", bellAdminId: "admin1" },
      { periodNumber: 4, endHHMM: "10:15", isBreak: false, track: "general", bellAdminId: "admin1" },
    ]);
    const s = await runSchedulerTick(at(9, 36)); // due = 09:35; in window
    expect(s.bellEmitted).toBe(1);
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: "admin1",
        kind: "BELL_REMINDER",
        refs: expect.objectContaining({ date: DATE, audienceKey: "class_1_5", periodNumber: 3 }),
        dedupeKey: schedulerDedupeKeys.bell(DATE, "class_1_5", 3, "admin1"),
      }),
    );
  });

  it("no bell-duty admin assigned → nothing to send", async () => {
    mockBellSchedule.mockResolvedValue([
      { periodNumber: 3, endHHMM: "09:40", isBreak: false, track: "general", bellAdminId: null },
    ]);
    const s = await runSchedulerTick(at(9, 36));
    expect(s.bellEmitted).toBe(0);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("N2.6 — a bell whose moment passed > 30 min ago is skipped, never backfilled", async () => {
    mockBellSchedule.mockResolvedValue([
      { periodNumber: 1, endHHMM: "07:35", isBreak: false, track: "quran", bellAdminId: "admin1" },
    ]);
    const s = await runSchedulerTick(at(14, 0)); // hours later
    expect(s.bellEmitted).toBe(0);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("Saturday (QURAN_ONLY, D-#50) scopes the bell to quran-track periods", async () => {
    mockResolveDayType.mockResolvedValue("QURAN_ONLY");
    mockBellSchedule.mockResolvedValue([
      { periodNumber: 1, endHHMM: "09:40", isBreak: false, track: "quran", bellAdminId: "admin1" },
      { periodNumber: 2, endHHMM: "09:40", isBreak: false, track: "general", bellAdminId: "admin1" },
    ]);
    const s = await runSchedulerTick(at(9, 36));
    expect(s.bellEmitted).toBe(1);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ refs: expect.objectContaining({ periodNumber: 1 }) }),
    );
  });
});

// ---------------------------------------------------------------------------
// N2.3 — class-note ladder
// ---------------------------------------------------------------------------

describe("N2.3 — class-note prompt ladder (12/13/14)", () => {
  it("one combined prompt per teacher at a rung, dedupe CNP:{date}:{hour}:{teacher}", async () => {
    mockUnwritten.mockResolvedValue([
      { _id: oid("sl1"), teacherId: oid("t1"), groupType: "section", groupId: oid("g1"), periodNumber: 2, subject: "MATH" },
      { _id: oid("sl2"), teacherId: oid("t1"), groupType: "section", groupId: oid("g1"), periodNumber: 5, subject: "ENG" },
      { _id: oid("sl3"), teacherId: oid("t2"), groupType: "subjectgroup", groupId: oid("g2"), periodNumber: 1, subject: "QURAN" },
    ]);
    const s = await runSchedulerTick(at(13, 10));
    expect(s.classNotePromptsEmitted).toBe(2);
    // the work-list is recomputed for the WHOLE staff (no teacherId filter)
    expect(mockUnwritten).toHaveBeenCalledWith(expect.any(Date), undefined);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: "t1",
        kind: "CLASS_NOTE_PROMPT",
        bodyBn: expect.stringContaining("পিরিয়ড"),
        refs: expect.objectContaining({ date: DATE, hour: 13 }),
        dedupeKey: schedulerDedupeKeys.classNotePrompt(DATE, 13, "t1"),
      }),
    );
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: "t2",
        dedupeKey: schedulerDedupeKeys.classNotePrompt(DATE, 13, "t2"),
      }),
    );
  });

  it("all notes published ⇒ the rung emits nothing", async () => {
    mockUnwritten.mockResolvedValue([]);
    const s = await runSchedulerTick(at(12, 0));
    expect(s.classNotePromptsEmitted).toBe(0);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("between rungs (e.g. 12:45) nothing fires — the missed rung is caught by the next one", async () => {
    mockUnwritten.mockResolvedValue([
      { _id: oid("sl1"), teacherId: oid("t1"), groupType: "section", groupId: oid("g1"), periodNumber: 2, subject: "MATH" },
    ]);
    const s = await runSchedulerTick(at(12, 45));
    expect(s.classNotePromptsEmitted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// N2.4 — escalation
// ---------------------------------------------------------------------------

describe("N2.4 — class-note escalation (15:00 Office / 16:00 Principal)", () => {
  const missingSlot = {
    _id: oid("sl1"),
    teacherId: oid("t1"),
    groupType: "section" as const,
    groupId: oid("sec1"),
    periodNumber: 4,
    subject: "MATH",
  };

  beforeEach(() => {
    mockSectionFind.mockResolvedValue([{ _id: oid("sec1"), nameBn: "প্রথম শ্রেণি" }]);
  });

  it("15:00 → every OFFICE user gets the combined teacher+group+period list", async () => {
    mockUnwritten.mockResolvedValue([missingSlot]);
    // first find = teacher names, second = recipients (role query)
    mockUserFind
      .mockResolvedValueOnce([{ _id: oid("t1"), name: "Karim" }])
      .mockResolvedValueOnce([{ _id: oid("o1") }, { _id: oid("o2") }]);

    const s = await runSchedulerTick(at(15, 5));
    expect(s.escalationsEmitted).toBe(2);
    expect(mockUserFind).toHaveBeenLastCalledWith(expect.objectContaining({ role: "OFFICE", active: true }));
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: "o1",
        kind: "CLASS_NOTE_ESCALATION",
        bodyBn: expect.stringContaining("Karim"),
        dedupeKey: schedulerDedupeKeys.classNoteEscalation(DATE, 15, "o1"),
      }),
    );
    const body = (mockEmit.mock.calls[0][0] as { bodyBn: string }).bodyBn;
    expect(body).toContain("প্রথম শ্রেণি");
    expect(body).toContain("পিরিয়ড 4");
  });

  it("16:00 → every PRINCIPAL user", async () => {
    mockUnwritten.mockResolvedValue([missingSlot]);
    mockUserFind
      .mockResolvedValueOnce([{ _id: oid("t1"), name: "Karim" }])
      .mockResolvedValueOnce([{ _id: oid("p1") }]);

    const s = await runSchedulerTick(at(16, 10));
    expect(s.escalationsEmitted).toBe(1);
    expect(mockUserFind).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: "PRINCIPAL", active: true }),
    );
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: schedulerDedupeKeys.classNoteEscalation(DATE, 16, "p1") }),
    );
  });

  it("nothing missing ⇒ no escalation at all", async () => {
    mockUnwritten.mockResolvedValue([]);
    const s = await runSchedulerTick(at(15, 0));
    expect(s.escalationsEmitted).toBe(0);
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// D-#96/#99 — the dispatcher calls (one truth)
// ---------------------------------------------------------------------------

describe("attendance tiers — the ticker CALLS the AT-4 engine (D-#99)", () => {
  it("12:15 → dispatchAttendanceReminders('T1210', today); other tiers untouched", async () => {
    const s = await runSchedulerTick(at(12, 15));
    expect(s.attendanceTiersRun).toEqual(["T1210"]);
    expect(mockDispatchAttendance).toHaveBeenCalledTimes(1);
    expect(mockDispatchAttendance).toHaveBeenCalledWith("T1210", DATE);
  });

  it("12:50 → T1245; 14:20 → T1400", async () => {
    await runSchedulerTick(at(12, 50));
    expect(mockDispatchAttendance).toHaveBeenLastCalledWith("T1245", DATE);
    await runSchedulerTick(at(14, 20));
    expect(mockDispatchAttendance).toHaveBeenLastCalledWith("T1400", DATE);
  });

  it("a second tick in the same window does not re-run the dispatcher (process guard); a 'restart' re-runs it — the engine is idempotent", async () => {
    await runSchedulerTick(at(12, 15));
    await runSchedulerTick(at(12, 16));
    expect(mockDispatchAttendance).toHaveBeenCalledTimes(1);
    resetSchedulerMemory(); // simulated restart (N2.6 — dedupe absorbs re-sends)
    await runSchedulerTick(at(12, 17));
    expect(mockDispatchAttendance).toHaveBeenCalledTimes(2);
  });

  it("a dispatcher failure is retried on the next tick (guard not marked)", async () => {
    mockDispatchAttendance.mockRejectedValueOnce(new Error("atlas hiccup"));
    await runSchedulerTick(at(12, 15));
    await runSchedulerTick(at(12, 16));
    expect(mockDispatchAttendance).toHaveBeenCalledTimes(2);
  });

  it("not run outside FULL days (Saturday is bell/library only)", async () => {
    mockResolveDayType.mockResolvedValue("QURAN_ONLY");
    await runSchedulerTick(at(12, 15));
    expect(mockDispatchAttendance).not.toHaveBeenCalled();
  });
});

describe("library sweep — the ticker CALLS the LB-5 dispatcher (D-#96)", () => {
  it("fires on the hour points, once per process-day per hour", async () => {
    const s = await runSchedulerTick(at(9, 5));
    expect(s.librarySweepRan).toBe(true);
    expect(mockDispatchLibrary).toHaveBeenCalledTimes(1);
    await runSchedulerTick(at(9, 6)); // same hour window → guarded
    expect(mockDispatchLibrary).toHaveBeenCalledTimes(1);
    await runSchedulerTick(at(10, 2)); // next hour point → runs again (idempotent inside)
    expect(mockDispatchLibrary).toHaveBeenCalledTimes(2);
  });

  it("runs on QURAN_ONLY days too (overdue rungs count them as school days)", async () => {
    mockResolveDayType.mockResolvedValue("QURAN_ONLY");
    const s = await runSchedulerTick(at(9, 0));
    expect(s.librarySweepRan).toBe(true);
  });
});
