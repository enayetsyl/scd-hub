/**
 * BUG-WC-7, the wiring half: assigning or revoking a teaching grant must actually
 * hand the open claims over.
 *
 * This exists because the first cut of the hook was inserted AFTER `return grantId`
 * in `grantTeaching`. Unreachable code is not a type error, so server `tsc` was
 * clean and every other suite stayed green while the feature did precisely nothing
 * — the same class of failure as the JSX that sat outside the render tree. A test
 * that drives the real `grantTeaching` is the only thing that catches it.
 */
const mockReassign = jest.fn();
const mockSectionById = jest.fn();
const mockGrantFindOne = jest.fn();
const mockGrantCreate = jest.fn();
const mockGrantById = jest.fn();
const mockGrantUpdate = jest.fn();
const mockAudit = jest.fn();

jest.mock("../modules/trackers/services/ClaimReassignService", () => ({
  reassignClaimsForSubject: (...a: unknown[]) => mockReassign(...a),
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { findById: (id: unknown) => ({ select: () => ({ lean: () => mockSectionById(id) }) }) },
}));
jest.mock("../modules/foundation/models/ScopeGrant", () => ({
  ScopeGrant: {
    findOne: (q: unknown) => mockGrantFindOne(q),
    create: (d: unknown) => mockGrantCreate(d),
    findById: (id: unknown) => mockGrantById(id),
    findByIdAndUpdate: (id: unknown, d: unknown) => mockGrantUpdate(id, d),
  },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (...a: unknown[]) => mockAudit(...a),
}));

import { grantTeaching, revokeTeaching } from "../modules/foundation/services/ScopeGrantService";

const SECTION = "section-1";
const SUBJECT = "subject-1";

beforeEach(() => {
  jest.clearAllMocks();
  mockSectionById.mockResolvedValue({ classId: "class-1" });
  mockGrantFindOne.mockResolvedValue(null);
  mockGrantCreate.mockResolvedValue({ _id: "grant-1" });
  mockReassign.mockResolvedValue({ examined: 0, moved: 0 });
});

describe("granting teaching hands the open claims over", () => {
  test("a NEW grant reassigns the claims for that section x subject", async () => {
    const id = await grantTeaching({
      teacherId: "teacher-new",
      sectionId: SECTION,
      subjectId: SUBJECT,
      assignedBy: "admin-1",
    });

    expect(id).toBe("grant-1");
    expect(mockReassign).toHaveBeenCalledWith(SECTION, SUBJECT, "admin-1");
  });

  test("REACTIVATING a revoked grant reassigns too — the same handover to the school", async () => {
    const existing = { _id: "grant-9", active: false, save: jest.fn().mockResolvedValue(undefined) };
    mockGrantFindOne.mockResolvedValue(existing);

    await grantTeaching({
      teacherId: "teacher-back",
      sectionId: SECTION,
      subjectId: SUBJECT,
      assignedBy: "admin-1",
    });

    expect(existing.save).toHaveBeenCalled();
    expect(mockReassign).toHaveBeenCalledWith(SECTION, SUBJECT, "admin-1");
  });

  test("revoking a grant reassigns as well — that is how a subject is taken AWAY", async () => {
    mockGrantById.mockResolvedValue({
      _id: "grant-1",
      kind: "teaching",
      sectionId: SECTION,
      subjectId: SUBJECT,
    });

    await revokeTeaching("grant-1", "admin-1");

    expect(mockReassign).toHaveBeenCalledWith(SECTION, SUBJECT, "admin-1");
  });

  test("a grant that is not a teaching grant is refused before anything moves", async () => {
    mockGrantById.mockResolvedValue({ _id: "grant-2", kind: "proxy" });
    await expect(revokeTeaching("grant-2", "admin-1")).rejects.toThrow();
    expect(mockReassign).not.toHaveBeenCalled();
  });
});
