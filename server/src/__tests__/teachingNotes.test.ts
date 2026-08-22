/**
 * Teaching Notes tests (TN-1, prd-teaching-notes, D-#513–#516).
 *
 * Encoding — the guard that matters (PRD §5): a mojibake title or body is
 *            REJECTED and nothing persists. Every seed document arrived broken.
 * Scope    — visibility is (class × subject) PAIRS: a Class 5 Bangla teacher sees
 *            C5-BAN and NOT C5-MATH (the cross-product leak) and NOT C3-BAN; an
 *            Arabic teacher reaches ARABIC through the ROUTINE (no Subject row
 *            exists for it) at every level; guardians denied; P/O unrestricted.
 * Upload   — validation; version is SERVER-assigned; create audits
 *            TEACHING_NOTE_UPLOADED; re-upload stamps the old row replacedAt,
 *            bumps to v2 and audits TEACHING_NOTE_REPLACED.
 * Library  — only unreplaced rows, pair-filtered, metadata only.
 * Files    — the read gate reverse-resolves the owning note and applies the pair.
 *
 * DB-free (repo convention): models + audit + scope resolution are mocked.
 */
import mongoose from "mongoose";
import type { AppContext } from "../context";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the module under test)
// ---------------------------------------------------------------------------

const mockCreate = jest.fn();
const mockFindOne = jest.fn();
const mockFind = jest.fn();
const mockFindById = jest.fn();
jest.mock("../modules/teaching-notes/models/TeachingNote", () => {
  const actual = jest.requireActual("../modules/teaching-notes/models/TeachingNote");
  return {
    ...actual,
    TeachingNote: {
      create: (d: unknown) => mockCreate(d),
      findOne: (q: unknown) => {
        const r = mockFindOne(q);
        // findOne is used two ways: awaited directly (upload) and with
        // .select().lean() (the file gate). Support both off one mock.
        return Object.assign(Promise.resolve(r), {
          select: () => ({ lean: async () => r }),
        });
      },
      find: (q: unknown) => ({ select: () => ({ lean: async () => mockFind(q) }) }),
      findById: (id: unknown) => ({
        select: () => ({ lean: async () => mockFindById(id) }),
        lean: async () => mockFindById(id),
      }),
    },
  };
});

// TN-2 collaborator: the library rows carry comment badge counts, so the note
// service now reaches TeachingNoteComment. Mocked empty — the counts have their
// own suite (teachingNoteComments.test.ts); without this the DB-free suite would
// hit a real (unconnected) model and time out on Mongoose buffering.
const mockCommentFind = jest.fn();
jest.mock("../modules/teaching-notes/models/TeachingNoteComment", () => {
  const actual = jest.requireActual("../modules/teaching-notes/models/TeachingNoteComment");
  return {
    ...actual,
    TeachingNoteComment: {
      find: (q: unknown) => ({ select: () => ({ lean: async () => mockCommentFind(q) }) }),
    },
  };
});

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// TN-3: the upload now notifies the pair's teachers. Best-effort and it reaches
// Class/RoutineSlot, so it is mocked here — the emit is asserted, not executed.
const mockEmitPublished = jest.fn();
jest.mock("../modules/notifications/services/emitters", () => ({
  emitTeachingNotePublished: (e: unknown) => mockEmitPublished(e),
}));

const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    find: (q: unknown) => ({ select: () => ({ lean: async () => mockUserFind(q) }) }),
  },
}));

const mockSubjectFind = jest.fn();
const mockSubjectFindById = jest.fn();
jest.mock("../modules/foundation/models/Subject", () => ({
  Subject: {
    find: (q: unknown) => ({ select: () => ({ lean: async () => mockSubjectFind(q) }) }),
    findById: (id: unknown) => ({ select: () => ({ lean: async () => mockSubjectFindById(id) }) }),
  },
}));

const mockClassFind = jest.fn();
jest.mock("../modules/foundation/models/Class", () => ({
  Class: {
    find: (q: unknown) => ({ select: () => ({ lean: async () => mockClassFind(q) }) }),
  },
}));

const mockSlotFind = jest.fn();
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: {
    find: (q: unknown) => ({ select: () => ({ lean: async () => mockSlotFind(q) }) }),
  },
}));

const mockStoredFindById = jest.fn();
const mockStoredCreate = jest.fn();
jest.mock("../modules/platform/models/StoredFile", () => ({
  StoredFile: {
    findById: (id: unknown) => ({ select: () => ({ lean: async () => mockStoredFindById(id) }) }),
    create: (d: unknown) => mockStoredCreate(d),
  },
}));

// TN-3 print collaborators — mocked so this DB-free suite never loads pdfkit,
// Drive or the print queue.
const mockUploadToDrive = jest.fn();
jest.mock("../modules/platform/services/DriveStore", () => {
  const actual = jest.requireActual("../modules/platform/services/DriveStore");
  return { ...actual, uploadToDrive: (a: unknown) => mockUploadToDrive(a) };
});

const mockMarkdownToPdf = jest.fn();
jest.mock("../routes/pdfRenderer", () => ({
  markdownToPdf: (md: unknown, o: unknown) => mockMarkdownToPdf(md, o),
}));

const mockCreatePrint = jest.fn();
jest.mock("../modules/printing/services/PrintRequestService", () => ({
  createPrintRequest: (i: unknown) => mockCreatePrint(i),
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
  teachingNoteVisibility,
  myTeachingNoteScope,
  teachingNotes,
  teachingNoteById,
  uploadTeachingNote,
  sendTeachingNoteToPrint,
  assertTeachingNoteFileReadAccess,
  looksLikeMojibake,
  pairKey,
  TEACHING_NOTE_MOJIBAKE_ERROR,
} from "../modules/teaching-notes/services/TeachingNoteService";

const BAN_ID = oid();
const MATH_ID = oid();
const C3_ID = oid();
const C5_ID = oid();
const OFFICE_ID = oid();
const TEACHER_ID = oid();

const levelByClassId = new Map<string, number>([
  [C3_ID.toString(), 3],
  [C5_ID.toString(), 5],
]);

const ctxOf = (role: string, userId = TEACHER_ID.toString()) =>
  ({ auth: { userId, role } }) as unknown as AppContext;

const sectionSlot = (subject: string, classId: mongoose.Types.ObjectId) => ({
  subject,
  groupType: "section",
  classId,
});

const groupSlot = (subject: string) => ({
  subject,
  groupType: "subjectgroup",
  classId: null,
});

const madeNote = (over: Record<string, unknown> = {}) => ({
  _id: oid(),
  classLevel: 5,
  subject: "BAN",
  kind: "ANSWER_GUIDE",
  seq: 1,
  title: "Class 5 Bangla — short & long answer structure",
  version: 1,
  format: "MD",
  contentMd: "# কাঠামো\nপ্রশ্ন পড়ি",
  fileId: null,
  pdfFileId: null,
  uploadedBy: OFFICE_ID,
  replacedAt: null,
  createdAt: new Date(),
  save: jest.fn(async () => undefined),
  ...over,
});

const validUpload = (over: Record<string, unknown> = {}) => ({
  classLevel: 5,
  subject: "BAN",
  kind: "ANSWER_GUIDE",
  title: "Class 5 Bangla — short & long answer structure",
  contentMd: "# কাঠামো\nপ্রশ্ন পড়ি → পয়েন্ট তুলি",
  actorId: OFFICE_ID.toString(),
  actorRole: "OFFICE",
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCommentFind.mockReturnValue([]);
  mockSlotFind.mockResolvedValue([]);
  mockResolveScopes.mockResolvedValue([]);
  mockSubjectFind.mockReturnValue([]);
  mockSubjectFindById.mockReturnValue(null);
  mockUserFind.mockReturnValue([{ _id: OFFICE_ID, name: "Office" }]);
  mockClassFind.mockImplementation((q: { _id: { $in: string[] } }) =>
    q._id.$in
      .filter((id) => levelByClassId.has(id.toString()))
      .map((id) => ({ _id: id, level: levelByClassId.get(id.toString()) })),
  );
  mockFindOne.mockReturnValue(null);
  mockFind.mockReturnValue([]);
  mockFindById.mockReturnValue(null);
  mockCreate.mockImplementation(async (d: Record<string, unknown>) => ({ _id: oid(), ...d }));
  mockStoredCreate.mockImplementation(async (d: Record<string, unknown>) => ({ _id: oid(), ...d }));
  mockMarkdownToPdf.mockResolvedValue(Buffer.from("%PDF-1.4 fake"));
  mockUploadToDrive.mockResolvedValue("drive-file-id");
  mockCreatePrint.mockImplementation(async (i: { title: string }) => ({
    _id: oid(),
    title: i.title,
  }));
});

// ---------------------------------------------------------------------------
// The encoding guard (PRD §5)
// ---------------------------------------------------------------------------

describe("mojibake guard", () => {
  test("detects UTF-8-read-as-Latin-1 Bangla", () => {
    // The exact byte pattern every seed document arrived with.
    expect(looksLikeMojibake("à¦¬à¦¾à¦à¦²à¦¾")).toBe(true);
    expect(looksLikeMojibake("# Class 5 Bangla â à¦¸à¦à¦à§à¦·à¦¿à¦ªà§à¦¤")).toBe(true);
  });

  test("passes correct Bangla and plain English untouched", () => {
    expect(looksLikeMojibake("বাংলা — সংক্ষিপ্ত ও বিস্তৃত উত্তর")).toBe(false);
    expect(looksLikeMojibake("# Class 5 Bangla structure")).toBe(false);
    expect(looksLikeMojibake("café naïve résumé")).toBe(false);
  });

  test("a mojibake BODY is rejected and nothing persists", async () => {
    await expect(
      uploadTeachingNote(validUpload({ contentMd: "# à¦¬à¦¾à¦à¦²à¦¾\nà¦ªà§à¦°à¦¶à§à¦¨" })),
    ).rejects.toThrow(TEACHING_NOTE_MOJIBAKE_ERROR);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("a mojibake TITLE is rejected too", async () => {
    await expect(uploadTeachingNote(validUpload({ title: "à¦¬à¦¾à¦à¦²à¦¾ à¦¨à§à¦" }))).rejects.toThrow(
      TEACHING_NOTE_MOJIBAKE_ERROR,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Visibility — (class × subject) pairs
// ---------------------------------------------------------------------------

describe("visibility", () => {
  test("Principal and Office are unrestricted", async () => {
    await expect(teachingNoteVisibility(ctxOf("PRINCIPAL"))).resolves.toBeNull();
    await expect(teachingNoteVisibility(ctxOf("OFFICE"))).resolves.toBeNull();
  });

  test("a guardian is denied", async () => {
    await expect(teachingNoteVisibility(ctxOf("GUARDIAN"))).rejects.toBeInstanceOf(ForbiddenError);
    // ...but the drawer probe never throws — it would break the shell render.
    await expect(myTeachingNoteScope(ctxOf("GUARDIAN"))).resolves.toEqual([]);
  });

  test("a Class 5 Bangla teacher gets C5-BAN and NOT C5-MATH or C3-BAN", async () => {
    mockSlotFind.mockResolvedValue([sectionSlot("BAN", C5_ID)]);
    const allowed = await teachingNoteVisibility(ctxOf("TEACHER"));
    expect(allowed).not.toBeNull();
    expect(allowed!.has(pairKey(5, "BAN"))).toBe(true);
    expect(allowed!.has(pairKey(5, "MATH"))).toBe(false);
    expect(allowed!.has(pairKey(3, "BAN"))).toBe(false);
  });

  test("two subjects in two classes do NOT cross-product", async () => {
    mockSlotFind.mockResolvedValue([sectionSlot("BAN", C5_ID), sectionSlot("MATH", C3_ID)]);
    const allowed = await teachingNoteVisibility(ctxOf("TEACHER"));
    expect(allowed!.has(pairKey(5, "BAN"))).toBe(true);
    expect(allowed!.has(pairKey(3, "MATH"))).toBe(true);
    // The leak this test exists for.
    expect(allowed!.has(pairKey(5, "MATH"))).toBe(false);
    expect(allowed!.has(pairKey(3, "BAN"))).toBe(false);
  });

  test("an ARABIC teacher reaches ARABIC at every level through the routine", async () => {
    // ARABIC has NO Subject row (FOUNDATION_SUBJECTS excludes it), so a
    // grant-only walk would return an empty set here.
    mockSlotFind.mockResolvedValue([groupSlot("ARABIC")]);
    const allowed = await teachingNoteVisibility(ctxOf("TEACHER"));
    expect(allowed!.has(pairKey(5, "ARABIC"))).toBe(true);
    expect(allowed!.has(pairKey(-1, "ARABIC"))).toBe(true);
    expect(allowed!.has(pairKey(0, "ARABIC"))).toBe(true);
    expect(allowed!.has(pairKey(5, "BAN"))).toBe(false);
  });

  test("a teaching GRANT also grants the pair (parity with the rest of the app)", async () => {
    mockResolveScopes.mockResolvedValue([
      { kind: "teaching", classId: C5_ID.toString(), sectionId: oid().toString(), subjectId: BAN_ID.toString() },
    ]);
    mockSubjectFind.mockReturnValue([{ code: "BAN" }]);
    const allowed = await teachingNoteVisibility(ctxOf("TEACHER"));
    expect(allowed!.has(pairKey(5, "BAN"))).toBe(true);
  });

  test("a whole-school supervisor is unrestricted", async () => {
    mockResolveScopes.mockResolvedValue([{ kind: "supervisory", extent: "whole_school" }]);
    await expect(teachingNoteVisibility(ctxOf("TEACHER"))).resolves.toBeNull();
  });

  test("a grade_class supervisor gets every subject of that class only", async () => {
    mockResolveScopes.mockResolvedValue([
      { kind: "supervisory", extent: "grade_class", classId: C3_ID.toString() },
    ]);
    const allowed = await teachingNoteVisibility(ctxOf("TEACHER"));
    expect(allowed!.has(pairKey(3, "BAN"))).toBe(true);
    expect(allowed!.has(pairKey(3, "QURAN"))).toBe(true);
    expect(allowed!.has(pairKey(5, "BAN"))).toBe(false);
  });

  test("a subject_dept supervisor gets that subject at every level", async () => {
    mockResolveScopes.mockResolvedValue([
      { kind: "supervisory", extent: "subject_dept", subjectId: MATH_ID.toString() },
    ]);
    mockSubjectFindById.mockReturnValue({ code: "MATH" });
    const allowed = await teachingNoteVisibility(ctxOf("TEACHER"));
    expect(allowed!.has(pairKey(1, "MATH"))).toBe(true);
    expect(allowed!.has(pairKey(5, "MATH"))).toBe(true);
    expect(allowed!.has(pairKey(5, "BAN"))).toBe(false);
  });

  test("a teacher with no slots and no grants sees nothing", async () => {
    const allowed = await teachingNoteVisibility(ctxOf("TEACHER"));
    expect(allowed!.size).toBe(0);
    await expect(myTeachingNoteScope(ctxOf("TEACHER"))).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Library reads
// ---------------------------------------------------------------------------

describe("library", () => {
  test("reads only UNREPLACED rows", async () => {
    await teachingNotes(ctxOf("PRINCIPAL"));
    expect(mockFind).toHaveBeenCalledWith(expect.objectContaining({ replacedAt: null }));
  });

  test("filters rows down to the caller's pairs", async () => {
    mockSlotFind.mockResolvedValue([sectionSlot("BAN", C5_ID)]);
    mockFind.mockReturnValue([
      madeNote({ classLevel: 5, subject: "BAN", title: "mine" }),
      madeNote({ classLevel: 5, subject: "MATH", title: "not mine" }),
      madeNote({ classLevel: 3, subject: "BAN", title: "not mine either" }),
    ]);
    const rows = await teachingNotes(ctxOf("TEACHER"));
    expect(rows.map((r) => r.title)).toEqual(["mine"]);
  });

  test("a fully-specified pair outside scope is REFUSED, not silently empty", async () => {
    mockSlotFind.mockResolvedValue([sectionSlot("BAN", C5_ID)]);
    await expect(
      teachingNotes(ctxOf("TEACHER"), { classLevel: 5, subject: "MATH" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("library rows carry metadata only — never the markdown", async () => {
    mockFind.mockReturnValue([madeNote()]);
    const rows = await teachingNotes(ctxOf("PRINCIPAL"));
    expect(rows[0].contentMd).toBeNull();
    expect(rows[0].title).toBeTruthy();
  });

  test("the single read carries the markdown, and refuses out of scope", async () => {
    const note = madeNote();
    mockFindById.mockReturnValue(note);
    const full = await teachingNoteById(ctxOf("PRINCIPAL"), note._id.toString());
    expect(full.contentMd).toBe(note.contentMd);

    mockSlotFind.mockResolvedValue([sectionSlot("MATH", C3_ID)]);
    await expect(
      teachingNoteById(ctxOf("TEACHER"), note._id.toString()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ---------------------------------------------------------------------------
// Upload / replace
// ---------------------------------------------------------------------------

describe("upload", () => {
  test("a new identity creates v1 and audits TEACHING_NOTE_UPLOADED", async () => {
    const res = await uploadTeachingNote(validUpload());
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ classLevel: 5, subject: "BAN", kind: "ANSWER_GUIDE", version: 1 }),
    );
    expect(res.replacedVersion).toBeNull();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "TEACHING_NOTE_UPLOADED" }),
    );
  });

  test("notifies the pair's teachers, naming the class and subject in Bangla", async () => {
    await uploadTeachingNote(validUpload());
    expect(mockEmitPublished).toHaveBeenCalledWith(
      expect.objectContaining({
        classLevel: 5,
        subject: "BAN",
        subjectLabel: "বাংলা",
        uploadedBy: OFFICE_ID.toString(),
      }),
    );
  });

  test("re-upload stamps the old row replacedAt, bumps to v2, audits REPLACED", async () => {
    const prev = madeNote({ version: 1 });
    mockFindOne.mockReturnValue(prev);
    const res = await uploadTeachingNote(validUpload());
    expect(prev.replacedAt).toBeInstanceOf(Date);
    expect(prev.save).toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }));
    expect(res.replacedVersion).toBe(1);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "TEACHING_NOTE_REPLACED" }),
    );
  });

  test("the version is SERVER-assigned — a caller cannot set or reuse one", async () => {
    mockFindOne.mockReturnValue(madeNote({ version: 7 }));
    await uploadTeachingNote(validUpload({ version: 2 } as Record<string, unknown>));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ version: 8 }));
  });

  test("validates class, subject, kind, title and empty body", async () => {
    await expect(uploadTeachingNote(validUpload({ classLevel: 9 }))).rejects.toThrow("শ্রেণি সঠিক নয়");
    await expect(uploadTeachingNote(validUpload({ subject: "NOPE" }))).rejects.toThrow("বিষয় সঠিক নয়");
    await expect(uploadTeachingNote(validUpload({ kind: "NOPE" }))).rejects.toThrow(/ধরন সঠিক নয়/);
    await expect(uploadTeachingNote(validUpload({ title: "   " }))).rejects.toThrow("শিরোনাম লিখুন");
    await expect(uploadTeachingNote(validUpload({ contentMd: "  " }))).rejects.toThrow(/খালি/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("Nursery (-1) and KG (0) are valid classes — this is the roster axis", async () => {
    await uploadTeachingNote(validUpload({ classLevel: -1 }));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ classLevel: -1 }));
  });

  test("ARABIC and QURAN are valid subjects even with no Subject row", async () => {
    await uploadTeachingNote(validUpload({ subject: "QURAN" }));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ subject: "QURAN" }));
  });

  test("rejects a body over the 1 MB cap", async () => {
    await expect(
      uploadTeachingNote(validUpload({ contentMd: "a".repeat(1024 * 1024 + 1) })),
    ).rejects.toThrow(/খুব বড়/);
  });

  test("a PDF note requires a teaching_note StoredFile", async () => {
    await expect(uploadTeachingNote(validUpload({ format: "PDF" }))).rejects.toThrow(/আপলোড হয়নি/);

    const fid = oid();
    mockStoredFindById.mockReturnValue({ kind: "english_drive" }); // someone else's file
    await expect(
      uploadTeachingNote(validUpload({ format: "PDF", fileId: fid.toString() })),
    ).rejects.toThrow(/খুঁজে পাওয়া যায়নি/);

    mockStoredFindById.mockReturnValue({ kind: "teaching_note" });
    await uploadTeachingNote(validUpload({ format: "PDF", fileId: fid.toString() }));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ format: "PDF", contentMd: "" }),
    );
  });
});

// ---------------------------------------------------------------------------
// TN-3 — send to print
// ---------------------------------------------------------------------------

describe("send to print", () => {
  const printOpts = {
    colour: "BW",
    sides: "SINGLE",
    copies: 3,
    neededByKey: "2026-08-25",
  };

  test("an MD note is rendered and filed as LESSON_PLAN through the print queue", async () => {
    const note = madeNote();
    mockFindById.mockReturnValue(note);
    const res = await sendTeachingNoteToPrint(ctxOf("PRINCIPAL"), {
      id: note._id.toString(),
      ...printOpts,
    });

    expect(mockMarkdownToPdf).toHaveBeenCalled();
    expect(mockCreatePrint).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "LESSON_PLAN",
        sourceType: "UPLOAD",
        subject: "BAN",
        copies: 3,
        neededByKey: "2026-08-25",
      }),
    );
    // The rendered PDF is stored as a print_upload, the queue's own file kind.
    expect(mockStoredCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "print_upload", mime: "application/pdf" }),
    );
    expect(res.printRequestId).toBeTruthy();
  });

  test("a PDF note files the STORED binary — no re-render", async () => {
    const fileId = oid();
    const note = madeNote({ format: "PDF", fileId, contentMd: "" });
    mockFindById.mockReturnValue(note);
    await sendTeachingNoteToPrint(ctxOf("OFFICE"), { id: note._id.toString(), ...printOpts });

    expect(mockMarkdownToPdf).not.toHaveBeenCalled();
    expect(mockCreatePrint).toHaveBeenCalledWith(
      expect.objectContaining({ fileIds: [fileId.toString()], trusted: true }),
    );
  });

  test("a DOCX note prints its CONVERTED pdf, not the .docx", async () => {
    const fileId = oid();
    const pdfFileId = oid();
    const note = madeNote({ format: "DOCX", fileId, pdfFileId, contentMd: "" });
    mockFindById.mockReturnValue(note);
    await sendTeachingNoteToPrint(ctxOf("OFFICE"), { id: note._id.toString(), ...printOpts });

    expect(mockCreatePrint).toHaveBeenCalledWith(
      expect.objectContaining({ fileIds: [pdfFileId.toString()] }),
    );
  });

  test("a teacher outside the note's pair cannot print it", async () => {
    const note = madeNote();
    mockFindById.mockReturnValue(note);
    mockSlotFind.mockResolvedValue([sectionSlot("MATH", C3_ID)]);
    await expect(
      sendTeachingNoteToPrint(ctxOf("TEACHER"), { id: note._id.toString(), ...printOpts }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockCreatePrint).not.toHaveBeenCalled();
  });

  test("an OTHER-kind note files as OTHER", async () => {
    const note = madeNote({ kind: "OTHER" });
    mockFindById.mockReturnValue(note);
    await sendTeachingNoteToPrint(ctxOf("PRINCIPAL"), { id: note._id.toString(), ...printOpts });
    expect(mockCreatePrint).toHaveBeenCalledWith(expect.objectContaining({ purpose: "OTHER" }));
  });
});

// ---------------------------------------------------------------------------
// The file read gate
// ---------------------------------------------------------------------------

describe("file read gate", () => {
  test("reverse-resolves the owning note and allows an in-scope teacher", async () => {
    const fileId = oid();
    mockFindOne.mockReturnValue({ classLevel: 5, subject: "BAN" });
    mockSlotFind.mockResolvedValue([sectionSlot("BAN", C5_ID)]);
    await expect(
      assertTeachingNoteFileReadAccess(ctxOf("TEACHER"), { _id: fileId }),
    ).resolves.toBeUndefined();
  });

  test("refuses an out-of-scope teacher and an orphan file", async () => {
    const fileId = oid();
    mockFindOne.mockReturnValue({ classLevel: 5, subject: "BAN" });
    mockSlotFind.mockResolvedValue([sectionSlot("MATH", C3_ID)]);
    await expect(
      assertTeachingNoteFileReadAccess(ctxOf("TEACHER"), { _id: fileId }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    mockFindOne.mockReturnValue(null);
    await expect(
      assertTeachingNoteFileReadAccess(ctxOf("PRINCIPAL"), { _id: fileId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("a guardian is refused outright", async () => {
    mockFindOne.mockReturnValue({ classLevel: 5, subject: "BAN" });
    await expect(
      assertTeachingNoteFileReadAccess(ctxOf("GUARDIAN"), { _id: oid() }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
