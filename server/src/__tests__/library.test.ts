/**
 * LB-1 — catalog + policy + librarian gate (prd-library §6 LB-1, D-#81/#82).
 *
 *   J-L1  duplicate accession number rejected (up-front + the E11000 race)
 *   availability computed — WITHDRAWN/ON_LOAN/etc. excluded, AVAILABLE counted
 *   catalog setCopyStatus refuses circulation states + busy copies
 *   J-L3  assertIsLibrarian: Principal/Office pass via library:manage; a TEACHER
 *         only with an active (latest=assign) LibrarianAssignment; Bangla deny
 *   assign/revoke append-only rows + LIBRARIAN_ASSIGNED audit
 *   policy: DB row wins, missing row falls back to the PRD working values
 *           (7/2/1/3 student · 14/4/2/3 staff · 7/2/1/3 guardian) — no seed write
 *
 * DB-free: Mongoose models mocked, the services real.
 */
import mongoose from "mongoose";
import { ForbiddenError } from "../middleware/authz";
import type { AppContext } from "../context";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mock models BEFORE importing the services under test
// ---------------------------------------------------------------------------

const mockTitleCreate = jest.fn();
const mockTitleFindById = jest.fn();
const mockTitleFindByIdAndUpdate = jest.fn();
const mockTitleFind = jest.fn();
jest.mock("../modules/library/models/BookTitle", () => ({
  BookTitle: {
    create: (d: unknown) => mockTitleCreate(d),
    findById: (id: unknown) => ({ lean: () => mockTitleFindById(id) }),
    findByIdAndUpdate: (id: unknown, u: unknown, o: unknown) => mockTitleFindByIdAndUpdate(id, u, o),
    find: (f: unknown) => ({ sort: () => ({ lean: () => mockTitleFind(f) }) }),
  },
}));

const mockCopyCreate = jest.fn();
const mockCopyFindOne = jest.fn();
const mockCopyFindById = jest.fn();
const mockCopyFind = jest.fn();
jest.mock("../modules/library/models/BookCopy", () => ({
  BookCopy: {
    create: (d: unknown) => mockCopyCreate(d),
    findOne: (f: unknown) => ({ lean: () => mockCopyFindOne(f) }),
    findById: (id: unknown) => mockCopyFindById(id),
    find: (f: unknown) => ({
      select: () => ({ lean: () => mockCopyFind(f) }),
      sort: () => ({ lean: () => mockCopyFind(f) }),
    }),
  },
}));

const mockPolicyFindOne = jest.fn();
const mockPolicyUpdateOne = jest.fn();
jest.mock("../modules/library/models/LibraryPolicy", () => ({
  LibraryPolicy: {
    findOne: (f: unknown) => ({ lean: () => mockPolicyFindOne(f) }),
    updateOne: (f: unknown, u: unknown, o: unknown) => mockPolicyUpdateOne(f, u, o),
  },
}));

const mockAssignFindOne = jest.fn();
const mockAssignCreate = jest.fn();
const mockAssignFind = jest.fn();
jest.mock("../modules/library/models/LibrarianAssignment", () => ({
  LibrarianAssignment: {
    findOne: (f: unknown) => ({ sort: () => ({ lean: () => mockAssignFindOne(f) }) }),
    create: (d: unknown) => mockAssignCreate(d),
    find: (f: unknown) => ({ sort: () => ({ lean: () => mockAssignFind(f) }) }),
  },
}));

const mockUserFindById = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    findById: (id: unknown) => ({ lean: () => mockUserFindById(id) }),
    find: () => ({ select: () => ({ lean: () => [] }) }),
  },
}));

const mockWriteAudit = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

// Import AFTER mocks
import { LibraryError } from "../modules/library/errors";
import {
  availableCount,
  addBookCopy,
  setCopyStatus,
  createBookTitle,
} from "../modules/library/services/LibraryCatalogService";
import {
  assertIsLibrarian,
  isAssignedLibrarian,
  latestRowGrantsDuty,
  assignLibrarian,
  revokeLibrarian,
  currentLibrarianIds,
} from "../modules/library/services/LibrarianService";
import {
  getEffectivePolicy,
  effectivePolicies,
  upsertLibraryPolicy,
  DEFAULT_LIBRARY_POLICIES,
} from "../modules/library/services/LibraryPolicyService";

const ctxOf = (role: string, userId = oid().toString()): AppContext =>
  ({ auth: { userId, role } }) as unknown as AppContext;

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
  mockAssignCreate.mockImplementation((d: Record<string, unknown>) =>
    Promise.resolve({ _id: oid(), ...d }),
  );
});

// ===========================================================================
// Availability is computed (D-#82)
// ===========================================================================

describe("availableCount — computed availability", () => {
  test("counts AVAILABLE only; WITHDRAWN/ON_LOAN/ON_HOLD/LOST/DAMAGED excluded", () => {
    const copies = [
      { status: "AVAILABLE" },
      { status: "AVAILABLE" },
      { status: "ON_LOAN" },
      { status: "ON_HOLD" },
      { status: "LOST" },
      { status: "DAMAGED" },
      { status: "WITHDRAWN" },
    ] as never[];
    expect(availableCount(copies)).toBe(2);
  });

  test("empty copy list → 0", () => {
    expect(availableCount([])).toBe(0);
  });
});

// ===========================================================================
// J-L1 — accession numbers unique
// ===========================================================================

describe("addBookCopy — unique accession number (J-L1)", () => {
  const titleId = oid().toString();

  test("duplicate accession number rejected with a Bangla message", async () => {
    mockTitleFindById.mockResolvedValue({ _id: titleId, titleBn: "সীরাত গ্রন্থ" });
    mockCopyFindOne.mockResolvedValue({ _id: oid(), accessionNo: "ACC-001" });
    await expect(addBookCopy(titleId, "ACC-001", null, oid().toString())).rejects.toThrow(
      /ACC-001 ইতিমধ্যে ব্যবহৃত/,
    );
    expect(mockCopyCreate).not.toHaveBeenCalled();
  });

  test("the concurrent-insert race (E11000) maps to the same Bangla rejection", async () => {
    mockTitleFindById.mockResolvedValue({ _id: titleId, titleBn: "সীরাত গ্রন্থ" });
    mockCopyFindOne.mockResolvedValue(null);
    mockCopyCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    await expect(addBookCopy(titleId, "ACC-001", null, oid().toString())).rejects.toThrow(
      /ইতিমধ্যে ব্যবহৃত/,
    );
  });

  test("a fresh accession number creates an AVAILABLE copy and audits the catalog change", async () => {
    mockTitleFindById.mockResolvedValue({ _id: titleId, titleBn: "সীরাত গ্রন্থ" });
    mockCopyFindOne.mockResolvedValue(null);
    mockCopyCreate.mockImplementation((d: Record<string, unknown>) => Promise.resolve({ _id: oid(), ...d }));
    const copy = await addBookCopy(titleId, "  ACC-002  ", null, oid().toString());
    expect(copy.accessionNo).toBe("ACC-002");
    expect(copy.status).toBe("AVAILABLE");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "LIBRARY_CATALOG_CHANGED" }),
    );
  });

  test("unknown title rejected", async () => {
    mockTitleFindById.mockResolvedValue(null);
    await expect(addBookCopy(titleId, "ACC-003", null, oid().toString())).rejects.toThrow(LibraryError);
  });
});

describe("createBookTitle", () => {
  test("creates an active title and audits", async () => {
    mockTitleCreate.mockImplementation((d: Record<string, unknown>) => Promise.resolve({ _id: oid(), ...d }));
    const title = await createBookTitle(
      { titleBn: "সীরাত গ্রন্থ", language: "BANGLA" },
      oid().toString(),
    );
    expect(title.active).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "LIBRARY_CATALOG_CHANGED" }),
    );
  });

  test("blank titleBn rejected", async () => {
    await expect(
      createBookTitle({ titleBn: "   ", language: "BANGLA" }, oid().toString()),
    ).rejects.toThrow(LibraryError);
  });
});

// ===========================================================================
// setCopyStatus — catalog side only
// ===========================================================================

describe("setCopyStatus — circulation states protected", () => {
  test("ON_LOAN / ON_HOLD cannot be set from the catalog", async () => {
    await expect(setCopyStatus(oid().toString(), "ON_LOAN", null, oid().toString())).rejects.toThrow(
      LibraryError,
    );
    await expect(setCopyStatus(oid().toString(), "ON_HOLD", null, oid().toString())).rejects.toThrow(
      LibraryError,
    );
    expect(mockCopyFindById).not.toHaveBeenCalled();
  });

  test("a copy currently ON_LOAN must go through the desk first", async () => {
    mockCopyFindById.mockResolvedValue({ _id: oid(), status: "ON_LOAN", save: jest.fn() });
    await expect(
      setCopyStatus(oid().toString(), "WITHDRAWN", null, oid().toString()),
    ).rejects.toThrow(/ডেস্কে ফেরত/);
  });

  test("withdrawing an AVAILABLE copy works and audits (copy never deleted)", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    mockCopyFindById.mockResolvedValue({ _id: oid(), status: "AVAILABLE", save });
    const copy = await setCopyStatus(oid().toString(), "WITHDRAWN", "পুরনো সংস্করণ", oid().toString());
    expect(copy.status).toBe("WITHDRAWN");
    expect(save).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "LIBRARY_CATALOG_CHANGED" }),
    );
  });
});

// ===========================================================================
// J-L3 — the librarian desk gate (D-#81, duty pattern D-#42/#64)
// ===========================================================================

describe("assertIsLibrarian — desk gate", () => {
  test("PRINCIPAL and OFFICE pass via library:manage (no assignment row needed)", async () => {
    await expect(assertIsLibrarian(ctxOf("PRINCIPAL"))).resolves.toBeUndefined();
    await expect(assertIsLibrarian(ctxOf("OFFICE"))).resolves.toBeUndefined();
    expect(mockAssignFindOne).not.toHaveBeenCalled();
  });

  test("a TEACHER with no assignment is denied with a Bangla message (J-L3)", async () => {
    mockAssignFindOne.mockResolvedValue(null);
    await expect(assertIsLibrarian(ctxOf("TEACHER"))).rejects.toThrow(
      /শুধুমাত্র লাইব্রেরিয়ান/,
    );
  });

  test("a TEACHER whose latest row is `assign` passes; latest `revoke` is denied", async () => {
    mockAssignFindOne.mockResolvedValue({ action: "assign" });
    await expect(assertIsLibrarian(ctxOf("TEACHER"))).resolves.toBeUndefined();
    mockAssignFindOne.mockResolvedValue({ action: "revoke" });
    await expect(assertIsLibrarian(ctxOf("TEACHER"))).rejects.toThrow(ForbiddenError);
  });

  test("GUARDIAN and unauthenticated are denied", async () => {
    await expect(assertIsLibrarian(ctxOf("GUARDIAN"))).rejects.toThrow(ForbiddenError);
    await expect(assertIsLibrarian({ auth: null } as unknown as AppContext)).rejects.toThrow(
      ForbiddenError,
    );
  });

  test("latestRowGrantsDuty pure predicate", () => {
    expect(latestRowGrantsDuty(null)).toBe(false);
    expect(latestRowGrantsDuty({ action: "assign" } as never)).toBe(true);
    expect(latestRowGrantsDuty({ action: "revoke" } as never)).toBe(false);
  });
});

describe("assignLibrarian / revokeLibrarian — append-only duty log", () => {
  const teacherId = oid().toString();
  const actorId = oid().toString();

  test("assigning a TEACHER appends an assign row and audits LIBRARIAN_ASSIGNED (J-L3)", async () => {
    mockUserFindById.mockResolvedValue({ _id: teacherId, role: "TEACHER", active: true });
    mockAssignFindOne.mockResolvedValue(null); // not currently assigned
    const row = await assignLibrarian(teacherId, actorId);
    expect(row.action).toBe("assign");
    expect(mockAssignCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: teacherId, action: "assign", actorId }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "LIBRARIAN_ASSIGNED", meta: { action: "assign" } }),
    );
  });

  test("assigning a non-teacher or an already-assigned teacher is rejected", async () => {
    mockUserFindById.mockResolvedValue({ _id: oid(), role: "OFFICE", active: true });
    await expect(assignLibrarian(teacherId, actorId)).rejects.toThrow(/শুধুমাত্র একজন শিক্ষক/);

    mockUserFindById.mockResolvedValue({ _id: teacherId, role: "TEACHER", active: true });
    mockAssignFindOne.mockResolvedValue({ action: "assign" });
    await expect(assignLibrarian(teacherId, actorId)).rejects.toThrow(/ইতিমধ্যে লাইব্রেরিয়ান/);
  });

  test("revoking appends a revoke row (history preserved); revoke-when-unassigned rejected", async () => {
    mockAssignFindOne.mockResolvedValue({ action: "assign" });
    const row = await revokeLibrarian(teacherId, actorId);
    expect(row.action).toBe("revoke");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "LIBRARIAN_ASSIGNED", meta: { action: "revoke" } }),
    );

    mockAssignFindOne.mockResolvedValue({ action: "revoke" });
    await expect(revokeLibrarian(teacherId, actorId)).rejects.toThrow(/বর্তমানে লাইব্রেরিয়ান হিসেবে নিযুক্ত নন/);
  });

  test("currentLibrarianIds — latest row per user decides", async () => {
    const t1 = oid();
    const t2 = oid();
    mockAssignFind.mockResolvedValue([
      { userId: t1, action: "assign" },
      { userId: t2, action: "assign" },
      { userId: t2, action: "revoke" },
    ]);
    await expect(currentLibrarianIds()).resolves.toEqual([t1.toString()]);
  });

  test("isAssignedLibrarian reads the latest row", async () => {
    mockAssignFindOne.mockResolvedValue({ action: "assign" });
    await expect(isAssignedLibrarian(teacherId)).resolves.toBe(true);
    mockAssignFindOne.mockResolvedValue(null);
    await expect(isAssignedLibrarian(teacherId)).resolves.toBe(false);
  });
});

// ===========================================================================
// Policy — admin data with PRD working-value fallback (D-#82)
// ===========================================================================

describe("library policy — DB row wins, defaults otherwise (no seed write)", () => {
  test("missing row → the PRD working values, isDefault=true", async () => {
    mockPolicyFindOne.mockResolvedValue(null);
    const student = await getEffectivePolicy("STUDENT");
    expect(student).toMatchObject({ loanDays: 7, maxConcurrent: 2, maxRenewals: 1, holdDays: 3, isDefault: true });
    const staff = await getEffectivePolicy("STAFF");
    expect(staff).toMatchObject({ loanDays: 14, maxConcurrent: 4, maxRenewals: 2, holdDays: 3, isDefault: true });
    const guardian = await getEffectivePolicy("GUARDIAN");
    expect(guardian).toMatchObject({ loanDays: 7, maxConcurrent: 2, maxRenewals: 1, holdDays: 3, isDefault: true });
  });

  test("an admin row overrides the default (isDefault=false)", async () => {
    mockPolicyFindOne.mockResolvedValue({ borrowerType: "STUDENT", loanDays: 10, maxConcurrent: 3, maxRenewals: 2, holdDays: 5 });
    const p = await getEffectivePolicy("STUDENT");
    expect(p).toMatchObject({ loanDays: 10, maxConcurrent: 3, maxRenewals: 2, holdDays: 5, isDefault: false });
  });

  test("effectivePolicies covers all three borrower types", async () => {
    mockPolicyFindOne.mockResolvedValue(null);
    const all = await effectivePolicies();
    expect(all.map((p) => p.borrowerType).sort()).toEqual(["GUARDIAN", "STAFF", "STUDENT"]);
  });

  test("upsert validates whole-day minimums (maxRenewals 0 legal, loanDays 0 not)", async () => {
    const actor = oid().toString();
    await expect(
      upsertLibraryPolicy("STUDENT", { loanDays: 0, maxConcurrent: 2, maxRenewals: 1, holdDays: 3 }, actor),
    ).rejects.toThrow(LibraryError);
    await expect(
      upsertLibraryPolicy("STUDENT", { loanDays: 7, maxConcurrent: 2, maxRenewals: 1.5, holdDays: 3 }, actor),
    ).rejects.toThrow(LibraryError);

    mockPolicyUpdateOne.mockResolvedValue({ acknowledged: true });
    mockPolicyFindOne.mockResolvedValue({ borrowerType: "STUDENT", loanDays: 7, maxConcurrent: 2, maxRenewals: 0, holdDays: 3 });
    const p = await upsertLibraryPolicy(
      "STUDENT",
      { loanDays: 7, maxConcurrent: 2, maxRenewals: 0, holdDays: 3 },
      actor,
    );
    expect(p.maxRenewals).toBe(0);
    expect(mockPolicyUpdateOne).toHaveBeenCalledWith(
      { borrowerType: "STUDENT" },
      { $set: { loanDays: 7, maxConcurrent: 2, maxRenewals: 0, holdDays: 3 } },
      { upsert: true },
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "LIBRARY_CATALOG_CHANGED" }),
    );
  });

  test("the exported defaults match the PRD working values verbatim", () => {
    expect(DEFAULT_LIBRARY_POLICIES).toEqual({
      STUDENT: { loanDays: 7, maxConcurrent: 2, maxRenewals: 1, holdDays: 3 },
      STAFF: { loanDays: 14, maxConcurrent: 4, maxRenewals: 2, holdDays: 3 },
      GUARDIAN: { loanDays: 7, maxConcurrent: 2, maxRenewals: 1, holdDays: 3 },
    });
  });
});
