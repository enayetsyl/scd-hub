/**
 * Guardian access to class-note attachments — the read gate.
 *
 * A `classnote_attachment` StoredFile carries NO back-reference to a student (the
 * pointer runs ClassNote → file), so the gate reverse-resolves the owning note and
 * checks the guardian has a linked child in that note's group.
 *
 *   1. only a GUARDIAN reaches this gate (staff pass earlier, on routine:read)
 *   2. an ORPHAN file — one no note references — is never readable (a picked-but-never-
 *      attached upload must not leak)
 *   3. section notes  → the guardian needs an active linked child in that section
 *   4. subjectgroup notes → the guardian needs a linked child with a membership in it
 *   5. an inactive guardian, an inactive link, or someone else's child is denied
 *
 * DB-free: models are mocked; the authorization logic is real.
 */
const mockNoteFindOne = jest.fn();
const mockGuardianFindById = jest.fn();
const mockLinkFind = jest.fn();
const mockStudentExists = jest.fn();
const mockMembershipExists = jest.fn();

jest.mock("../modules/routine/models/ClassNote", () => ({
  ClassNote: { findOne: (f: unknown) => ({ select: () => ({ lean: () => mockNoteFindOne(f) }) }) },
}));
jest.mock("../modules/foundation/models/Guardian", () => ({
  Guardian: { findById: (id: unknown) => ({ lean: () => mockGuardianFindById(id) }) },
}));
jest.mock("../modules/foundation/models/GuardianLink", () => ({
  GuardianLink: { find: (f: unknown) => ({ select: () => ({ lean: () => mockLinkFind(f) }) }) },
}));
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { exists: (f: unknown) => mockStudentExists(f) },
}));
jest.mock("../modules/routine/models/SubjectGroupMembership", () => ({
  SubjectGroupMembership: { exists: (f: unknown) => mockMembershipExists(f) },
}));
jest.mock("../middleware/authz", () => ({
  ForbiddenError: class ForbiddenError extends Error {},
}));

import { assertClassNoteFileReadAccess } from "../modules/routine/services/ClassNoteFileService";
import type { AppContext } from "../context";

const FILE = "file-1";
const GUARDIAN = "g-1";
const SECTION = "sec-3";
const GROUP = "quran-najera";
const KID = "kid-1";

const ctxFor = (role: string | null, userId = GUARDIAN): AppContext =>
  ({ auth: role ? { userId, role } : null }) as unknown as AppContext;

beforeEach(() => {
  jest.clearAllMocks();
  mockNoteFindOne.mockResolvedValue({ groupType: "section", groupId: SECTION });
  mockGuardianFindById.mockResolvedValue({ _id: GUARDIAN, active: true });
  mockLinkFind.mockResolvedValue([{ studentId: KID, active: true }]);
  mockStudentExists.mockResolvedValue({ _id: KID });
  mockMembershipExists.mockResolvedValue(null);
});

describe("who reaches the gate", () => {
  test("a guardian with a child in the note's section may read it", async () => {
    await expect(assertClassNoteFileReadAccess(ctxFor("GUARDIAN"), FILE)).resolves.toBeUndefined();
    expect(mockNoteFindOne).toHaveBeenCalledWith({ attachmentIds: FILE });
    expect(mockStudentExists).toHaveBeenCalledWith({ _id: { $in: [KID] }, sectionId: SECTION, active: true });
  });

  test("a non-guardian never passes here (staff are admitted earlier, on routine:read)", async () => {
    await expect(assertClassNoteFileReadAccess(ctxFor("TEACHER"), FILE)).rejects.toThrow();
    await expect(assertClassNoteFileReadAccess(ctxFor("OFFICE"), FILE)).rejects.toThrow();
    expect(mockNoteFindOne).not.toHaveBeenCalled();
  });

  test("an anonymous caller is denied", async () => {
    await expect(assertClassNoteFileReadAccess(ctxFor(null), FILE)).rejects.toThrow();
  });
});

describe("the file must belong to a real note", () => {
  test("an ORPHAN file — no note references it — is never readable", async () => {
    mockNoteFindOne.mockResolvedValue(null);
    await expect(assertClassNoteFileReadAccess(ctxFor("GUARDIAN"), FILE)).rejects.toThrow();
    expect(mockStudentExists).not.toHaveBeenCalled();
  });
});

describe("the guardian must have a child in the note's group", () => {
  test("section note: no child in that section → denied", async () => {
    mockStudentExists.mockResolvedValue(null);
    await expect(assertClassNoteFileReadAccess(ctxFor("GUARDIAN"), FILE)).rejects.toThrow();
  });

  test("subjectgroup note: membership decides, not the section", async () => {
    mockNoteFindOne.mockResolvedValue({ groupType: "subjectgroup", groupId: GROUP });
    mockMembershipExists.mockResolvedValue({ _id: "m-1" });
    await expect(assertClassNoteFileReadAccess(ctxFor("GUARDIAN"), FILE)).resolves.toBeUndefined();
    expect(mockMembershipExists).toHaveBeenCalledWith({ groupId: GROUP, studentId: { $in: [KID] } });
    expect(mockStudentExists).not.toHaveBeenCalled();
  });

  test("subjectgroup note: no membership → denied", async () => {
    mockNoteFindOne.mockResolvedValue({ groupType: "subjectgroup", groupId: GROUP });
    mockMembershipExists.mockResolvedValue(null);
    await expect(assertClassNoteFileReadAccess(ctxFor("GUARDIAN"), FILE)).rejects.toThrow();
  });
});

describe("the guardian and the link must both be live", () => {
  test("an inactive guardian account is denied", async () => {
    mockGuardianFindById.mockResolvedValue({ _id: GUARDIAN, active: false });
    await expect(assertClassNoteFileReadAccess(ctxFor("GUARDIAN"), FILE)).rejects.toThrow();
  });

  test("a missing guardian record is denied", async () => {
    mockGuardianFindById.mockResolvedValue(null);
    await expect(assertClassNoteFileReadAccess(ctxFor("GUARDIAN"), FILE)).rejects.toThrow();
  });

  test("a REVOKED link does not count — the child is excluded", async () => {
    mockLinkFind.mockResolvedValue([{ studentId: KID, active: false }]);
    await expect(assertClassNoteFileReadAccess(ctxFor("GUARDIAN"), FILE)).rejects.toThrow();
    expect(mockStudentExists).not.toHaveBeenCalled(); // no live children at all
  });

  test("a guardian with no links is denied", async () => {
    mockLinkFind.mockResolvedValue([]);
    await expect(assertClassNoteFileReadAccess(ctxFor("GUARDIAN"), FILE)).rejects.toThrow();
  });
});
