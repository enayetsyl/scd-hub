/**
 * GC-2 tests — the guardian "done at home" claim service (D-#548..#551/#554).
 *
 * The four things worth pinning:
 *   §6.1  the five file guards, including the two states that must be REFUSED
 *   §6.2  auto-accept from the teacher's ordinary submit path, and that it can
 *         never throw into a submit
 *   §6.3.1 the ACTION DAY — the rule derived from the owner's two examples
 *   §6.4  an open claim mutes the family-facing chase push
 *
 * DB-free: models, the calendar and the audit log are mocked.
 */
import mongoose from "mongoose";

const mockClaimFindOne = jest.fn();
const mockClaimCount = jest.fn();
const mockClaimCreate = jest.fn();
const mockClaimFind = jest.fn();
const mockClaimExists = jest.fn();
const mockClaimFindById = jest.fn();
const mockHwFindById = jest.fn();
const mockAsFindById = jest.fn();
const mockHwItem = jest.fn();
const mockAsItem = jest.fn();
const mockLinkFindOne = jest.fn();
const mockResolveDayType = jest.fn();
const mockWriteAudit = jest.fn();

jest.mock("../modules/trackers/models/GuardianWorkClaim", () => ({
  GuardianWorkClaim: {
    findOne: (q: unknown) => mockClaimFindOne(q),
    findById: (id: unknown) => mockClaimFindById(id),
    countDocuments: (q: unknown) => mockClaimCount(q),
    create: (d: unknown) => mockClaimCreate(d),
    find: (q: unknown) => mockClaimFind(q),
    exists: (q: unknown) => mockClaimExists(q),
  },
}));
jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: { findById: (id: unknown) => ({ lean: () => mockHwFindById(id) }) },
}));
jest.mock("../modules/trackers/models/AssignmentStudentRecord", () => ({
  AssignmentStudentRecord: { findById: (id: unknown) => ({ lean: () => mockAsFindById(id) }) },
}));
jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: { findById: () => ({ select: () => ({ lean: () => mockHwItem() }) }) },
}));
jest.mock("../modules/trackers/models/AssignmentItem", () => ({
  AssignmentItem: { findById: () => ({ select: () => ({ lean: () => mockAsItem() }) }) },
}));
jest.mock("../modules/foundation/models/GuardianLink", () => ({
  GuardianLink: { findOne: (q: unknown) => ({ lean: () => mockLinkFindOne(q) }) },
}));
jest.mock("../modules/routine/calendar", () => ({
  resolveDayType: (d: Date) => mockResolveDayType(d),
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

import {
  fileWorkClaim,
  rejectWorkClaim,
  acceptClaimsForRecords,
  resolveActionDateKey,
  recordsWithOpenClaims,
  WorkClaimError,
} from "../modules/trackers/services/WorkClaimService";

const oid = () => new mongoose.Types.ObjectId();
const STUDENT = oid();
const GUARDIAN = oid();
const USER = oid();
const TEACHER = oid();
const RECORD = oid();

/** Sun–Thu open, Fri/Sat OFF — the school's real week, unless a test overrides. */
function normalWeek() {
  mockResolveDayType.mockImplementation(async (d: Date) => {
    const day = d.getDay();
    return day === 5 || day === 6 ? "OFF" : "FULL";
  });
}

function hwRecord(over: Record<string, unknown> = {}) {
  return {
    _id: RECORD,
    hwId: "HW-C4-MATH-0012",
    studentId: STUDENT,
    sectionId: oid(),
    classId: oid(),
    state: "CHASE",
    dueDate: new Date("2026-08-24T00:00:00"),
    issuedBy: TEACHER,
    hwItemId: oid(),
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  normalWeek();
  mockHwFindById.mockResolvedValue(hwRecord());
  mockHwItem.mockResolvedValue({ subject: "MATH" });
  mockAsItem.mockResolvedValue({ subject: "BAN" });
  mockLinkFindOne.mockResolvedValue({ active: true });
  mockClaimFindOne.mockResolvedValue(null);
  mockClaimCount.mockResolvedValue(0);
  mockClaimCreate.mockImplementation(async (d: Record<string, unknown>) => ({
    ...d,
    _id: oid(),
  }));
  mockWriteAudit.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// §6.3.1 — the action day (D-#554)
// ---------------------------------------------------------------------------

describe("resolveActionDateKey — the owner's two examples must both land on a real 11:30", () => {
  test("Thursday 09:00 → THAT Thursday (both rungs still ahead)", async () => {
    // 2026-08-27 is a Thursday.
    expect(await resolveActionDateKey(new Date("2026-08-27T09:00:00"))).toBe("2026-08-27");
  });

  test("Monday 21:00 → the NEXT school day, Tuesday", async () => {
    // 2026-08-24 is a Monday.
    expect(await resolveActionDateKey(new Date("2026-08-24T21:00:00"))).toBe("2026-08-25");
  });

  test("11:35 rolls to the next day rather than skipping the Office rung", async () => {
    // Filed 5 minutes after 11:30: escalating at 13:00 would reach the Principal
    // having given the teacher one hour and skipped Office entirely.
    expect(await resolveActionDateKey(new Date("2026-08-24T11:35:00"))).toBe("2026-08-25");
  });

  test("11:29 still catches the same day", async () => {
    expect(await resolveActionDateKey(new Date("2026-08-24T11:29:00"))).toBe("2026-08-24");
  });

  test("Thursday afternoon waits for Sunday — nobody collects a notebook on Fri/Sat", async () => {
    expect(await resolveActionDateKey(new Date("2026-08-27T15:00:00"))).toBe("2026-08-30");
  });

  test("a holiday on the next day is skipped too", async () => {
    mockResolveDayType.mockImplementation(async (d: Date) => {
      if (d.getDate() === 25) return "HOLIDAY";
      const day = d.getDay();
      return day === 5 || day === 6 ? "OFF" : "FULL";
    });
    expect(await resolveActionDateKey(new Date("2026-08-24T20:00:00"))).toBe("2026-08-26");
  });
});

// ---------------------------------------------------------------------------
// §6.1 — the five file guards (D-#550)
// ---------------------------------------------------------------------------

describe("fileWorkClaim — the guard table", () => {
  const input = {
    tracker: "HOMEWORK" as const,
    recordId: RECORD.toString(),
    guardianId: GUARDIAN.toString(),
    actorUserId: USER.toString(),
    at: new Date("2026-08-25T09:00:00"),
  };

  test.each(["DUE", "CHASE"])("a %s record may be claimed", async (state) => {
    mockHwFindById.mockResolvedValue(hwRecord({ state }));
    const claim = await fileWorkClaim(input);
    expect(claim.status).toBe("PENDING");
    expect(claim.attemptNumber).toBe(1);
    expect(mockClaimCreate).toHaveBeenCalled();
  });

  test.each(["GIVEN", "ABSENT_REDELIVER", "SUBMITTED", "CHECKED", "RETURNED"])(
    "a %s record is REFUSED",
    async (state) => {
      mockHwFindById.mockResolvedValue(hwRecord({ state }));
      await expect(fileWorkClaim(input)).rejects.toBeInstanceOf(WorkClaimError);
      expect(mockClaimCreate).not.toHaveBeenCalled();
    },
  );

  test("ABSENT_REDELIVER is refused because the child never RECEIVED the work", async () => {
    mockHwFindById.mockResolvedValue(hwRecord({ state: "ABSENT_REDELIVER" }));
    await expect(fileWorkClaim(input)).rejects.toThrow(/জানানো যাবে না/);
  });

  test("filing twice returns the EXISTING claim and creates nothing (idempotent)", async () => {
    const existing = { _id: oid(), status: "PENDING" };
    mockClaimFindOne.mockResolvedValue(existing);
    const claim = await fileWorkClaim(input);
    expect(claim).toBe(existing);
    expect(mockClaimCreate).not.toHaveBeenCalled();
  });

  test("a third attempt is refused — one re-claim only", async () => {
    mockClaimCount.mockResolvedValue(2);
    await expect(fileWorkClaim(input)).rejects.toThrow(/আর জানানো যাবে না/);
  });

  test("the second attempt is allowed and numbered 2", async () => {
    mockClaimCount.mockResolvedValue(1);
    const claim = await fileWorkClaim(input);
    expect(claim.attemptNumber).toBe(2);
  });

  test("a guardian NOT linked to the record's student is refused", async () => {
    mockLinkFindOne.mockResolvedValue(null);
    await expect(fileWorkClaim(input)).rejects.toThrow(/অনুমতি নেই/);
  });

  test("an INACTIVE link is refused", async () => {
    mockLinkFindOne.mockResolvedValue({ active: false });
    await expect(fileWorkClaim(input)).rejects.toThrow(/অনুমতি নেই/);
  });

  test("work older than the 7-school-day window is refused", async () => {
    mockHwFindById.mockResolvedValue(
      hwRecord({ dueDate: new Date("2026-07-01T00:00:00") }),
    );
    await expect(fileWorkClaim(input)).rejects.toThrow(/সময়সীমা/);
  });

  test("the action day is STORED on the row, not recomputed later", async () => {
    const claim = await fileWorkClaim(input);
    expect(claim.actionDateKey).toBe("2026-08-25");
  });

  test("the note is trimmed and capped at 200 characters", async () => {
    const claim = await fileWorkClaim({ ...input, note: "  " + "খ".repeat(300) + "  " });
    expect((claim.note as string).length).toBe(200);
  });

  test("assignments are claimable through the same one row type", async () => {
    mockAsFindById.mockResolvedValue({
      _id: RECORD,
      asId: "AS-C4-BAN-0003",
      studentId: STUDENT,
      sectionId: oid(),
      classId: oid(),
      state: "DUE",
      dueDate: new Date("2026-08-24T00:00:00"),
      issuedBy: TEACHER,
      asItemId: oid(),
    });
    const claim = await fileWorkClaim({ ...input, tracker: "ASSIGNMENT" });
    expect(claim.tracker).toBe("ASSIGNMENT");
    expect(claim.workId).toBe("AS-C4-BAN-0003");
  });

  test("the claim NEVER writes a lifecycle state (D-#548)", async () => {
    const rec = hwRecord();
    mockHwFindById.mockResolvedValue(rec);
    await fileWorkClaim(input);
    // The record object is read via .lean() — a plain object. Nothing may have
    // touched its state, and no save path exists on it at all.
    expect(rec.state).toBe("CHASE");
    expect((rec as Record<string, unknown>).save).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §6.2 — auto-accept (D-#549)
// ---------------------------------------------------------------------------

describe("acceptClaimsForRecords — closes on the teacher's ordinary submit", () => {
  function openClaim() {
    return {
      _id: oid(),
      tracker: "HOMEWORK",
      workId: "HW-1",
      status: "PENDING",
      resolution: undefined as string | undefined,
      resolvedAt: undefined as Date | undefined,
      resolvedBy: undefined as unknown,
      save: jest.fn().mockResolvedValue(undefined),
    };
  }

  test("an open claim becomes ACCEPTED with resolution AUTO", async () => {
    const claim = openClaim();
    mockClaimFind.mockResolvedValue([claim]);
    const accepted = await acceptClaimsForRecords([RECORD], USER.toString());
    expect(accepted).toHaveLength(1);
    expect(claim.status).toBe("ACCEPTED");
    expect(claim.resolution).toBe("AUTO");
    expect(claim.save).toHaveBeenCalled();
  });

  test("no records is a cheap no-op — the database is not asked", async () => {
    expect(await acceptClaimsForRecords([], USER.toString())).toEqual([]);
    expect(mockClaimFind).not.toHaveBeenCalled();
  });

  test("a failure NEVER throws into the submit that called it (D-#549)", async () => {
    // A claim row must never be able to fail a teacher's submit. Worst case the
    // claim stays open and escalates once more.
    mockClaimFind.mockRejectedValue(new Error("mongo is down"));
    await expect(acceptClaimsForRecords([RECORD], USER.toString())).resolves.toEqual([]);
  });
});
// ---------------------------------------------------------------------------
// The manual close (D-#549)
// ---------------------------------------------------------------------------

describe("rejectWorkClaim — the only manual close, and it demands a reason", () => {
  function pending() {
    return {
      _id: oid(),
      tracker: "HOMEWORK",
      workId: "HW-1",
      status: "PENDING",
      save: jest.fn().mockResolvedValue(undefined),
    };
  }

  test("a picker reason is recorded and the claim closes", async () => {
    const claim = pending();
    mockClaimFindById.mockResolvedValue(claim);
    const out = await rejectWorkClaim({
      claimId: claim._id.toString(),
      actorId: TEACHER.toString(),
      reason: "NOT_BROUGHT",
    });
    expect(out.status).toBe("REJECTED");
    expect(out.rejectReason).toBe("NOT_BROUGHT");
    expect(out.resolution).toBe("MANUAL");
  });

  test("OTHER without a note is refused — an unexplained OTHER helps nobody", async () => {
    mockClaimFindById.mockResolvedValue(pending());
    await expect(
      rejectWorkClaim({
        claimId: oid().toString(),
        actorId: TEACHER.toString(),
        reason: "OTHER",
      }),
    ).rejects.toThrow(/কারণটি লিখতে হবে/);
  });

  test("an already-resolved claim cannot be rejected again", async () => {
    mockClaimFindById.mockResolvedValue({ ...pending(), status: "ACCEPTED" });
    await expect(
      rejectWorkClaim({
        claimId: oid().toString(),
        actorId: TEACHER.toString(),
        reason: "NOT_BROUGHT",
      }),
    ).rejects.toThrow(/ইতিমধ্যেই নিষ্পন্ন/);
  });
});

// ---------------------------------------------------------------------------
// §6.4 — the chase suppression lookup
// ---------------------------------------------------------------------------

describe("recordsWithOpenClaims — what mutes the family-facing chase push", () => {
  test("returns the set of records currently carrying an open claim", async () => {
    const a = oid();
    const b = oid();
    mockClaimFind.mockReturnValue({ select: () => ({ lean: async () => [{ recordId: a }] }) });
    const set = await recordsWithOpenClaims([a, b]);
    expect(set.has(a.toString())).toBe(true);
    expect(set.has(b.toString())).toBe(false);
  });

  test("an empty input asks the database nothing", async () => {
    const set = await recordsWithOpenClaims([]);
    expect(set.size).toBe(0);
    expect(mockClaimFind).not.toHaveBeenCalled();
  });
});
