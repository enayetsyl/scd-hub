/**
 * LB-5 — overdue chasing + reminders (prd-library §6 LB-5, D-#84).
 *
 *   J-L8  chase list: overdue loans grouped by borrower type; a STUDENT row
 *         carries the FAMILY phone + a wa.me link; a GUARDIAN row the guardian
 *         phone + link; a STAFF row gets NO wa.me link (chased in-app); the
 *         link text never mentions money (D-#27)
 *   Emitters ride emit() with stable dedupeKeys (idempotent per loan / rung):
 *         due-tomorrow → LIBRARY_DUE_SOON once; overdue → LIBRARY_OVERDUE on
 *         school-day rungs 1, 4, 7 … (overdueRungFor); a STUDENT borrower's
 *         reminders fan out to login-enabled linked guardians only
 *
 * DB-free: models + emit() mocked, the services real.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
// A fixed local "now": Saturday 2026-06-13 10:00 local time.
const NOW = new Date(2026, 5, 13, 10, 0, 0);
const localKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// Mocks BEFORE importing the services under test
// ---------------------------------------------------------------------------

const mockLoanFind = jest.fn();
jest.mock("../modules/library/models/BookLoan", () => ({
  BookLoan: {
    find: (f: unknown) => {
      const out = mockLoanFind(f);
      const chain = {
        sort: () => ({ lean: () => Promise.resolve(out) }),
        select: () => ({ lean: () => Promise.resolve(out) }),
        lean: () => Promise.resolve(out),
      };
      return chain;
    },
  },
}));

const mockTitleFind = jest.fn();
jest.mock("../modules/library/models/BookTitle", () => ({
  BookTitle: {
    find: (f: unknown) => ({ select: () => ({ lean: () => Promise.resolve(mockTitleFind(f)) }) }),
  },
}));

const mockCopyFind = jest.fn();
jest.mock("../modules/library/models/BookCopy", () => ({
  BookCopy: {
    find: (f: unknown) => ({ select: () => ({ lean: () => Promise.resolve(mockCopyFind(f)) }) }),
  },
}));

const mockStudentFind = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: (f: unknown) => ({ select: () => ({ lean: () => Promise.resolve(mockStudentFind(f)) }) }) },
}));
const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (f: unknown) => ({ select: () => ({ lean: () => Promise.resolve(mockUserFind(f)) }) }) },
}));
const mockGuardianFind = jest.fn();
const mockGuardianFindOne = jest.fn();
jest.mock("../modules/foundation/models/Guardian", () => ({
  Guardian: {
    find: (f: unknown) => ({ select: () => ({ lean: () => Promise.resolve(mockGuardianFind(f)) }) }),
    findOne: (f: unknown) => ({ select: () => ({ lean: () => Promise.resolve(mockGuardianFindOne(f)) }) }),
  },
}));
const mockLinkFind = jest.fn();
jest.mock("../modules/foundation/models/GuardianLink", () => ({
  GuardianLink: { find: (f: unknown) => ({ select: () => ({ lean: () => Promise.resolve(mockLinkFind(f)) }) }) },
}));

const mockEmit = jest.fn();
jest.mock("../modules/notifications/services/NotificationService", () => ({
  emit: (input: unknown) => mockEmit(input),
}));

const mockResolveDayType = jest.fn();
jest.mock("../modules/routine/calendar", () => ({
  resolveDayType: (d: Date) => mockResolveDayType(d),
}));

// Import AFTER mocks
import {
  libraryChaseList,
  buildOverdueReminderLink,
  daysOverdueOf,
} from "../modules/library/services/LibraryChaseService";
import {
  dispatchLibraryReminders,
  overdueRungFor,
  countSchoolDaysBetween,
  libraryDedupeKeys,
} from "../modules/library/services/LibraryReminderService";

beforeEach(() => {
  jest.clearAllMocks();
  mockEmit.mockResolvedValue({ created: true, dedupeKey: "x" });
  mockLoanFind.mockReturnValue([]);
  mockTitleFind.mockReturnValue([]);
  mockCopyFind.mockReturnValue([]);
  mockStudentFind.mockReturnValue([]);
  mockUserFind.mockReturnValue([]);
  mockGuardianFind.mockReturnValue([]);
  mockGuardianFindOne.mockReturnValue(null);
  mockLinkFind.mockReturnValue([]);
  // Default calendar: every day is a school day.
  mockResolveDayType.mockResolvedValue("FULL");
});

// ===========================================================================
// J-L8 — the chase list
// ===========================================================================

describe("libraryChaseList (J-L8)", () => {
  test("groups by borrower type with the right phone; staff rows get no wa.me link", async () => {
    const studentId = oid();
    const staffId = oid();
    const guardianId = oid();
    const titleId = oid();
    const copyId = oid();
    const past = new Date(NOW.getTime() - 3 * DAY);
    mockLoanFind.mockReturnValue([
      { _id: oid(), borrowerType: "STAFF", userId: staffId, titleId, copyId, dueDate: past },
      { _id: oid(), borrowerType: "STUDENT", studentId, titleId, copyId, dueDate: past },
      { _id: oid(), borrowerType: "GUARDIAN", guardianId, titleId, copyId, dueDate: past },
    ]);
    mockStudentFind.mockReturnValue([
      { _id: studentId, name: "Student S", nameBn: "শিক্ষার্থী", phone: "01711-111111" },
    ]);
    mockUserFind.mockReturnValue([{ _id: staffId, name: "Teacher T", phone: "01722222222" }]);
    mockGuardianFind.mockReturnValue([{ _id: guardianId, name: "Guardian G", phone: "01733333333" }]);
    mockTitleFind.mockReturnValue([{ _id: titleId, titleBn: "সীরাত গ্রন্থ" }]);
    mockCopyFind.mockReturnValue([{ _id: copyId, accessionNo: "ACC-001" }]);

    const rows = await libraryChaseList(NOW);
    expect(rows.map((r) => r.borrowerType)).toEqual(["STUDENT", "GUARDIAN", "STAFF"]); // grouped order
    const student = rows[0];
    expect(student.borrowerName).toBe("শিক্ষার্থী");
    expect(student.phone).toBe("01711-111111"); // the family phone
    expect(student.waLink).toMatch(/^https:\/\/wa\.me\/01711111111\?text=/); // normalized
    expect(student.daysOverdue).toBe(3);
    const guardian = rows[1];
    expect(guardian.waLink).toMatch(/^https:\/\/wa\.me\/01733333333\?text=/);
    const staff = rows[2];
    expect(staff.phone).toBe("01722222222");
    expect(staff.waLink).toBeNull(); // staff are chased in-app
  });

  test("the wa.me message asks for the return and never mentions money (D-#27)", async () => {
    const link = await buildOverdueReminderLink({
      toPhone: "01700000000",
      borrowerName: "অভিভাবক",
      titleBn: "সীরাত গ্রন্থ",
      accessionNo: "ACC-001",
      dueDateKey: "2026-06-10",
    });
    const msg = decodeURIComponent(link.split("?text=")[1]);
    expect(msg).toContain("সীরাত গ্রন্থ");
    expect(msg).toContain("ACC-001");
    expect(msg).toContain("2026-06-10");
    expect(msg).not.toMatch(/টাকা|জরিমানা|fine|fee/i);
  });

  test("no overdue loans → empty list", async () => {
    await expect(libraryChaseList(NOW)).resolves.toEqual([]);
  });

  test("daysOverdueOf is whole days past due", () => {
    expect(daysOverdueOf(new Date(NOW.getTime() - 1.5 * DAY), NOW)).toBe(1);
    expect(daysOverdueOf(new Date(NOW.getTime() + DAY), NOW)).toBe(0);
  });
});

// ===========================================================================
// Reminder ladder — emit() seam (D-#72/#84)
// ===========================================================================

describe("overdueRungFor — school-day ladder (day after due, then every 3rd)", () => {
  test("rungs advance on school days 1, 4, 7…", () => {
    expect(overdueRungFor(0)).toBe(0);
    expect(overdueRungFor(1)).toBe(1);
    expect(overdueRungFor(2)).toBe(1);
    expect(overdueRungFor(3)).toBe(1);
    expect(overdueRungFor(4)).toBe(2);
    expect(overdueRungFor(6)).toBe(2);
    expect(overdueRungFor(7)).toBe(3);
  });
});

describe("countSchoolDaysBetween", () => {
  test("counts only school days (OFF/HOLIDAY days don't advance the ladder)", async () => {
    // 4 calendar days; mark the 2nd one OFF.
    let call = 0;
    mockResolveDayType.mockImplementation(() => {
      call += 1;
      return Promise.resolve(call === 2 ? "OFF" : "FULL");
    });
    await expect(countSchoolDaysBetween("2026-06-08", "2026-06-12")).resolves.toBe(3);
  });

  test("empty/inverted range → 0", async () => {
    await expect(countSchoolDaysBetween("2026-06-12", "2026-06-12")).resolves.toBe(0);
    await expect(countSchoolDaysBetween("2026-06-13", "2026-06-12")).resolves.toBe(0);
  });
});

describe("dispatchLibraryReminders", () => {
  test("a loan due TOMORROW emits LIBRARY_DUE_SOON to a staff borrower once (stable dedupeKey)", async () => {
    const loanId = oid();
    const staffId = oid();
    const tomorrow = new Date(NOW.getTime() + DAY);
    mockLoanFind.mockReturnValue([
      { _id: loanId, titleId: oid(), borrowerType: "STAFF", userId: staffId, dueDate: tomorrow },
    ]);
    const summary = await dispatchLibraryReminders(NOW);
    expect(summary.dueSoonEmitted).toBe(1);
    expect(summary.overdueEmitted).toBe(0);
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "LIBRARY_DUE_SOON",
        recipientUserId: staffId.toString(),
        dedupeKey: libraryDedupeKeys.dueSoon(loanId.toString()),
      }),
    );
  });

  test("an overdue STUDENT loan fans out to login-enabled linked guardians only, keyed per rung+guardian", async () => {
    const loanId = oid();
    const studentId = oid();
    const g1 = oid(); // login-enabled
    const g2 = oid(); // contact-only — must get nothing
    const due = new Date(NOW.getTime() - 2 * DAY); // 2 school days since due → rung 1
    mockLoanFind.mockReturnValue([
      { _id: loanId, titleId: oid(), borrowerType: "STUDENT", studentId, dueDate: due },
    ]);
    mockLinkFind.mockReturnValue([{ guardianId: g1 }, { guardianId: g2 }]);
    mockGuardianFind.mockReturnValue([{ _id: g1 }]); // loginEnabled filter keeps only g1

    const summary = await dispatchLibraryReminders(NOW);
    expect(summary.overdueEmitted).toBe(1);
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "LIBRARY_OVERDUE",
        recipientGuardianId: g1.toString(),
        dedupeKey: `${libraryDedupeKeys.overdue(loanId.toString(), 1)}:${g1.toString()}`,
      }),
    );
  });

  test("a contact-only GUARDIAN borrower gets no inbox row (wa.me-only, D-#31 limitation)", async () => {
    const due = new Date(NOW.getTime() - 2 * DAY);
    mockLoanFind.mockReturnValue([
      { _id: oid(), titleId: oid(), borrowerType: "GUARDIAN", guardianId: oid(), dueDate: due },
    ]);
    mockGuardianFindOne.mockReturnValue(null); // not login-enabled
    const summary = await dispatchLibraryReminders(NOW);
    expect(summary.overdueEmitted).toBe(0);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  test("a re-run is a no-op when emit() reports duplicates (idempotent pass)", async () => {
    const staffId = oid();
    mockLoanFind.mockReturnValue([
      { _id: oid(), titleId: oid(), borrowerType: "STAFF", userId: staffId, dueDate: new Date(NOW.getTime() - 2 * DAY) },
    ]);
    mockEmit.mockResolvedValue({ created: false, dedupeKey: "dup" });
    const summary = await dispatchLibraryReminders(NOW);
    expect(mockEmit).toHaveBeenCalledTimes(1); // the seam is still called…
    expect(summary.overdueEmitted).toBe(0); // …but nothing new was written
  });

  test("a loan inside its window (not due tomorrow, not past) emits nothing", async () => {
    mockLoanFind.mockReturnValue([
      { _id: oid(), titleId: oid(), borrowerType: "STAFF", userId: oid(), dueDate: new Date(NOW.getTime() + 5 * DAY) },
    ]);
    const summary = await dispatchLibraryReminders(NOW);
    expect(summary).toEqual({ dueSoonEmitted: 0, overdueEmitted: 0 });
    expect(mockEmit).not.toHaveBeenCalled();
  });

  test("due-soon keys differ per guardian for a STUDENT borrower (no cross-guardian dedupe)", async () => {
    const loanId = oid();
    const studentId = oid();
    const g1 = oid();
    const g2 = oid();
    const tomorrow = new Date(NOW.getTime() + DAY);
    mockLoanFind.mockReturnValue([
      { _id: loanId, titleId: oid(), borrowerType: "STUDENT", studentId, dueDate: tomorrow },
    ]);
    mockLinkFind.mockReturnValue([{ guardianId: g1 }, { guardianId: g2 }]);
    mockGuardianFind.mockReturnValue([{ _id: g1 }, { _id: g2 }]);
    await dispatchLibraryReminders(NOW);
    const keys = mockEmit.mock.calls.map((c) => (c[0] as { dedupeKey: string }).dedupeKey);
    expect(new Set(keys).size).toBe(2);
    expect(keys.every((k) => k.startsWith(`LIBDS:${loanId.toString()}`))).toBe(true);
  });

  test(`local date keys sanity (today=${localKey(NOW)})`, () => {
    expect(localKey(new Date(NOW.getTime() + DAY)) > localKey(NOW)).toBe(true);
  });
});
