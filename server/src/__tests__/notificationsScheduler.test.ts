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
const mockPendingHomework = jest.fn();
const mockSweepHomeworkDue = jest.fn();
const mockSweepHomeworkAutoChase = jest.fn();
const mockIsDigestDay = jest.fn();
const mockDispatchDigest = jest.fn();
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
// HR-5: the ticker now also sweeps due offboarding access revocations (H6.3). Mock
// it so the scheduler test stays DB-free (the sweep itself is covered in offboarding.test.ts).
jest.mock("../modules/hr/services/OffboardingService", () => ({
  runDueOffboardingRevocations: jest.fn().mockResolvedValue(0),
}));
// CO-3: the ticker also runs the observation response-escalation sweep. Mock it so the
// scheduler test stays DB-free (the sweep itself is covered in observationEscalation.test.ts).
jest.mock("../modules/classroom-observation/services/ObservationEscalationService", () => ({
  runObservationEscalation: jest.fn().mockResolvedValue({
    scanned: 0,
    reminder1: 0,
    reminder2: 0,
    principalFlag: 0,
    alreadyDispatched: 0,
  }),
}));
// The homework pending-confirm ladder reads pending sections from the reconciliation
// service. Mock it so the scheduler test stays DB-free (the query is covered separately).
jest.mock("../modules/trackers/services/HomeworkReconciliationService", () => ({
  pendingHomeworkSections: (d: unknown) => mockPendingHomework(d),
}));
// The ticker also runs the homework auto-DUE sweep (GIVEN → DUE on the due morning).
// Mock it so the scheduler test stays DB-free (the sweep is covered in homeworkDueSweep.test.ts).
jest.mock("../modules/trackers/services/HomeworkDueSweepService", () => ({
  sweepHomeworkDue: (d: unknown) => mockSweepHomeworkDue(d),
}));
// The 17:30 end-of-due-day system chase (owner ruling 2026-08-04) — mocked so the
// scheduler test stays DB-free (the sweep is covered in homeworkChaseSweep.test.ts).
jest.mock("../modules/trackers/services/HomeworkChaseSweepService", () => ({
  sweepHomeworkAutoChase: (d: unknown) => mockSweepHomeworkAutoChase(d),
  HW_AUTO_CHASE_MINUTES: 17 * 60 + 30,
  HW_AUTO_CHASE_LOOKBACK_DAYS: 3,
}));
// D-#452: the weekly guardian digest (covered in homeworkWeeklyDigest.test.ts) —
// mocked so the scheduler test stays DB-free.
jest.mock("../modules/trackers/services/HomeworkWeeklyDigestService", () => ({
  isHomeworkWeeklyDigestDay: (d: unknown) => mockIsDigestDay(d),
  dispatchHomeworkWeeklyDigest: (d: unknown) => mockDispatchDigest(d),
}));
// D-#314: the auto-ISSUE sweep (covered in homeworkAutoIssue.test.ts) — mocked
// as a quiet no-op so 12:00–17:00 ticks stay DB-free here.
jest.mock("../modules/trackers/services/HomeworkAutoIssueService", () => ({
  sweepHomeworkAutoIssue: () => Promise.resolve({ issued: 0, deferred: 0 }),
  HW_AUTO_ISSUE_START_HOUR: 12,
  HW_AUTO_ISSUE_END_HOUR: 17,
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
  getTickerHealth,
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
  mockPendingHomework.mockResolvedValue([]);
  mockSweepHomeworkDue.mockResolvedValue(0);
  mockSweepHomeworkAutoChase.mockResolvedValue(0);
  mockIsDigestDay.mockResolvedValue(false);
  mockDispatchDigest.mockResolvedValue({ students: 0, notified: 0 });
  mockEmit.mockResolvedValue({ created: true, dedupeKey: "x" });
});

// ---------------------------------------------------------------------------
// Weekly guardian homework digest (17:00 last open day, D-#452)
// ---------------------------------------------------------------------------

describe("homework weekly digest family", () => {
  it("17:00 on a digest day — dispatches once and counts the notifications", async () => {
    mockIsDigestDay.mockResolvedValue(true);
    mockDispatchDigest.mockResolvedValue({ students: 12, notified: 9 });
    const s = await runSchedulerTick(at(17, 0));
    expect(s.hwWeeklyDigestEmitted).toBe(9);
    expect(mockDispatchDigest).toHaveBeenCalledTimes(1);
  });

  it("16:59 — the window is not open yet", async () => {
    mockIsDigestDay.mockResolvedValue(true);
    const s = await runSchedulerTick(at(16, 59));
    expect(s.hwWeeklyDigestEmitted).toBe(0);
    expect(mockDispatchDigest).not.toHaveBeenCalled();
  });

  it("20:55 — still inside the WIDE stale window (a weekly rung has no next rung)", async () => {
    mockIsDigestDay.mockResolvedValue(true);
    mockDispatchDigest.mockResolvedValue({ students: 1, notified: 1 });
    const s = await runSchedulerTick(at(20, 55));
    expect(s.hwWeeklyDigestEmitted).toBe(1);
  });

  it("21:05 — past the 240-min stale window: skipped", async () => {
    mockIsDigestDay.mockResolvedValue(true);
    const s = await runSchedulerTick(at(21, 5));
    expect(mockDispatchDigest).not.toHaveBeenCalled();
    expect(s.hwWeeklyDigestEmitted).toBe(0);
  });

  it("not a digest day — silent even at 17:00", async () => {
    mockIsDigestDay.mockResolvedValue(false);
    await runSchedulerTick(at(17, 0));
    expect(mockDispatchDigest).not.toHaveBeenCalled();
  });

  it("OFF/HOLIDAY — the school-day gate keeps the digest silent", async () => {
    mockResolveDayType.mockResolvedValue("HOLIDAY");
    mockIsDigestDay.mockResolvedValue(true);
    await runSchedulerTick(at(17, 0));
    expect(mockDispatchDigest).not.toHaveBeenCalled();
  });

  it("runOnce — a second tick the same day does not re-dispatch", async () => {
    mockIsDigestDay.mockResolvedValue(true);
    mockDispatchDigest.mockResolvedValue({ students: 3, notified: 3 });
    await runSchedulerTick(at(17, 0));
    const s2 = await runSchedulerTick(at(17, 1));
    expect(mockDispatchDigest).toHaveBeenCalledTimes(1);
    expect(s2.hwWeeklyDigestEmitted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Homework auto-CHASE rung (17:30 end-of-due-day system chase, 2026-08-04 ruling)
// ---------------------------------------------------------------------------

describe("homework auto-chase rung", () => {
  it("17:30 — runs the sweep once and counts the chases", async () => {
    mockSweepHomeworkAutoChase.mockResolvedValue(3);
    const s = await runSchedulerTick(at(17, 30));
    expect(s.hwAutoChased).toBe(3);
    expect(mockSweepHomeworkAutoChase).toHaveBeenCalledTimes(1);
  });

  it("before the rung (17:29) — silent", async () => {
    const s = await runSchedulerTick(at(17, 29));
    expect(s.hwAutoChased).toBe(0);
    expect(mockSweepHomeworkAutoChase).not.toHaveBeenCalled();
  });

  it("stale (18:05, > 30 min past) — skipped, never backfilled that evening", async () => {
    const s = await runSchedulerTick(at(18, 5));
    expect(s.hwAutoChased).toBe(0);
    expect(mockSweepHomeworkAutoChase).not.toHaveBeenCalled();
  });

  it("runOnce — a second tick in the window does not re-run the sweep", async () => {
    mockSweepHomeworkAutoChase.mockResolvedValue(2);
    await runSchedulerTick(at(17, 30));
    const s2 = await runSchedulerTick(at(17, 35));
    expect(mockSweepHomeworkAutoChase).toHaveBeenCalledTimes(1);
    expect(s2.hwAutoChased).toBe(0);
  });

  it("OFF/HOLIDAY — the school-day gate keeps the sweep silent", async () => {
    mockResolveDayType.mockResolvedValue("HOLIDAY");
    const s = await runSchedulerTick(at(17, 30));
    expect(s.hwAutoChased).toBe(0);
    expect(mockSweepHomeworkAutoChase).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Homework pending-confirm ladder (13:00/13:30/14:00 confirmer, 14:00 Office, 16:00 Principal)
// ---------------------------------------------------------------------------

describe("homework pending-confirm ladder", () => {
  const pendingSection = (over: Record<string, unknown> = {}) => ({
    sectionId: "secA",
    classId: "clsA",
    nameBn: "ক্লাস ১",
    classTeacherId: "ct1",
    homeworkConfirmerId: null,
    ...over,
  });

  // User.find is hit for THREE distinct queries in this family — branch by query so a
  // test can set supervisors and escalation recipients independently.
  let supervisors: Array<{ _id: { toString(): string } }> = [];
  let escalationRecipients: Array<{ _id: { toString(): string } }> = [];
  beforeEach(() => {
    supervisors = [];
    escalationRecipients = [];
    mockUserFind.mockImplementation(
      (f: { homeworkSupervisor?: boolean; role?: string; $or?: unknown[] } | undefined) => {
        if (f && f.homeworkSupervisor) return Promise.resolve(supervisors);
        // D-#468: the escalation lookup is now actingAsFilter([...]) — a role/template
        // $or rather than a bare `role` field. Match either so the mock tracks the seam.
        if (f && (f.role || f.$or)) return Promise.resolve(escalationRecipients);
        return Promise.resolve([]); // _id → name lookups
      },
    );
  });

  it("13:00 — reminds the class teacher of each still-pending section", async () => {
    mockPendingHomework.mockResolvedValue([pendingSection()]);
    const s = await runSchedulerTick(at(13, 0));
    expect(s.hwPendingEmitted).toBe(1);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: "ct1", kind: "HW_PENDING_REMINDER" }),
    );
  });

  it("reminds BOTH the class teacher AND the delegate (delegate is additive)", async () => {
    mockPendingHomework.mockResolvedValue([pendingSection({ homeworkConfirmerId: "deleg1" })]);
    const s = await runSchedulerTick(at(13, 30));
    expect(s.hwPendingEmitted).toBe(2);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: "ct1", kind: "HW_PENDING_REMINDER" }),
    );
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: "deleg1", kind: "HW_PENDING_REMINDER" }),
    );
  });

  it("also reminds every school-wide homework supervisor", async () => {
    mockPendingHomework.mockResolvedValue([pendingSection()]);
    supervisors = [{ _id: oid("sv1") }];
    const s = await runSchedulerTick(at(13, 0));
    expect(s.hwPendingEmitted).toBe(2); // class teacher + supervisor
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: "sv1", kind: "HW_PENDING_REMINDER" }),
    );
  });

  it("14:00 — confirmer gets a reminder AND Office gets the escalation (per section)", async () => {
    mockPendingHomework.mockResolvedValue([pendingSection()]);
    escalationRecipients = [{ _id: oid("office1") }]; // supervisors stays empty
    const s = await runSchedulerTick(at(14, 0));
    expect(s.hwPendingEmitted).toBe(2);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: "ct1", kind: "HW_PENDING_REMINDER" }),
    );
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: "office1", kind: "HW_PENDING_ESCALATION" }),
    );
  });

  it("16:00 — only the Principal is escalated (no more confirmer reminder)", async () => {
    mockPendingHomework.mockResolvedValue([pendingSection()]);
    escalationRecipients = [{ _id: oid("prin1") }];
    const s = await runSchedulerTick(at(16, 0));
    expect(s.hwPendingEmitted).toBe(1);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: "prin1", kind: "HW_PENDING_ESCALATION" }),
    );
    expect(mockEmit).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "HW_PENDING_REMINDER" }),
    );
  });

  it("nothing pending ⇒ no homework emits", async () => {
    mockPendingHomework.mockResolvedValue([]);
    const s = await runSchedulerTick(at(13, 0));
    expect(s.hwPendingEmitted).toBe(0);
  });

  it("a section with no class teacher AND no delegate (and no supervisor) is skipped", async () => {
    mockPendingHomework.mockResolvedValue([pendingSection({ classTeacherId: null })]);
    const s = await runSchedulerTick(at(13, 0));
    expect(s.hwPendingEmitted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Homework auto-DUE sweep (GIVEN → DUE on the due morning, once per school day)
// ---------------------------------------------------------------------------

describe("homework auto-DUE sweep", () => {
  it("runs once per school day and reports the flip count", async () => {
    mockSweepHomeworkDue.mockResolvedValue(4);
    const s1 = await runSchedulerTick(at(8, 0));
    expect(mockSweepHomeworkDue).toHaveBeenCalledTimes(1);
    expect(s1.hwDueFlipped).toBe(4);

    // Second tick, same day → the once-per-day guard skips the sweep.
    const s2 = await runSchedulerTick(at(8, 1));
    expect(mockSweepHomeworkDue).toHaveBeenCalledTimes(1);
    expect(s2.hwDueFlipped).toBe(0);
  });

  it.each(["OFF", "HOLIDAY"] as const)("does NOT run on a %s day", async (dayType) => {
    mockResolveDayType.mockResolvedValue(dayType);
    await runSchedulerTick(at(8, 0));
    expect(mockSweepHomeworkDue).not.toHaveBeenCalled();
  });
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
// MON-4 — ticker heartbeat (the off-box watchdog reads this)
// ---------------------------------------------------------------------------

describe("MON-4 — ticker heartbeat (getTickerHealth)", () => {
  it("is null before any tick (reset in beforeEach)", () => {
    expect(getTickerHealth()).toEqual({ lastTickAt: null, ageSeconds: null });
  });

  it("records the last tick (set first, before the school-day gate) + computes staleness", async () => {
    mockResolveDayType.mockResolvedValue("OFF"); // even a silent day still counts as a live tick
    const tickMoment = at(8, 0);
    await runSchedulerTick(tickMoment);
    const health = getTickerHealth(at(8, 2)); // 120s later
    expect(health.lastTickAt).toBe(tickMoment.toISOString());
    expect(health.ageSeconds).toBe(120);
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
    expect(mockUserFind).toHaveBeenLastCalledWith(expect.objectContaining({ active: true, $or: [{ role: { $in: ["OFFICE"] } }, { additionalTemplates: { $in: ["OFFICE"] } }] }));
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
      expect.objectContaining({ active: true, $or: [{ role: { $in: ["PRINCIPAL"] } }, { additionalTemplates: { $in: ["PRINCIPAL"] } }] }),
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
