/**
 * LB-3 — reservations (prd-library §6 LB-3, D-#83 / D-#21).
 *
 *   reserveTitle: QUEUED row + RESERVATION_PLACED audit; duplicate active
 *     reservation per (title, borrower) rejected; rejected while the borrower
 *     already holds a copy of the title
 *   J-L6 FIFO: on release the OLDEST QUEUED reservation goes READY on the
 *     copy (copy ON_HOLD) with the reserver type's holdDays window; no queue →
 *     copy AVAILABLE
 *   Lazy expiry (the ONE truth): a READY hold past expiresAt flips EXPIRED
 *     (audited) on the next touch and the next QUEUED borrower is promoted
 *   renewal-block predicate; cancel releases a held copy onward
 *
 * DB-free: models mocked; policy real (no DB row → PRD defaults, holdDays 3).
 */
import mongoose from "mongoose";
import { LibraryError } from "../modules/library/errors";

const oid = () => new mongoose.Types.ObjectId();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const doc = <T extends Record<string, unknown>>(obj: T): T & { save: jest.Mock } & Record<string, any> => ({
  ...obj,
  save: jest.fn().mockResolvedValue(undefined),
});

// ---------------------------------------------------------------------------
// Mocks BEFORE importing the service under test
// ---------------------------------------------------------------------------

// BookReservation is used through several chains; one mock fn per chain end.
const mockResvFind = jest.fn(); // find(filter) → array of docs (expiry scan)
const mockResvFindSorted = jest.fn(); // find().sort().lean() → array (queue read)
const mockResvFindOne = jest.fn(); // findOne(filter) → doc | null (all variants)
const mockResvCreate = jest.fn();
const mockResvFindById = jest.fn();
const mockResvUpdateOne = jest.fn();
jest.mock("../modules/library/models/BookReservation", () => ({
  BookReservation: {
    find: (f: unknown) => {
      const promise = Promise.resolve(mockResvFind(f));
      return Object.assign(promise, {
        sort: () => ({ lean: () => mockResvFindSorted(f) }),
      });
    },
    findOne: (f: unknown) => {
      const promise = Promise.resolve(mockResvFindOne(f));
      return Object.assign(promise, {
        sort: () => Promise.resolve(mockResvFindOne(f)),
        lean: () => Promise.resolve(mockResvFindOne(f)),
      });
    },
    create: (d: unknown) => mockResvCreate(d),
    findById: (id: unknown) => mockResvFindById(id),
    countDocuments: (f: unknown) => mockResvCount(f),
    updateOne: (f: unknown, u: unknown) => mockResvUpdateOne(f, u),
  },
}));
const mockResvCount = jest.fn();

const mockCopyFindById = jest.fn();
jest.mock("../modules/library/models/BookCopy", () => ({
  BookCopy: { findById: (id: unknown) => mockCopyFindById(id) },
}));

const mockTitleFindById = jest.fn();
jest.mock("../modules/library/models/BookTitle", () => ({
  BookTitle: { findById: (id: unknown) => ({ lean: () => mockTitleFindById(id) }) },
}));

const mockLoanFindOne = jest.fn();
jest.mock("../modules/library/models/BookLoan", () => ({
  BookLoan: { findOne: (f: unknown) => ({ lean: () => mockLoanFindOne(f) }) },
}));

const mockPolicyFindOne = jest.fn();
jest.mock("../modules/library/models/LibraryPolicy", () => ({
  LibraryPolicy: { findOne: (f: unknown) => ({ lean: () => mockPolicyFindOne(f) }) },
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
  reserveTitle,
  cancelReservation,
  releaseCopyToQueue,
  expireLapsedHolds,
  reservationBlocksRenewal,
  holdLapsed,
  addDays,
} from "../modules/library/services/LibraryReservationService";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-13T10:00:00.000Z");
const actor = oid().toString();
const titleId = oid().toString();
const g1 = { type: "GUARDIAN" as const, id: oid().toString() };

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
  mockPolicyFindOne.mockResolvedValue(null); // PRD defaults: holdDays 3 everywhere
  mockTitleFindById.mockResolvedValue({ _id: titleId, titleBn: "সীরাত গ্রন্থ", active: true });
  mockGuardianFindById.mockResolvedValue({ _id: g1.id, active: true });
  mockStudentFindById.mockResolvedValue({ _id: oid(), active: true });
  mockUserFindById.mockResolvedValue({ _id: oid(), active: true });
  mockResvFind.mockReturnValue([]); // no lapsed holds by default
  mockResvFindOne.mockReturnValue(null);
  mockResvCount.mockResolvedValue(0);
  mockResvCreate.mockImplementation((d: Record<string, unknown>) =>
    Promise.resolve({ _id: oid(), createdAt: NOW, ...d }),
  );
  mockResvUpdateOne.mockResolvedValue({ acknowledged: true });
  mockLoanFindOne.mockResolvedValue(null);
});

// ===========================================================================
// reserveTitle
// ===========================================================================

describe("reserveTitle", () => {
  test("creates a QUEUED reservation and audits RESERVATION_PLACED", async () => {
    const resv = await reserveTitle(titleId, g1, actor);
    expect(resv.status).toBe("QUEUED");
    expect(mockResvCreate).toHaveBeenCalledWith(
      expect.objectContaining({ titleId, borrowerType: "GUARDIAN", guardianId: g1.id, status: "QUEUED" }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "RESERVATION_PLACED" }),
    );
  });

  test("a duplicate ACTIVE reservation per (title, borrower) is rejected", async () => {
    mockResvFindOne.mockReturnValue({ _id: oid(), status: "QUEUED" });
    await expect(reserveTitle(titleId, g1, actor)).rejects.toThrow(/ইতিমধ্যে একটি সক্রিয় সংরক্ষণ/);
    expect(mockResvCreate).not.toHaveBeenCalled();
  });

  test("rejected while the borrower already holds a copy of the title", async () => {
    mockLoanFindOne.mockResolvedValue({ _id: oid(), status: "ACTIVE" });
    await expect(reserveTitle(titleId, g1, actor)).rejects.toThrow(/ইতিমধ্যে এই পাঠকের কাছে/);
  });

  test("an unknown/inactive title is rejected", async () => {
    mockTitleFindById.mockResolvedValue(null);
    await expect(reserveTitle(titleId, g1, actor)).rejects.toThrow(LibraryError);
    mockTitleFindById.mockResolvedValue({ _id: titleId, active: false });
    await expect(reserveTitle(titleId, g1, actor)).rejects.toThrow(LibraryError);
  });
});

// ===========================================================================
// J-L6 — FIFO hold on release
// ===========================================================================

describe("releaseCopyToQueue — FIFO hold (J-L6)", () => {
  test("with a queue: the head goes READY on the copy with a holdDays window; copy ON_HOLD", async () => {
    const copy = doc({ _id: oid(), titleId, status: "ON_LOAN" });
    const head = doc({ _id: oid(), titleId, borrowerType: "GUARDIAN", guardianId: g1.id, status: "QUEUED" });
    mockResvFindOne.mockReturnValue(head);

    const held = await releaseCopyToQueue(copy as never, NOW);
    expect(held).toBe(true);
    expect(head.status).toBe("READY");
    expect(head.readyAt).toEqual(NOW);
    expect(head.heldCopyId).toEqual(copy._id);
    expect((head.expiresAt as Date).getTime()).toBe(NOW.getTime() + 3 * DAY); // guardian holdDays 3
    expect(copy.status).toBe("ON_HOLD");
    // FIFO: the head query sorts by createdAt ascending
    expect(mockResvFindOne).toHaveBeenCalledWith(expect.objectContaining({ titleId: copy.titleId, status: "QUEUED" }));
  });

  test("with no queue the copy goes AVAILABLE", async () => {
    const copy = doc({ _id: oid(), titleId, status: "ON_LOAN" });
    mockResvFindOne.mockReturnValue(null);
    const held = await releaseCopyToQueue(copy as never, NOW);
    expect(held).toBe(false);
    expect(copy.status).toBe("AVAILABLE");
  });
});

// ===========================================================================
// Lazy expiry — the one truth (D-#21/D-#83)
// ===========================================================================

describe("expireLapsedHolds — lazy request-time expiry", () => {
  test("a lapsed READY hold flips EXPIRED (audited) and the next QUEUED borrower is promoted (J-L6)", async () => {
    const heldCopy = doc({ _id: oid(), titleId, status: "ON_HOLD" });
    const lapsed = doc({
      _id: oid(),
      titleId,
      borrowerType: "GUARDIAN",
      guardianId: g1.id,
      status: "READY",
      heldCopyId: heldCopy._id,
      expiresAt: new Date(NOW.getTime() - DAY),
    });
    const next = doc({ _id: oid(), titleId, borrowerType: "GUARDIAN", guardianId: oid().toString(), status: "QUEUED" });
    mockResvFind.mockReturnValue([lapsed]);
    mockCopyFindById.mockResolvedValue(heldCopy);
    mockResvFindOne.mockReturnValue(next); // the promotion query

    const count = await expireLapsedHolds(titleId, NOW);
    expect(count).toBe(1);
    expect(lapsed.status).toBe("EXPIRED");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "RESERVATION_EXPIRED" }),
    );
    // G2 promoted onto the same copy with a fresh window
    expect(next.status).toBe("READY");
    expect(next.heldCopyId).toEqual(heldCopy._id);
    expect((next.expiresAt as Date).getTime()).toBe(NOW.getTime() + 3 * DAY);
    expect(heldCopy.status).toBe("ON_HOLD");
  });

  test("expiry with an empty queue frees the copy to AVAILABLE", async () => {
    const heldCopy = doc({ _id: oid(), titleId, status: "ON_HOLD" });
    const lapsed = doc({
      _id: oid(),
      titleId,
      borrowerType: "STAFF",
      userId: oid().toString(),
      status: "READY",
      heldCopyId: heldCopy._id,
      expiresAt: new Date(NOW.getTime() - 1),
    });
    mockResvFind.mockReturnValue([lapsed]);
    mockCopyFindById.mockResolvedValue(heldCopy);
    mockResvFindOne.mockReturnValue(null);

    await expireLapsedHolds(titleId, NOW);
    expect(lapsed.status).toBe("EXPIRED");
    expect(heldCopy.status).toBe("AVAILABLE");
  });

  test("nothing lapsed → no writes, returns 0", async () => {
    mockResvFind.mockReturnValue([]);
    await expect(expireLapsedHolds(titleId, NOW)).resolves.toBe(0);
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("holdLapsed pure predicate", () => {
    expect(holdLapsed({ status: "READY", expiresAt: new Date(NOW.getTime() - 1) } as never, NOW)).toBe(true);
    expect(holdLapsed({ status: "READY", expiresAt: new Date(NOW.getTime() + 1) } as never, NOW)).toBe(false);
    expect(holdLapsed({ status: "QUEUED" } as never, NOW)).toBe(false);
  });

  test("addDays is calendar-day arithmetic", () => {
    expect(addDays(NOW, 3).getTime()).toBe(NOW.getTime() + 3 * DAY);
  });
});

// ===========================================================================
// Renewal block + cancel
// ===========================================================================

describe("reservationBlocksRenewal (J-L5 predicate)", () => {
  test("true when any QUEUED/READY reservation exists; false otherwise", async () => {
    mockResvCount.mockResolvedValue(1);
    await expect(reservationBlocksRenewal(titleId)).resolves.toBe(true);
    expect(mockResvCount).toHaveBeenCalledWith({
      titleId,
      status: { $in: ["QUEUED", "READY"] },
    });
    mockResvCount.mockResolvedValue(0);
    await expect(reservationBlocksRenewal(titleId)).resolves.toBe(false);
  });
});

describe("cancelReservation", () => {
  test("a QUEUED reservation cancels in place", async () => {
    const resv = doc({ _id: oid(), titleId, borrowerType: "STAFF", userId: oid(), status: "QUEUED" });
    mockResvFindById.mockResolvedValue(resv);
    const out = await cancelReservation(resv._id.toString());
    expect(out.status).toBe("CANCELLED");
    expect(mockCopyFindById).not.toHaveBeenCalled();
  });

  test("cancelling a READY hold releases its copy to the next in queue", async () => {
    const heldCopy = doc({ _id: oid(), titleId, status: "ON_HOLD" });
    const resv = doc({
      _id: oid(),
      titleId,
      borrowerType: "GUARDIAN",
      guardianId: g1.id,
      status: "READY",
      heldCopyId: heldCopy._id,
    });
    const next = doc({ _id: oid(), titleId, borrowerType: "STUDENT", studentId: oid(), status: "QUEUED" });
    mockResvFindById.mockResolvedValue(resv);
    mockCopyFindById.mockResolvedValue(heldCopy);
    mockResvFindOne.mockReturnValue(next);

    await cancelReservation(resv._id.toString());
    expect(resv.status).toBe("CANCELLED");
    expect(next.status).toBe("READY");
    expect(heldCopy.status).toBe("ON_HOLD");
  });

  test("a FULFILLED/EXPIRED reservation cannot be cancelled", async () => {
    mockResvFindById.mockResolvedValue(doc({ _id: oid(), status: "FULFILLED" }));
    await expect(cancelReservation(oid().toString())).rejects.toThrow(/আর সক্রিয় নয়/);
  });
});
