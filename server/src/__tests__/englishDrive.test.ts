/**
 * English Drive tests (D-#344, ED-1) — md-import + class-scoped teacher library.
 *
 * RBAC    — upload rides roster:manage (Principal+Office only); no new permission.
 * Scope   — an ENG teacher of Class 3 sees Class 3 and NOT Class 4; a non-English
 *           teacher sees nothing; a guardian is denied outright; P/O unrestricted.
 * Upload  — validation (class 1..5, kind enum, version, 1 MB cap); create audits
 *           ENGLISH_DRIVE_UPLOADED; re-upload of the same (class, block, kind)
 *           stamps the old row replacedAt + audits ENGLISH_DRIVE_REPLACED.
 * Library — reads take only unreplaced rows (replace hides old), metadata only;
 *           sorted class → block → kind (BLOCK, TN, CW, HW, PT, AS, CLUE).
 *
 * DB-free (repo convention): models + audit + scope resolution are mocked.
 */
import mongoose from "mongoose";
import { roleHasPermission, ROLES } from "@scd/shared";
import type { AppContext } from "../context";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the module under test)
// ---------------------------------------------------------------------------

const mockCreate = jest.fn();
const mockFindOne = jest.fn();
const mockFind = jest.fn();
const mockFindById = jest.fn();
jest.mock("../modules/english-drive/models/EnglishDriveDoc", () => {
  const actual = jest.requireActual("../modules/english-drive/models/EnglishDriveDoc");
  return {
    ...actual,
    EnglishDriveDoc: {
      create: (d: unknown) => mockCreate(d),
      findOne: (q: unknown) => mockFindOne(q),
      find: (q: unknown) => ({ select: () => ({ lean: async () => mockFind(q) }) }),
      findById: (id: unknown) => ({ lean: async () => mockFindById(id) }),
    },
  };
});

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    find: (q: unknown) => ({ select: () => ({ lean: async () => mockUserFind(q) }) }),
  },
}));

const mockSubjectFind = jest.fn();
jest.mock("../modules/foundation/models/Subject", () => ({
  Subject: {
    find: (q: unknown) => ({ select: () => ({ lean: async () => mockSubjectFind(q) }) }),
  },
}));

const mockClassFind = jest.fn();
jest.mock("../modules/foundation/models/Class", () => ({
  Class: {
    find: (q: unknown) => ({ select: () => ({ lean: async () => mockClassFind(q) }) }),
  },
}));

const mockResolveScopes = jest.fn();
jest.mock("../middleware/authz", () => {
  const actual = jest.requireActual("../middleware/authz");
  return {
    ...actual,
    resolveTeacherScopes: (ctx: unknown) => mockResolveScopes(ctx),
  };
});

// Import AFTER mocks
import { ForbiddenError } from "../middleware/authz";
import {
  allowedEnglishDriveClassLevels,
  myEnglishDriveClassLevels,
  englishDriveDocs,
  englishDriveDocById,
  uploadEnglishDriveDoc,
} from "../modules/english-drive/services/EnglishDriveService";

const ENG_ID = oid();
const SCI_ID = oid();
const C3_ID = oid();
const C4_ID = oid();
const NURSERY_ID = oid();
const OFFICE_ID = oid();
const TEACHER_ID = oid();

const levelByClassId = new Map<string, number>([
  [C3_ID.toString(), 3],
  [C4_ID.toString(), 4],
  [NURSERY_ID.toString(), -1],
]);

const ctxOf = (role: string, userId = TEACHER_ID.toString()) =>
  ({ auth: { userId, role } }) as unknown as AppContext;

const teachingScope = (subjectId: mongoose.Types.ObjectId, classId: mongoose.Types.ObjectId) => ({
  kind: "teaching" as const,
  classId: classId.toString(),
  sectionId: oid().toString(),
  subjectId: subjectId.toString(),
});

const madeDoc = (over: Record<string, unknown> = {}) => ({
  _id: oid(),
  classLevel: 3,
  blockNumber: 1,
  kind: "TN",
  title: "Block 1 Teacher Note",
  version: 2,
  contentMd: "# Block 1\ncontent",
  uploadedBy: OFFICE_ID,
  replacedAt: null,
  createdAt: new Date(),
  save: jest.fn(async () => undefined),
  ...over,
});

const validUpload = () => ({
  classLevel: 3,
  blockNumber: 1,
  kind: "TN",
  title: "Block 1 Teacher Note",
  version: 2,
  contentMd: "# Block 1\ncontent",
  actorId: OFFICE_ID.toString(),
  actorRole: "OFFICE",
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSubjectFind.mockReturnValue([{ _id: ENG_ID }]);
  mockUserFind.mockReturnValue([{ _id: OFFICE_ID, name: "Office" }]);
  mockClassFind.mockImplementation((q: { _id: { $in: string[] } }) =>
    q._id.$in
      .filter((id) => levelByClassId.has(id.toString()))
      .map((id) => ({ level: levelByClassId.get(id.toString()) })),
  );
  mockResolveScopes.mockResolvedValue([]);
  mockCreate.mockImplementation(async (d: Record<string, unknown>) => madeDoc(d));
  mockFindOne.mockResolvedValue(null);
  mockFind.mockReturnValue([]);
});

// ---------------------------------------------------------------------------
// RBAC — no new permission: upload rides roster:manage exactly
// ---------------------------------------------------------------------------

describe("RBAC — upload rides roster:manage", () => {
  test("roster:manage = Principal/Office only (guardian and teacher never)", () => {
    const holders = ROLES.filter((r) => roleHasPermission(r, "roster:manage"));
    expect(holders.sort()).toEqual(["OFFICE", "PRINCIPAL"]);
  });
});

// ---------------------------------------------------------------------------
// Scope matrix — allowedEnglishDriveClassLevels
// ---------------------------------------------------------------------------

describe("allowedEnglishDriveClassLevels", () => {
  test("Principal and Office are unrestricted (null)", async () => {
    await expect(allowedEnglishDriveClassLevels(ctxOf("PRINCIPAL"))).resolves.toBeNull();
    await expect(allowedEnglishDriveClassLevels(ctxOf("OFFICE"))).resolves.toBeNull();
    expect(mockResolveScopes).not.toHaveBeenCalled();
  });

  test("a guardian is denied outright", async () => {
    await expect(allowedEnglishDriveClassLevels(ctxOf("GUARDIAN"))).rejects.toThrow(
      ForbiddenError,
    );
  });

  test("an ENG teacher of Class 3 gets {3} — and NOT Class 4", async () => {
    mockResolveScopes.mockResolvedValue([teachingScope(ENG_ID, C3_ID)]);
    const allowed = await allowedEnglishDriveClassLevels(ctxOf("TEACHER"));
    expect(allowed).not.toBeNull();
    expect(allowed!.has(3)).toBe(true);
    expect(allowed!.has(4)).toBe(false);
  });

  test("a non-English teacher of Class 3 gets the empty set", async () => {
    mockResolveScopes.mockResolvedValue([teachingScope(SCI_ID, C3_ID)]);
    const allowed = await allowedEnglishDriveClassLevels(ctxOf("TEACHER"));
    expect(allowed).not.toBeNull();
    expect(allowed!.size).toBe(0);
  });

  test("an ENG involvement in Nursery is dropped (the Drive covers 1..5 only)", async () => {
    mockResolveScopes.mockResolvedValue([teachingScope(ENG_ID, NURSERY_ID)]);
    const allowed = await allowedEnglishDriveClassLevels(ctxOf("TEACHER"));
    expect(allowed!.size).toBe(0);
  });

  test("a whole-school supervisor is unrestricted; an English dept supervisor too", async () => {
    mockResolveScopes.mockResolvedValue([{ kind: "supervisory", extent: "whole_school" }]);
    await expect(allowedEnglishDriveClassLevels(ctxOf("TEACHER"))).resolves.toBeNull();
    mockResolveScopes.mockResolvedValue([
      { kind: "supervisory", extent: "subject_dept", subjectId: ENG_ID.toString() },
    ]);
    await expect(allowedEnglishDriveClassLevels(ctxOf("TEACHER"))).resolves.toBeNull();
  });

  test("a grade_class supervisory scope adds that class", async () => {
    mockResolveScopes.mockResolvedValue([
      { kind: "supervisory", extent: "grade_class", classId: C4_ID.toString() },
    ]);
    const allowed = await allowedEnglishDriveClassLevels(ctxOf("TEACHER"));
    expect([...allowed!]).toEqual([4]);
  });

  test("myEnglishDriveClassLevels: guardian [], P/O all five, teacher sorted", async () => {
    await expect(myEnglishDriveClassLevels(ctxOf("GUARDIAN"))).resolves.toEqual([]);
    await expect(myEnglishDriveClassLevels(ctxOf("PRINCIPAL"))).resolves.toEqual([1, 2, 3, 4, 5]);
    mockResolveScopes.mockResolvedValue([
      teachingScope(ENG_ID, C4_ID),
      teachingScope(ENG_ID, C3_ID),
    ]);
    await expect(myEnglishDriveClassLevels(ctxOf("TEACHER"))).resolves.toEqual([3, 4]);
  });
});

// ---------------------------------------------------------------------------
// Library reads — replace hides old, metadata only, scope enforced
// ---------------------------------------------------------------------------

describe("englishDriveDocs", () => {
  test("reads only unreplaced rows, narrowed to the teacher's classes", async () => {
    mockResolveScopes.mockResolvedValue([teachingScope(ENG_ID, C3_ID)]);
    mockFind.mockReturnValue([madeDoc()]);
    const rows = await englishDriveDocs(ctxOf("TEACHER"));
    expect(mockFind).toHaveBeenCalledWith({ replacedAt: null, classLevel: { $in: [3] } });
    expect(rows).toHaveLength(1);
    expect(rows[0].contentMd).toBeNull(); // list rows are metadata-only
    expect(rows[0].uploadedByName).toBe("Office");
  });

  test("a teacher asking for a class outside their scope is denied", async () => {
    mockResolveScopes.mockResolvedValue([teachingScope(ENG_ID, C3_ID)]);
    await expect(englishDriveDocs(ctxOf("TEACHER"), 4)).rejects.toThrow(ForbiddenError);
  });

  test("Principal reads all classes; the only filter is replacedAt", async () => {
    mockFind.mockReturnValue([]);
    await englishDriveDocs(ctxOf("PRINCIPAL"));
    expect(mockFind).toHaveBeenCalledWith({ replacedAt: null });
  });

  test("sorts class → block → kind in the fixed BLOCK..CLUE order", async () => {
    mockFind.mockReturnValue([
      madeDoc({ kind: "CLUE", blockNumber: 1 }),
      madeDoc({ kind: "BLOCK", blockNumber: 2 }),
      madeDoc({ kind: "TN", blockNumber: 1 }),
      madeDoc({ kind: "BLOCK", blockNumber: 1 }),
    ]);
    const rows = await englishDriveDocs(ctxOf("PRINCIPAL"));
    expect(rows.map((r) => `${r.blockNumber}:${r.kind}`)).toEqual([
      "1:BLOCK",
      "1:TN",
      "1:CLUE",
      "2:BLOCK",
    ]);
  });
});

describe("englishDriveDocById", () => {
  test("returns the markdown for a teacher of that class", async () => {
    mockResolveScopes.mockResolvedValue([teachingScope(ENG_ID, C3_ID)]);
    mockFindById.mockReturnValue(madeDoc());
    const doc = await englishDriveDocById(ctxOf("TEACHER"), "x");
    expect(doc.contentMd).toContain("# Block 1");
  });

  test("denies a teacher outside the doc's class", async () => {
    mockResolveScopes.mockResolvedValue([teachingScope(ENG_ID, C3_ID)]);
    mockFindById.mockReturnValue(madeDoc({ classLevel: 4 }));
    await expect(englishDriveDocById(ctxOf("TEACHER"), "x")).rejects.toThrow(ForbiddenError);
  });

  test("denies a guardian", async () => {
    mockFindById.mockReturnValue(madeDoc());
    await expect(englishDriveDocById(ctxOf("GUARDIAN"), "x")).rejects.toThrow(ForbiddenError);
  });
});

// ---------------------------------------------------------------------------
// Upload — validation, create vs replace, audit
// ---------------------------------------------------------------------------

describe("uploadEnglishDriveDoc", () => {
  test("rejects a class level outside 1..5", async () => {
    await expect(uploadEnglishDriveDoc({ ...validUpload(), classLevel: 0 })).rejects.toThrow(
      /শ্রেণি/,
    );
    await expect(uploadEnglishDriveDoc({ ...validUpload(), classLevel: 6 })).rejects.toThrow(
      /শ্রেণি/,
    );
  });

  test("rejects an unknown kind, a bad version and an empty file", async () => {
    await expect(uploadEnglishDriveDoc({ ...validUpload(), kind: "VOCAB" })).rejects.toThrow(
      /ধরন/,
    );
    await expect(uploadEnglishDriveDoc({ ...validUpload(), version: 0 })).rejects.toThrow(
      /ভার্সন/,
    );
    await expect(uploadEnglishDriveDoc({ ...validUpload(), contentMd: "  " })).rejects.toThrow(
      /খালি/,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("rejects a file over the 1 MB cap", async () => {
    const big = "x".repeat(1024 * 1024 + 1);
    await expect(uploadEnglishDriveDoc({ ...validUpload(), contentMd: big })).rejects.toThrow(
      /বড়/,
    );
  });

  test("a new (class, block, kind) creates and audits ENGLISH_DRIVE_UPLOADED", async () => {
    const out = await uploadEnglishDriveDoc(validUpload());
    expect(out.replacedVersion).toBeNull();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ classLevel: 3, blockNumber: 1, kind: "TN", version: 2 }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "ENGLISH_DRIVE_UPLOADED",
        meta: expect.objectContaining({ classLevel: 3, blockNumber: 1, kind: "TN", version: 2 }),
      }),
    );
  });

  test("re-upload replaces: old row stamped replacedAt, audit ENGLISH_DRIVE_REPLACED", async () => {
    const prev = madeDoc({ version: 2 });
    mockFindOne.mockResolvedValue(prev);
    const out = await uploadEnglishDriveDoc({ ...validUpload(), version: 3 });
    expect(prev.replacedAt).toBeInstanceOf(Date);
    expect(prev.save).toHaveBeenCalled();
    expect(out.replacedVersion).toBe(2);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "ENGLISH_DRIVE_REPLACED",
        meta: expect.objectContaining({ version: 3, prevVersion: 2 }),
      }),
    );
  });
});
