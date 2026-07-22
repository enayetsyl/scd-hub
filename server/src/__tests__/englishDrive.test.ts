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

// ED-2 collaborators — mocked so the DB-free test never loads pdfkit/Drive/queue.
const mockMarkdownToPdf = jest.fn();
jest.mock("../routes/pdfRenderer", () => ({
  markdownToPdf: (md: unknown, o: unknown) => mockMarkdownToPdf(md, o),
}));

const mockDriveUpload = jest.fn();
jest.mock("../modules/platform/services/DriveStore", () => {
  class DriveUnavailableError extends Error {}
  return {
    DriveUnavailableError,
    uploadToDrive: (i: unknown) => mockDriveUpload(i),
  };
});

const mockStoredCreate = jest.fn();
jest.mock("../modules/platform/models/StoredFile", () => ({
  StoredFile: { create: (d: unknown) => mockStoredCreate(d) },
}));

const mockCreatePrint = jest.fn();
jest.mock("../modules/printing/services/PrintRequestService", () => ({
  createPrintRequest: (i: unknown) => mockCreatePrint(i),
}));

// Import AFTER mocks
import { ForbiddenError } from "../middleware/authz";
import { DriveUnavailableError } from "../modules/platform/services/DriveStore";
import {
  allowedEnglishDriveClassLevels,
  myEnglishDriveClassLevels,
  englishDriveDocs,
  englishDriveDocById,
  uploadEnglishDriveDoc,
  sendEnglishDriveDocToPrint,
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
  seq: 1,
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

const STORED_ID = oid();

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
  mockMarkdownToPdf.mockResolvedValue(Buffer.from("%PDF-fake"));
  mockDriveUpload.mockResolvedValue("drive-file-1");
  mockStoredCreate.mockImplementation(async (d: Record<string, unknown>) => ({ _id: STORED_ID, ...d }));
  mockCreatePrint.mockImplementation(async (i: { title: string }) => ({ _id: oid(), title: i.title }));
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
      expect.objectContaining({ classLevel: 3, blockNumber: 1, kind: "TN", seq: 1, version: 2 }),
    );
    // The replace lookup treats pre-seq rows (no field) as identity seq 1.
    expect(mockFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ seq: { $in: [1, null] } }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "ENGLISH_DRIVE_UPLOADED",
        meta: expect.objectContaining({ classLevel: 3, blockNumber: 1, kind: "TN", version: 2 }),
      }),
    );
  });

  test("same kind, different seq does NOT replace — HW1..HW4 live side by side", async () => {
    // The testing finding behind D-#345: 4 different homework files in one block.
    await uploadEnglishDriveDoc({ ...validUpload(), kind: "HW", seq: 4 });
    expect(mockFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "HW", seq: 4, replacedAt: null }),
    );
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ kind: "HW", seq: 4 }));
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "ENGLISH_DRIVE_UPLOADED" }),
    );
  });

  test("rejects a bad seq", async () => {
    await expect(uploadEnglishDriveDoc({ ...validUpload(), seq: 0 })).rejects.toThrow(/ক্রমিক/);
  });

  test("PT covers 1+ blocks (D-#347): blockNumbers stored, scalar block null, keyed by seq", async () => {
    await uploadEnglishDriveDoc({
      ...validUpload(),
      kind: "PT",
      blockNumber: null,
      blockNumbers: [5, 3, 4, 3], // deduped + sorted → [3,4,5]
      seq: 2,
    });
    // Replace identity ignores the block set — a PT is keyed (class, PT, seq).
    expect(mockFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ blockNumber: null, kind: "PT", seq: 2 }),
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "PT", blockNumber: null, blockNumbers: [3, 4, 5], seq: 2 }),
    );
  });

  test("PT with no blocks is rejected", async () => {
    await expect(
      uploadEnglishDriveDoc({ ...validUpload(), kind: "PT", blockNumber: null, blockNumbers: [] }),
    ).rejects.toThrow(/ব্লক/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("AS may be block-less (week-scoped, D-#346); other kinds still need a block", async () => {
    await uploadEnglishDriveDoc({ ...validUpload(), kind: "AS", blockNumber: null, seq: 3 });
    expect(mockFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ blockNumber: null, kind: "AS", seq: 3 }),
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ blockNumber: null, kind: "AS", seq: 3 }),
    );
    await expect(
      uploadEnglishDriveDoc({ ...validUpload(), kind: "CW", blockNumber: null }),
    ).rejects.toThrow(/ব্লক/);
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

// ---------------------------------------------------------------------------
// ED-2 — send to print through the EXISTING queue path
// ---------------------------------------------------------------------------

describe("sendEnglishDriveDocToPrint", () => {
  const printInput = { id: "x", colour: "BW", sides: "SINGLE", copies: 10 };

  test("a teacher of the class files an UPLOAD request with a print_upload PDF they own", async () => {
    mockResolveScopes.mockResolvedValue([teachingScope(ENG_ID, C3_ID)]);
    mockFindById.mockReturnValue(madeDoc());
    const out = await sendEnglishDriveDocToPrint(ctxOf("TEACHER"), printInput);
    expect(mockMarkdownToPdf).toHaveBeenCalledWith(
      expect.stringContaining("# Block 1"),
      expect.anything(),
    );
    expect(mockStoredCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "print_upload",
        mime: "application/pdf",
        uploadedBy: TEACHER_ID.toString(),
      }),
    );
    // The requester owns the file → assertSourceResolves passes with NO waiver.
    expect(mockCreatePrint).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: "UPLOAD",
        fileIds: [STORED_ID.toString()],
        purpose: "LESSON_PLAN", // TN
        colour: "BW",
        sides: "SINGLE",
        copies: 10,
        subject: "ENG",
        requestedBy: TEACHER_ID.toString(),
      }),
    );
    expect(out.printRequestId).toBeTruthy();
    expect(out.title).toContain("C3_B1_TN_v2");
  });

  test("a teacher outside the doc's class is denied — nothing rendered or filed", async () => {
    mockResolveScopes.mockResolvedValue([teachingScope(ENG_ID, C3_ID)]);
    mockFindById.mockReturnValue(madeDoc({ classLevel: 4 }));
    await expect(sendEnglishDriveDocToPrint(ctxOf("TEACHER"), printInput)).rejects.toThrow(
      ForbiddenError,
    );
    expect(mockMarkdownToPdf).not.toHaveBeenCalled();
    expect(mockCreatePrint).not.toHaveBeenCalled();
  });

  test("a guardian is denied", async () => {
    mockFindById.mockReturnValue(madeDoc());
    await expect(sendEnglishDriveDocToPrint(ctxOf("GUARDIAN"), printInput)).rejects.toThrow(
      ForbiddenError,
    );
    expect(mockCreatePrint).not.toHaveBeenCalled();
  });

  test("kind maps to the queue purpose the Office reads", async () => {
    const cases: Array<[string, string]> = [
      ["BLOCK", "LESSON_PLAN"],
      ["CW", "CLASSWORK"],
      ["HW", "HOMEWORK"],
      ["PT", "CLASS_TEST"],
      ["AS", "ASSIGNMENT"],
      ["CLUE", "LESSON_PLAN"],
    ];
    for (const [kind, purpose] of cases) {
      mockCreatePrint.mockClear();
      mockFindById.mockReturnValue(madeDoc({ kind }));
      await sendEnglishDriveDocToPrint(ctxOf("PRINCIPAL"), printInput);
      expect(mockCreatePrint).toHaveBeenCalledWith(expect.objectContaining({ purpose }));
    }
  });

  test("a block-less assignment's print stamp omits the block", async () => {
    mockFindById.mockReturnValue(madeDoc({ kind: "AS", blockNumber: null, seq: 3 }));
    const out = await sendEnglishDriveDocToPrint(ctxOf("PRINCIPAL"), printInput);
    expect(out.title).toContain("C3_AS3_v2");
    expect(out.title).not.toContain("_B");
  });

  test("a multi-block PT's print stamp lists its block range (D-#347)", async () => {
    mockFindById.mockReturnValue(
      madeDoc({ kind: "PT", blockNumber: null, blockNumbers: [3, 4, 5], seq: 1 }),
    );
    const out = await sendEnglishDriveDocToPrint(ctxOf("PRINCIPAL"), printInput);
    expect(out.title).toContain("C3_B3-5_PT_v2");
  });

  test("edit-before-print renders the EDITED markdown + layout, not the stored doc (D-#348)", async () => {
    mockFindById.mockReturnValue(madeDoc());
    await sendEnglishDriveDocToPrint(ctxOf("PRINCIPAL"), {
      ...printInput,
      contentMd: "# Edited worksheet\nnew content",
      fontScale: 1.3,
      lineSpacing: 2,
      margin: 70,
    });
    expect(mockMarkdownToPdf).toHaveBeenCalledWith(
      expect.stringContaining("Edited worksheet"),
      expect.objectContaining({ fontScale: 1.3, lineSpacing: 2, margin: 70 }),
    );
  });

  test("edit-before-print falls back to the stored markdown when no edit is supplied", async () => {
    mockFindById.mockReturnValue(madeDoc());
    await sendEnglishDriveDocToPrint(ctxOf("PRINCIPAL"), printInput);
    expect(mockMarkdownToPdf).toHaveBeenCalledWith(
      expect.stringContaining("# Block 1"),
      expect.anything(),
    );
  });

  test("Drive down → Bangla error, no request filed", async () => {
    mockFindById.mockReturnValue(madeDoc());
    mockDriveUpload.mockRejectedValue(new DriveUnavailableError("down"));
    await expect(sendEnglishDriveDocToPrint(ctxOf("PRINCIPAL"), printInput)).rejects.toThrow(
      /স্টোরেজ/,
    );
    expect(mockStoredCreate).not.toHaveBeenCalled();
    expect(mockCreatePrint).not.toHaveBeenCalled();
  });
});
