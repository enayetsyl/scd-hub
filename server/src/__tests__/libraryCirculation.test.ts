/**
 * LB-2 — circulation: issue / return / renew / lost (prd-library §6 LB-2).
 *
 *   J-L2  per-type maxConcurrent enforced (student 2 denied, staff under 4 ok);
 *         due date honors the borrower-type policy (7 vs 14 calendar days)
 *   issue rules: non-AVAILABLE refused; ON_HOLD issues ONLY to the READY
 *         reservation's borrower (and fulfills it)
 *   J-L4  return → RETURNED + timestamp; copy released through the queue seam
 *   J-L5  renew extends dueDate by loanDays; blocked at maxRenewals; blocked
 *         while a reservation exists on the title
 *   J-L7  lost → loan LOST + copy LOST + note; NO money field exists anywhere
 *         (schema-level assertion, D-#27)
 *
 * DB-free: models mocked; policy resolution real (no DB row → PRD defaults).
 */
import mongoose from "mongoose";
import { LibraryError } from "../modules/library/errors";

const oid = () => new mongoose.Types.ObjectId();
const doc = <T extends Record<string, unknown>>(obj: T) => ({
  ...obj,
  save: jest.fn().mockResolvedValue(undefined),
});

// ---------------------------------------------------------------------------
// Mocks BEFORE importing the service under test
// ---------------------------------------------------------------------------

const mockCopyFindOne = jest.fn();
const mockCopyFindById = jest.fn();
jest.mock("../modules/library/models/BookCopy", () => ({
  BookCopy: {
    findOne: (f: unknown) => mockCopyFindOne(f),
    findById: (id: unknown) => mockCopyFindById(id),
  },
}));

const mockLoanCreate = jest.fn();
const mockLoanFindById = jest.fn();
const mockLoanCount = jest.fn();
const mockLoanFind = jest.fn();
jest.mock("../modules/library/models/BookLoan", () => ({
  BookLoan: {
    create: (d: unknown) => mockLoanCreate(d),
    findById: (id: unknown) => mockLoanFindById(id),
    countDocuments: (f: unknown) => mockLoanCount(f),
    find: (f: unknown) => ({ sort: () => ({ lean: () => mockLoanFind(f) }) }),
  },
}));

// Policy stays REAL — the model returns no row, so the PRD working values apply.
const mockPolicyFindOne = jest.fn();
jest.mock("../modules/library/models/LibraryPolicy", () => ({
  LibraryPolicy: { findOne: (f: unknown) => ({ lean: () => mockPolicyFindOne(f) }) },
}));

// Reservation seam mocked (LB-3 has its own suite); addDays/holdLapsed kept real.
const mockExpireLapsed = jest.fn();
const mockReleaseToQueue = jest.fn();
const mockBlocksRenewal = jest.fn();
const mockReadyForCopy = jest.fn();
const mockFulfill = jest.fn();
jest.mock("../modules/library/services/LibraryReservationService", () => ({
  ...jest.requireActual("../modules/library/services/LibraryReservationService"),
  expireLapsedHolds: (titleId: unknown, now: unknown) => mockExpireLapsed(titleId, now),
  releaseCopyToQueue: (copy: unknown, now: unknown) => mockReleaseToQueue(copy, now),
  reservationBlocksRenewal: (titleId: unknown) => mockBlocksRenewal(titleId),
  readyReservationForCopy: (copyId: unknown) => mockReadyForCopy(copyId),
  fulfillReservation: (id: unknown) => mockFulfill(id),
}));

const mockStudentFindById = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { findById: (id: unknown) => ({ lean: () => mockStudentFindById(id) }) },
}));
const mockUserFindById = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { findById: (id: unknown) => ({ lean: () => mockUserFindById(id) }) },
}));
const mockGuardianFindById = jest.fn();
jest.mock("../modules/foundation/models/Guardian", () => ({
  Guardian: { findById: (id: unknown) => ({ lean: () => mockGuardianFindById(id) }) },
}));

const mockWriteAudit = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

// Import AFTER mocks
import {
  issueBook,
  returnBook,
  renewLoan,
  markLost,
  isOverdue,
} from "../modules/library/services/LibraryCirculationService";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-13T10:00:00.000Z");
const actor = oid().toString();
const studentBorrower = { type: "STUDENT" as const, id: oid().toString() };
const staffBorrower = { type: "STAFF" as const, id: oid().toString() };

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
  mockPolicyFindOne.mockResolvedValue(null); // PRD defaults in force
  mockExpireLapsed.mockResolvedValue(0);
  mockReleaseToQueue.mockResolvedValue(false);
  mockBlocksRenewal.mockResolvedValue(false);
  mockReadyForCopy.mockResolvedValue(null);
  mockFulfill.mockResolvedValue(undefined);
  mockStudentFindById.mockResolvedValue({ _id: studentBorrower.id, active: true });
  mockUserFindById.mockResolvedValue({ _id: staffBorrower.id, active: true });
  mockGuardianFindById.mockResolvedValue({ _id: oid(), active: true });
  mockLoanCount.mockResolvedValue(0);
  mockLoanCreate.mockImplementation((d: Record<string, unknown>) => Promise.resolve({ _id: oid(), ...d }));
});

function availableCopy() {
  const copy = doc({ _id: oid(), titleId: oid(), accessionNo: "ACC-001", status: "AVAILABLE" });
  mockCopyFindOne.mockResolvedValue(copy);
  mockCopyFindById.mockResolvedValue(copy);
  return copy;
}

// ===========================================================================
// issueBook
// ===========================================================================

describe("issueBook — policy-driven issue (J-L2)", () => {
  test("an AVAILABLE copy issues to a STUDENT with dueDate = +7 calendar days (default policy)", async () => {
    const copy = availableCopy();
    const loan = await issueBook("ACC-001", studentBorrower, actor, NOW);
    expect(loan.status).toBe("ACTIVE");
    expect(new Date(loan.dueDate).getTime()).toBe(NOW.getTime() + 7 * DAY);
    expect(copy.status).toBe("ON_LOAN");
    expect(copy.save).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "BOOK_ISSUED" }));
    // lazy expiry ran before the decision (D-#21/D-#83)
    expect(mockExpireLapsed).toHaveBeenCalledWith(copy.titleId.toString(), NOW);
  });

  test("a STAFF borrower gets the staff policy (14 days)", async () => {
    availableCopy();
    const loan = await issueBook("ACC-001", staffBorrower, actor, NOW);
    expect(new Date(loan.dueDate).getTime()).toBe(NOW.getTime() + 14 * DAY);
  });

  test("J-L2: a STUDENT at maxConcurrent=2 is denied in Bangla; STAFF under 4 succeeds", async () => {
    availableCopy();
    mockLoanCount.mockResolvedValue(2);
    await expect(issueBook("ACC-001", studentBorrower, actor, NOW)).rejects.toThrow(/সর্বোচ্চ 2টি বই/);
    expect(mockLoanCreate).not.toHaveBeenCalled();

    mockLoanCount.mockResolvedValue(2); // 2 < staff limit 4
    await expect(issueBook("ACC-001", staffBorrower, actor, NOW)).resolves.toMatchObject({ status: "ACTIVE" });
  });

  test("a non-AVAILABLE copy (ON_LOAN / LOST / WITHDRAWN) is refused", async () => {
    for (const status of ["ON_LOAN", "LOST", "WITHDRAWN"]) {
      const copy = doc({ _id: oid(), titleId: oid(), status });
      mockCopyFindOne.mockResolvedValue(copy);
      mockCopyFindById.mockResolvedValue(copy);
      await expect(issueBook("ACC-001", studentBorrower, actor, NOW)).rejects.toThrow(LibraryError);
    }
    expect(mockLoanCreate).not.toHaveBeenCalled();
  });

  test("unknown accession number / inactive borrower refused", async () => {
    mockCopyFindOne.mockResolvedValue(null);
    await expect(issueBook("ACC-404", studentBorrower, actor, NOW)).rejects.toThrow(/ACC-404 পাওয়া যায়নি/);

    availableCopy();
    mockStudentFindById.mockResolvedValue({ _id: studentBorrower.id, active: false });
    await expect(issueBook("ACC-001", studentBorrower, actor, NOW)).rejects.toThrow(LibraryError);
  });

  test("an ON_HOLD copy issues ONLY to the READY reservation's borrower and fulfills it", async () => {
    const copy = doc({ _id: oid(), titleId: oid(), accessionNo: "ACC-001", status: "ON_HOLD" });
    mockCopyFindOne.mockResolvedValue(copy);
    mockCopyFindById.mockResolvedValue(copy);
    const resvId = oid();
    mockReadyForCopy.mockResolvedValue({
      _id: resvId,
      borrowerType: "STUDENT",
      studentId: studentBorrower.id,
    });

    // the wrong borrower is turned away
    await expect(issueBook("ACC-001", staffBorrower, actor, NOW)).rejects.toThrow(/অন্য পাঠকের জন্য সংরক্ষিত/);
    expect(mockFulfill).not.toHaveBeenCalled();

    // the right borrower fulfills the hold
    const loan = await issueBook("ACC-001", studentBorrower, actor, NOW);
    expect(loan.status).toBe("ACTIVE");
    expect(mockFulfill).toHaveBeenCalledWith(resvId.toString());
    expect(copy.status).toBe("ON_LOAN");
  });
});

// ===========================================================================
// returnBook (J-L4)
// ===========================================================================

describe("returnBook", () => {
  test("an ACTIVE loan returns with timestamp; the copy is released through the queue seam", async () => {
    const copy = doc({ _id: oid(), titleId: oid(), status: "ON_LOAN" });
    const loan = doc({ _id: oid(), copyId: copy._id, titleId: copy.titleId, status: "ACTIVE" });
    mockLoanFindById.mockResolvedValue(loan);
    mockCopyFindById.mockResolvedValue(copy);

    const out = await returnBook(loan._id.toString(), actor, NOW);
    expect(out.status).toBe("RETURNED");
    expect(out.returnedAt).toEqual(NOW);
    expect(mockReleaseToQueue).toHaveBeenCalledWith(copy, NOW);
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "BOOK_RETURNED" }));
  });

  test("a non-ACTIVE loan cannot be returned twice", async () => {
    mockLoanFindById.mockResolvedValue(doc({ _id: oid(), status: "RETURNED" }));
    await expect(returnBook(oid().toString(), actor, NOW)).rejects.toThrow(/চলমান নয়/);
  });
});

// ===========================================================================
// renewLoan (J-L5)
// ===========================================================================

describe("renewLoan", () => {
  function activeLoan(renewCount: number, borrowerType = "STUDENT") {
    const due = new Date(NOW.getTime() + 2 * DAY);
    return doc({
      _id: oid(),
      titleId: oid(),
      copyId: oid(),
      borrowerType,
      studentId: borrowerType === "STUDENT" ? oid() : undefined,
      userId: borrowerType === "STAFF" ? oid() : undefined,
      status: "ACTIVE",
      renewCount,
      dueDate: due,
    });
  }

  test("renewal extends dueDate by the type's loanDays and bumps renewCount", async () => {
    const loan = activeLoan(0);
    const originalDue = loan.dueDate.getTime();
    mockLoanFindById.mockResolvedValue(loan);
    const out = await renewLoan(loan._id.toString(), actor, NOW);
    expect(out.renewCount).toBe(1);
    expect(new Date(out.dueDate).getTime()).toBe(originalDue + 7 * DAY);
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "BOOK_RENEWED" }));
  });

  test("blocked at the type's maxRenewals (student default 1)", async () => {
    const loan = activeLoan(1);
    mockLoanFindById.mockResolvedValue(loan);
    await expect(renewLoan(loan._id.toString(), actor, NOW)).rejects.toThrow(/নবায়নের সীমা/);
  });

  test("J-L5: blocked while ANY reservation (QUEUED/READY) exists on the title", async () => {
    const loan = activeLoan(0);
    mockLoanFindById.mockResolvedValue(loan);
    mockBlocksRenewal.mockResolvedValue(true);
    await expect(renewLoan(loan._id.toString(), actor, NOW)).rejects.toThrow(/সংরক্ষণ অপেক্ষমাণ/);
    expect(loan.renewCount).toBe(0);
  });

  test("the lazy-expiry pass runs BEFORE the block decision (a lapsed hold frees renewal)", async () => {
    const loan = activeLoan(0);
    mockLoanFindById.mockResolvedValue(loan);
    await renewLoan(loan._id.toString(), actor, NOW);
    const expireOrder = mockExpireLapsed.mock.invocationCallOrder[0];
    const blockOrder = mockBlocksRenewal.mock.invocationCallOrder[0];
    expect(expireOrder).toBeLessThan(blockOrder);
  });
});

// ===========================================================================
// markLost (J-L7, D-#27)
// ===========================================================================

describe("markLost — replacement note, never money", () => {
  test("loan LOST + copy LOST + note stored", async () => {
    const copy = doc({ _id: oid(), titleId: oid(), status: "ON_LOAN" });
    const loan = doc({ _id: oid(), copyId: copy._id, titleId: copy.titleId, status: "ACTIVE" });
    mockLoanFindById.mockResolvedValue(loan);
    mockCopyFindById.mockResolvedValue(copy);

    const out = await markLost(loan._id.toString(), "  অভিভাবক নতুন কপি দেবেন  ", actor);
    expect(out.status).toBe("LOST");
    expect(out.lostNote).toBe("অভিভাবক নতুন কপি দেবেন");
    expect(copy.status).toBe("LOST");
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "BOOK_MARKED_LOST" }));
  });

  test("a blank note is rejected (J-L7 requires the replacement record)", async () => {
    await expect(markLost(oid().toString(), "   ", actor)).rejects.toThrow(/টীকা আবশ্যক/);
  });

  test("NO money field exists anywhere on the loan schema (D-#27, structural)", () => {
    const { BookLoan: RealBookLoan } = jest.requireActual("../modules/library/models/BookLoan");
    const paths = Object.keys(RealBookLoan.schema.paths);
    for (const path of paths) {
      expect(path).not.toMatch(/fine|fee|amount|money|taka|price|charge/i);
    }
  });
});

// ===========================================================================
// isOverdue — computed, never stored (D-#82)
// ===========================================================================

describe("isOverdue", () => {
  test("ACTIVE past due → true; future due → false; RETURNED past due → false", () => {
    const past = new Date(NOW.getTime() - DAY);
    const future = new Date(NOW.getTime() + DAY);
    expect(isOverdue({ status: "ACTIVE", dueDate: past } as never, NOW)).toBe(true);
    expect(isOverdue({ status: "ACTIVE", dueDate: future } as never, NOW)).toBe(false);
    expect(isOverdue({ status: "RETURNED", dueDate: past } as never, NOW)).toBe(false);
    expect(isOverdue({ status: "LOST", dueDate: past } as never, NOW)).toBe(false);
  });
});
