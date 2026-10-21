/**
 * VC-1/VC-2 — vocab authorization gate DENY paths (D-#126/#127). Closes the VC-1
 * coordinator follow-up (resolver gate deny-paths were uncovered). DB-free: mocks
 * the authz scope resolver, the Class model, and the assignment model.
 */
import mongoose from "mongoose";
import { setRoleTemplateOverrides } from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();

class FakeForbidden extends Error {
  constructor(msg = "Forbidden") {
    super(msg);
    this.name = "ForbiddenError";
  }
}

const mockResolveScopes = jest.fn();
const mockClassFindOne = jest.fn();
const mockAssignFindOne = jest.fn();

jest.mock("../middleware/authz", () => ({
  ForbiddenError: FakeForbidden,
  resolveTeacherScopes: (...a: unknown[]) => mockResolveScopes(...a),
}));
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { findOne: (q: unknown) => ({ select: () => ({ lean: () => mockClassFindOne(q) }) }) },
}));
jest.mock("../modules/vocab/models/VocabTestAssignment", () => ({
  VocabTestAssignment: {
    findOne: (q: unknown) => ({ sort: () => ({ lean: () => mockAssignFindOne(q) }) }),
  },
}));
jest.mock("../modules/platform/services/AuditService", () => ({ writeAudit: jest.fn() }));

import { assertCanManageClassLevel, assertCanOperateVocab } from "../modules/vocab/services/vocabGate";

const ctxOf = (role: string | null, userId = oid().toString()) =>
  ({ auth: role ? { role, userId } : null } as never);

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// assertCanManageClassLevel (word bank, §7 J1)
// ---------------------------------------------------------------------------

describe("assertCanManageClassLevel", () => {
  test("PRINCIPAL is unscoped (allowed, no scope lookup)", async () => {
    await expect(assertCanManageClassLevel(ctxOf("PRINCIPAL"), 3)).resolves.toBeUndefined();
    expect(mockResolveScopes).not.toHaveBeenCalled();
  });

  test("OFFICE is denied (no vocab_test:edit by default)", async () => {
    await expect(assertCanManageClassLevel(ctxOf("OFFICE"), 3)).rejects.toThrow(FakeForbidden);
  });

  test("GUARDIAN is denied", async () => {
    await expect(assertCanManageClassLevel(ctxOf("GUARDIAN"), 3)).rejects.toThrow(FakeForbidden);
  });

  test("TEACHER with no writable scopes is denied", async () => {
    mockResolveScopes.mockResolvedValue([{ kind: "supervisory", classId: oid().toString() }]);
    await expect(assertCanManageClassLevel(ctxOf("TEACHER"), 3)).rejects.toThrow(FakeForbidden);
    expect(mockClassFindOne).not.toHaveBeenCalled(); // short-circuits before the DB
  });

  test("TEACHER whose writable classes are NOT at the target level is denied", async () => {
    mockResolveScopes.mockResolvedValue([{ kind: "teaching", classId: oid().toString() }]);
    mockClassFindOne.mockResolvedValue(null); // no class at that level among the teacher's
    await expect(assertCanManageClassLevel(ctxOf("TEACHER"), 5)).rejects.toThrow(/class level you teach/);
  });

  test("TEACHER with a writable class at the target level is allowed", async () => {
    mockResolveScopes.mockResolvedValue([{ kind: "teaching", classId: oid().toString() }]);
    mockClassFindOne.mockResolvedValue({ _id: oid() });
    await expect(assertCanManageClassLevel(ctxOf("TEACHER"), 3)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// assertCanOperateVocab (test build/mark, §5)
// ---------------------------------------------------------------------------

describe("assertCanOperateVocab", () => {
  const section = oid().toString();

  test("PRINCIPAL is unscoped (allowed)", async () => {
    await expect(assertCanOperateVocab(ctxOf("PRINCIPAL"), section, "ENGLISH", new Date())).resolves.toBeUndefined();
  });

  test("OFFICE is denied", async () => {
    await expect(assertCanOperateVocab(ctxOf("OFFICE"), section, "ENGLISH", new Date())).rejects.toThrow(FakeForbidden);
  });

  test("the assigned tester is allowed", async () => {
    const me = oid().toString();
    mockAssignFindOne.mockResolvedValue({ assignedTeacherId: { toString: () => me } });
    mockResolveScopes.mockResolvedValue([]);
    await expect(assertCanOperateVocab(ctxOf("TEACHER", me), section, "ENGLISH", new Date())).resolves.toBeUndefined();
  });

  test("a covering teacher with an active proxy on the section is allowed", async () => {
    const me = oid().toString();
    mockAssignFindOne.mockResolvedValue({ assignedTeacherId: { toString: () => oid().toString() } });
    mockResolveScopes.mockResolvedValue([{ kind: "proxy", sectionId: section }]);
    await expect(assertCanOperateVocab(ctxOf("TEACHER", me), section, "ENGLISH", new Date())).resolves.toBeUndefined();
  });

  test("a teacher who is neither assigned nor proxied is denied", async () => {
    const me = oid().toString();
    mockAssignFindOne.mockResolvedValue({ assignedTeacherId: { toString: () => oid().toString() } });
    mockResolveScopes.mockResolvedValue([{ kind: "teaching", sectionId: section }]);
    await expect(assertCanOperateVocab(ctxOf("TEACHER", me), section, "ENGLISH", new Date())).rejects.toThrow(/assigned vocab tester/);
  });
});

// ---------------------------------------------------------------------------
// PM (D-#790–#801): vocab_test:edit_all replaces the PRINCIPAL bypass; the actions
// replace the TEACHER-only test (Office passes only with the action + designation).
// ---------------------------------------------------------------------------

describe("PM — vocab_test actions + edit_all reach", () => {
  const section = oid().toString();
  afterEach(() => setRoleTemplateOverrides({}));

  test("OFFICE given vocab_test:edit_all runs any section's vocab, no scope lookup", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: ["vocab_test:edit_all"], revoked: [] } });
    await expect(assertCanOperateVocab(ctxOf("OFFICE"), section, "ENGLISH", new Date())).resolves.toBeUndefined();
    await expect(assertCanManageClassLevel(ctxOf("OFFICE"), 3)).resolves.toBeUndefined();
    expect(mockResolveScopes).not.toHaveBeenCalled();
  });

  test("OFFICE granted vocab_test:enter_results passes only as the assigned tester", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: ["vocab_test:enter_results"], revoked: [] } });
    const me = oid().toString();
    mockAssignFindOne.mockResolvedValue({ assignedTeacherId: { toString: () => me } });
    mockResolveScopes.mockResolvedValue([]);
    await expect(
      assertCanOperateVocab(ctxOf("OFFICE", me), section, "ENGLISH", new Date(), "vocab_test:enter_results"),
    ).resolves.toBeUndefined();
    // …but not for building a test (vocab_test:create still off for Office).
    await expect(assertCanOperateVocab(ctxOf("OFFICE", me), section, "ENGLISH", new Date())).rejects.toThrow(FakeForbidden);
  });

  test("an assigned TEACHER whose role lost vocab_test:enter_results is refused marking", async () => {
    setRoleTemplateOverrides({ TEACHER: { granted: [], revoked: ["vocab_test:enter_results"] } });
    const me = oid().toString();
    mockAssignFindOne.mockResolvedValue({ assignedTeacherId: { toString: () => me } });
    mockResolveScopes.mockResolvedValue([]);
    await expect(
      assertCanOperateVocab(ctxOf("TEACHER", me), section, "ENGLISH", new Date(), "vocab_test:enter_results"),
    ).rejects.toThrow(FakeForbidden);
    await expect(assertCanOperateVocab(ctxOf("TEACHER", me), section, "ENGLISH", new Date())).resolves.toBeUndefined();
  });

  test("a TEACHER granted vocab_test:edit_all per person manages any class level", async () => {
    const ctx = { auth: { role: "TEACHER", userId: oid().toString(), grantedPermissions: ["vocab_test:edit_all"] } } as never;
    await expect(assertCanManageClassLevel(ctx, 4)).resolves.toBeUndefined();
    expect(mockResolveScopes).not.toHaveBeenCalled();
  });
});
