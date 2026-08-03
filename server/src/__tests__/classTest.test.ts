/**
 * Class Test Tracker CT-1 tests (prd-tracker-class-test §3/§5, D-#119–#122).
 *
 * Sequence   — generateCtId formats CT-C{class}-{SUBJ}-{nnnn} + bumps atomically.
 * Lifecycle  — createRequest (POOL_SET / UPLOADED_PAPER, derives year/level from
 *              the section, passMark default, REQUESTED + audit); markPrinted
 *              (REQUESTED→PRINTED + stamps + audit, rejects non-REQUESTED);
 *              cancelRequest (REQUESTED→CANCELLED, rejects a printed exam).
 * Files      — POST /files/classtest gate (tracker:write, mime/size, Drive-down
 *              503 + nothing persisted, fileId never carries driveFileId); GET
 *              /files/:id class-test gate (Office OR the uploading teacher only).
 *
 * DB-free (the repo's convention): models + Drive + audit are mocked; routes via
 * supertest. The pure auth gate (roster:manage OR uploader) is exercised directly.
 */
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};
/** A findById result that is BOTH awaitable (live doc) and `.lean()`-able. */
const findByIdResult = (doc: unknown) => {
  const p = Promise.resolve(doc) as Promise<unknown> & { lean: () => Promise<unknown> };
  p.lean = async () => doc;
  return p;
};

const mockSeqUpdate = jest.fn();
jest.mock("../modules/trackers/models/ClassTestSequence", () => ({
  ClassTestSequence: { findOneAndUpdate: (...a: unknown[]) => mockSeqUpdate(...a) },
}));

const mockCtCreate = jest.fn();
const mockCtFindById = jest.fn();
const mockCtFindOne = jest.fn();
const mockCtFind = jest.fn();
const mockCtResultCount = jest.fn().mockResolvedValue(0);
jest.mock("../modules/trackers/models/ClassTestResult", () => ({
  ClassTestResult: { countDocuments: (q: unknown) => mockCtResultCount(q) },
}));
jest.mock("../modules/trackers/models/ClassTest", () => ({
  ClassTest: {
    create: (a: unknown) => mockCtCreate(a),
    findById: (id: unknown) => mockCtFindById(id),
    findOne: (q: unknown) => mockCtFindOne(q),
    find: (q: unknown) => mockCtFind(q),
    updateOne: (q: unknown, u: unknown) => mockCtUpdateOne(q, u),
  },
}));
// PQ-5 (D-#281): a class test's printing now rides the unified PrintRequest queue, and
// this legacy entry point mirrors its transitions onto the queue row.
const mockCreatePrintRequest = jest.fn();
const mockPrUpdateOne = jest.fn().mockResolvedValue({});
jest.mock("../modules/printing/services/PrintRequestService", () => ({
  createPrintRequest: (i: unknown) => mockCreatePrintRequest(i),
}));
jest.mock("../modules/printing/models/PrintRequest", () => ({
  PrintRequest: { updateOne: (q: unknown, u: unknown) => mockPrUpdateOne(q, u) },
}));

const mockCtUpdateOne = jest.fn().mockResolvedValue({});
const mockSectionFindById = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { findById: (id: unknown) => mockSectionFindById(id) },
}));

const mockClassFindById = jest.fn();
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { findById: (id: unknown) => mockClassFindById(id) },
}));

const mockSetFindById = jest.fn();
jest.mock("../modules/assessment/models/AssessmentSet", () => ({
  AssessmentSet: { findById: (id: unknown) => mockSetFindById(id) },
}));

// The routine decides a new exam's ACCOUNTABLE subject teacher (createRequest →
// resolveSubjectTeacher). Default: no slots, so attribution falls back to the
// actor and every pre-existing assertion holds; a test that wants the on-behalf
// path stubs slots explicitly.
const mockSlotFind = jest.fn(() => leanChain([]));
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (...a: unknown[]) => mockSlotFind(...(a as [])) },
}));

const mockUpload = jest.fn();
const mockDownload = jest.fn();
jest.mock("../modules/platform/services/DriveStore", () => {
  const actual = jest.requireActual("../modules/platform/services/DriveStore");
  return {
    DriveUnavailableError: actual.DriveUnavailableError,
    uploadToDrive: (i: unknown) => mockUpload(i),
    downloadFromDrive: (id: unknown) => mockDownload(id),
  };
});

const mockStoredCreate = jest.fn();
const mockStoredFindById = jest.fn();
jest.mock("../modules/platform/models/StoredFile", () => ({
  STORED_FILE_KINDS: ["hw_question", "hw_answer", "chat_image", "chat_pdf", "chat_video", "chat_audio", "classtest_question", "comment_image", "comment_pdf", "comment_video", "comment_audio"],
  CHAT_STORED_FILE_KINDS: ["chat_image", "chat_pdf", "chat_video", "chat_audio"],
  COMMENT_STORED_FILE_KINDS: ["comment_image", "comment_pdf", "comment_video", "comment_audio"],
  StoredFile: {
    create: (a: unknown) => mockStoredCreate(a),
    findById: (id: unknown) => ({ lean: () => mockStoredFindById(id) }),
  },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// D-#303: the queue row's title names the requesting teacher.
const mockUserFindById = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { findById: (id: unknown) => ({ select: () => ({ lean: () => mockUserFindById(id) }) }) },
}));

// D-#342: the file read-gate's last-resort lookup (requesting teacher of a
// question-request round). No question requests exist in these DB-free tests.
jest.mock("../modules/trackers/models/ClassTestQuestionRequest", () => ({
  ClassTestQuestionRequest: { exists: async () => null },
}));

// Import AFTER mocks
import {
  generateCtId,
  suggestTestNumber,
  defaultPassMark,
  createRequest,
  markPrinted,
  cancelRequest,
  retireClassTest,
  restoreClassTest,
} from "../modules/trackers/services/ClassTestService";
import { filesRouter, FILE_ERRORS_BN } from "../routes/files";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const app = express();
app.use("/files", filesRouter);

const SECRET = process.env.JWT_SECRET ?? "dev-secret";
const token = (userId: string, role: string) => jwt.sign({ userId, role }, SECRET);

const TEACHER_ID = oid().toString();
const OTHER_TEACHER_ID = oid().toString();
const PRINCIPAL_ID = oid().toString();
const SECTION_OID = oid();
const CLASS_OID = oid();
const AY_OID = oid();
const FILE_ID = oid();

const teacherTok = token(TEACHER_ID, "TEACHER");
const otherTeacherTok = token(OTHER_TEACHER_ID, "TEACHER");
const officeTok = token(oid().toString(), "OFFICE");
const principalTok = token(oid().toString(), "PRINCIPAL");
const guardianTok = token(oid().toString(), "GUARDIAN");

const classtestFile = {
  _id: FILE_ID,
  kind: "classtest_question",
  mime: "application/pdf",
  sizeBytes: 2048,
  originalName: "paper.pdf",
  driveFileId: "drive-internal-ct",
  uploadedBy: new mongoose.Types.ObjectId(TEACHER_ID),
};

beforeEach(() => {
  mockCtUpdateOne.mockResolvedValue({});
  mockCreatePrintRequest.mockResolvedValue({ _id: "print-req-1" });
  mockPrUpdateOne.mockResolvedValue({});
  jest.clearAllMocks();
  mockSeqUpdate.mockResolvedValue({ seq: 1 });
  mockSectionFindById.mockReturnValue(leanChain({ classId: CLASS_OID }));
  mockClassFindById.mockReturnValue(leanChain({ level: 3, academicYearId: AY_OID }));
  mockSetFindById.mockReturnValue(leanChain({ setType: "CT" }));
  mockSlotFind.mockReturnValue(leanChain([])); // routine names nobody → actor is accountable
  mockCtFindOne.mockReturnValue(leanChain(null)); // suggestTestNumber: none yet → 1
  mockCtCreate.mockImplementation(async (a: Record<string, unknown>) => ({ _id: oid(), ...a }));
  mockUpload.mockResolvedValue("drive-internal-ct");
  mockDownload.mockResolvedValue(Buffer.from("paper-bytes"));
  mockStoredCreate.mockImplementation(async (a: Record<string, unknown>) => ({ _id: FILE_ID, ...a }));
  mockStoredFindById.mockResolvedValue(classtestFile);
  mockWriteAudit.mockResolvedValue(undefined);
  mockUserFindById.mockResolvedValue({ name: "Kawsar Hossain" });
});

// ===========================================================================
// Sequence + pure helpers
// ===========================================================================

describe("generateCtId / suggestTestNumber / defaultPassMark", () => {
  test("formats CT-C{class}-{SUBJ}-{nnnn} zero-padded", async () => {
    mockSeqUpdate.mockResolvedValueOnce({ seq: 7 });
    expect(await generateCtId(AY_OID.toString(), 2, "BAN" as never)).toBe("CT-C2-BAN-0007");
    mockSeqUpdate.mockResolvedValueOnce({ seq: 1234 });
    expect(await generateCtId(AY_OID.toString(), 5, "MATH" as never)).toBe("CT-C5-MATH-1234");
  });

  test("bumps atomically — concurrent calls get distinct increasing numbers", async () => {
    mockSeqUpdate.mockResolvedValueOnce({ seq: 1 }).mockResolvedValueOnce({ seq: 2 });
    const [a, b] = await Promise.all([
      generateCtId(AY_OID.toString(), 1, "ENG" as never),
      generateCtId(AY_OID.toString(), 1, "ENG" as never),
    ]);
    expect(new Set([a, b]).size).toBe(2);
    // findOneAndUpdate used $inc + upsert (the atomic mint, D-#34)
    expect(mockSeqUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ classLevel: 1, subject: "ENG" }),
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
  });

  test("suggestTestNumber = top+1 (cancelled excluded), default 1 when none", async () => {
    mockCtFindOne.mockReturnValueOnce(leanChain({ testNumber: 4 }));
    expect(await suggestTestNumber(AY_OID.toString(), 3, "MATH" as never)).toBe(5);
    mockCtFindOne.mockReturnValueOnce(leanChain(null));
    expect(await suggestTestNumber(AY_OID.toString(), 3, "MATH" as never)).toBe(1);
  });

  test("defaultPassMark rounds 40% of total", () => {
    expect(defaultPassMark(20)).toBe(8);
    expect(defaultPassMark(25)).toBe(10);
    expect(defaultPassMark(15)).toBe(6); // 6.0
    expect(defaultPassMark(13)).toBe(5); // 5.2 → 5
  });
});

// ===========================================================================
// createRequest (J1)
// ===========================================================================

describe("createRequest", () => {
  const baseInput = {
    sectionId: SECTION_OID.toString(),
    subject: "MATH",
    examDate: "2026-07-10",
    totalMarks: 20,
    source: "POOL_SET",
    setId: oid().toString(),
    actorId: TEACHER_ID,
  };

  test("POOL_SET: derives year/level from section, mints CT id, REQUESTED + audit, default passMark", async () => {
    const res = await createRequest(baseInput);
    expect(res.status).toBe("REQUESTED");
    expect(res.ctId).toBe("CT-C3-MATH-0001");
    expect(res.classLevel).toBe(3);
    expect(res.academicYearId).toBe(AY_OID.toString());
    expect(res.source).toBe("POOL_SET");
    expect(res.setId).toBe(baseInput.setId);
    expect(res.questionFileId).toBeNull();
    expect(res.passMark).toBe(8); // round(0.4 × 20)
    expect(res.testNumber).toBe(1); // auto-suggested (none yet)
    expect(res.deadlineDays).toBe(2);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "CLASS_TEST_REQUESTED", targetKind: "ClassTest" }),
    );
  });

  // --- D-#366: Principal/Office must not silently self-own an exam ---------------
  test("D-#366: a roster:manage creator with no teacher pick AND no routine teacher is refused", async () => {
    // Default RoutineSlot mock names nobody → resolveSubjectTeacher returns null.
    await expect(
      createRequest({ ...baseInput, actorId: PRINCIPAL_ID, actorCanManage: true }),
    ).rejects.toThrow(/pick the subject teacher/i);
  });

  test("D-#366: a roster:manage creator with an EXPLICIT teacher pick is attributed to that teacher", async () => {
    const res = await createRequest({
      ...baseInput,
      actorId: PRINCIPAL_ID,
      actorCanManage: true,
      teacherId: TEACHER_ID,
    });
    expect(res.teacherId).toBe(TEACHER_ID);
    expect(res.requestedBy).toBe(PRINCIPAL_ID);
  });

  test("D-#366: a plain teacher (no roster:manage) still falls back to themselves", async () => {
    const res = await createRequest({ ...baseInput, actorId: TEACHER_ID });
    expect(res.teacherId).toBe(TEACHER_ID);
  });

  // A class test IS a print job (PQ-5), so the Office must learn HOW to print it from the
  // same queue row as any other job — the teacher's choice has to survive the hand-off.
  test("carries colour + sides onto the queue row", async () => {
    await createRequest({ ...baseInput, colour: "COLOR", sides: "DOUBLE" });
    expect(mockCreatePrintRequest).toHaveBeenCalledWith(
      expect.objectContaining({ colour: "COLOR", sides: "DOUBLE", purpose: "CLASS_TEST" }),
    );
  });

  // --- D-#303: teacher name in the title + copies onto the queue row ---------

  test("D-#303: the queue row's title names the requesting teacher; exam day rides as neededByKey", async () => {
    await createRequest(baseInput);
    expect(mockCreatePrintRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "CT-C3-MATH-0001 · MATH — Kawsar Hossain",
        neededByKey: "2026-07-10",
      }),
    );
  });

  test("D-#303: a vanished requester still files — the title just omits the name", async () => {
    mockUserFindById.mockResolvedValue(null);
    await createRequest(baseInput);
    expect(mockCreatePrintRequest).toHaveBeenCalledWith(
      expect.objectContaining({ title: "CT-C3-MATH-0001 · MATH" }),
    );
  });

  test("D-#303: FIXED copies pass through (default 1); invalid rejected", async () => {
    await createRequest({ ...baseInput, copies: 25 });
    expect(mockCreatePrintRequest).toHaveBeenCalledWith(
      expect.objectContaining({ copies: 25, copiesMode: "FIXED" }),
    );
    mockCreatePrintRequest.mockClear();
    await createRequest(baseInput);
    expect(mockCreatePrintRequest).toHaveBeenCalledWith(
      expect.objectContaining({ copies: 1, copiesMode: "FIXED" }),
    );
    await expect(createRequest({ ...baseInput, copies: 0 })).rejects.toThrow(/positive integer/);
    await expect(createRequest({ ...baseInput, copiesMode: "SOMETHING" })).rejects.toThrow(/Invalid copiesMode/);
  });

  test("D-#303: CLASS_PRESENT derives the class + exam-day use date server-side", async () => {
    await createRequest({ ...baseInput, copiesMode: "CLASS_PRESENT" });
    expect(mockCreatePrintRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        copiesMode: "CLASS_PRESENT",
        copiesClassId: CLASS_OID.toString(),
        copies: null,
        neededByKey: "2026-07-10",
      }),
    );
  });

  test("omitting colour/sides leaves the queue row on its schema defaults (pre-PQ-5 caller)", async () => {
    await createRequest(baseInput);
    expect(mockCreatePrintRequest).toHaveBeenCalledWith(
      expect.objectContaining({ colour: null, sides: null }),
    );
  });

  test("POOL_SET rejects a non-CT set", async () => {
    mockSetFindById.mockReturnValue(leanChain({ setType: "HW" }));
    await expect(createRequest(baseInput)).rejects.toThrow(/not a CT-kind/);
    expect(mockCtCreate).not.toHaveBeenCalled();
  });

  test("POOL_SET requires setId, rejects a stray questionFileId", async () => {
    await expect(createRequest({ ...baseInput, setId: undefined })).rejects.toThrow(/needs a setId/);
    await expect(
      createRequest({ ...baseInput, questionFileId: FILE_ID.toString() }),
    ).rejects.toThrow(/cannot also carry an uploaded paper/);
  });

  test("UPLOADED_PAPER: requires a classtest_question file owned by the requester", async () => {
    const res = await createRequest({
      ...baseInput,
      source: "UPLOADED_PAPER",
      setId: undefined,
      questionFileId: FILE_ID.toString(),
    });
    expect(res.source).toBe("UPLOADED_PAPER");
    expect(res.questionFileId).toBe(FILE_ID.toString());
    expect(res.setId).toBeNull();
  });

  test("UPLOADED_PAPER rejects a paper uploaded by someone else (§5.2 ownership)", async () => {
    mockStoredFindById.mockResolvedValue({ ...classtestFile, uploadedBy: oid() });
    await expect(
      createRequest({ ...baseInput, source: "UPLOADED_PAPER", setId: undefined, questionFileId: FILE_ID.toString() }),
    ).rejects.toThrow(/not uploaded by this teacher/);
  });

  test("UPLOADED_PAPER rejects a wrong-kind file", async () => {
    mockStoredFindById.mockResolvedValue({ ...classtestFile, kind: "hw_question" });
    await expect(
      createRequest({ ...baseInput, source: "UPLOADED_PAPER", setId: undefined, questionFileId: FILE_ID.toString() }),
    ).rejects.toThrow(/not a class-test question paper/);
  });

  test("rejects a passMark above totalMarks, and a non-positive totalMarks", async () => {
    await expect(createRequest({ ...baseInput, passMark: 25 })).rejects.toThrow(/between 0 and totalMarks/);
    await expect(createRequest({ ...baseInput, totalMarks: 0 })).rejects.toThrow(/positive integer/);
  });

  test("honours an explicit testNumber + deadlineDays override", async () => {
    const res = await createRequest({ ...baseInput, testNumber: 9, deadlineDays: 3, passMark: 12 });
    expect(res.testNumber).toBe(9);
    expect(res.deadlineDays).toBe(3);
    expect(res.passMark).toBe(12);
  });

  test("rejects an unknown subject / source", async () => {
    await expect(createRequest({ ...baseInput, subject: "QURAN" })).rejects.toThrow(/Unknown subject/);
    await expect(createRequest({ ...baseInput, source: "SCAN" })).rejects.toThrow(/Unknown source/);
  });

  // --- D-#339: register-without-print ("make the class test due") -----------

  test("D-#339 skipPrint: born PRINTED with printedBy/At = actor/now, NO print-queue row", async () => {
    const res = await createRequest({ ...baseInput, skipPrint: true });
    expect(res.status).toBe("PRINTED");
    expect(res.printedBy).toBe(TEACHER_ID);
    expect(res.printedAt).not.toBeNull();
    expect(res.ctId).toBe("CT-C3-MATH-0001");
    expect(mockCreatePrintRequest).not.toHaveBeenCalled();
    expect(mockCtUpdateOne).not.toHaveBeenCalled(); // no printRequestId back-link either
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "CLASS_TEST_PRINTED", meta: expect.objectContaining({ skipPrint: true }) }),
    );
  });

  test("D-#339 skipPrint still runs the shared validation (non-CT set rejected)", async () => {
    mockSetFindById.mockReturnValue(leanChain({ setType: "HW" }));
    await expect(createRequest({ ...baseInput, skipPrint: true })).rejects.toThrow(/not a CT-kind/);
    expect(mockCtCreate).not.toHaveBeenCalled();
  });

  // --- accountable subject teacher (owner ask: an admin registering on a
  // teacher's behalf must attribute the exam to that TEACHER, not to themselves).
  test("attributes the exam to the ROUTINE's subject teacher, not the actor", async () => {
    const routineTeacher = oid();
    mockSlotFind.mockReturnValue(
      leanChain([
        {
          groupId: SECTION_OID,
          subject: "MATH",
          dayOfWeek: "SUN",
          periodNumber: 2,
          teacherId: routineTeacher,
          effectiveFrom: new Date("2020-01-01"),
          effectiveTo: null,
        },
      ]),
    );
    const res = await createRequest(baseInput);
    expect(res.teacherId).toBe(routineTeacher.toString());
    expect(res.requestedBy).toBe(TEACHER_ID); // who ENTERED it is unchanged
  });

  test("an explicit teacherId (admin picking on-behalf) wins over the routine", async () => {
    const routineTeacher = oid();
    const picked = oid();
    mockSlotFind.mockReturnValue(
      leanChain([
        {
          groupId: SECTION_OID,
          subject: "MATH",
          dayOfWeek: "SUN",
          periodNumber: 1,
          teacherId: routineTeacher,
          effectiveFrom: new Date("2020-01-01"),
          effectiveTo: null,
        },
      ]),
    );
    const res = await createRequest({ ...baseInput, teacherId: picked.toString() });
    expect(res.teacherId).toBe(picked.toString());
  });

  test("falls back to the actor when the routine names no teacher for the cell", async () => {
    mockSlotFind.mockReturnValue(leanChain([]));
    const res = await createRequest(baseInput);
    expect(res.teacherId).toBe(TEACHER_ID);
  });
});

// ===========================================================================
// CT-11 — duplicate guard (D-#429)
// ===========================================================================

describe("createRequest duplicate guard (CT-11)", () => {
  const dupInput = {
    sectionId: SECTION_OID.toString(),
    subject: "BAN",
    examDate: "2026-07-29",
    totalMarks: 20,
    source: "POOL_SET",
    setId: oid().toString(),
    actorId: TEACHER_ID,
    testNumber: 1, // explicit, so suggestTestNumber is skipped and findOne is the guard
  };

  test("refuses a second live test with the same section + subject + test number", async () => {
    mockCtFindOne.mockReturnValue(
      leanChain({ ctId: "CT-C5-BAN-0002", examDate: new Date("2026-07-29"), status: "PRINTED" }),
    );
    await expect(createRequest(dupInput)).rejects.toThrow(/CT-C5-BAN-0002/);
    // Nothing is written when the guard trips.
    expect(mockCtCreate).not.toHaveBeenCalled();
    expect(mockCreatePrintRequest).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("the refusal names the existing test, its date and status so the teacher can act", async () => {
    mockCtFindOne.mockReturnValue(
      leanChain({ ctId: "CT-C2-BAN-0002", examDate: new Date("2026-07-14"), status: "PRINTED" }),
    );
    await expect(createRequest(dupInput)).rejects.toThrow(/2026-07-14/);
    await expect(createRequest(dupInput)).rejects.toThrow(/PRINTED/);
    await expect(createRequest(dupInput)).rejects.toThrow(/different Test #/);
  });

  test("keys on section + subject + testNumber and EXCLUDES cancelled rows", async () => {
    mockCtFindOne.mockReturnValue(leanChain(null));
    await createRequest(dupInput);
    expect(mockCtFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionId: SECTION_OID,
        subject: "BAN",
        testNumber: 1,
        status: { $ne: "CANCELLED" },
      }),
    );
    // The key deliberately omits examDate — the same Test # twice is a mistake whatever
    // the dates, and keying on the date let both live incidents through.
    const q = mockCtFindOne.mock.calls[0][0] as Record<string, unknown>;
    expect(q.examDate).toBeUndefined();
  });

  test("a withdrawn (CANCELLED) request does not block its replacement", async () => {
    // The query excludes CANCELLED, so the DB returns nothing and creation proceeds.
    mockCtFindOne.mockReturnValue(leanChain(null));
    const res = await createRequest(dupInput);
    expect(res.status).toBe("REQUESTED");
    expect(mockCtCreate).toHaveBeenCalled();
  });

  test("a different test number for the same class + subject is allowed", async () => {
    mockCtFindOne.mockReturnValue(leanChain(null));
    const res = await createRequest({ ...dupInput, testNumber: 2 });
    expect(res.testNumber).toBe(2);
  });
});

// ===========================================================================
// markPrinted / cancelRequest (J2)
// ===========================================================================

describe("markPrinted / cancelRequest", () => {
  const makeDoc = (status: string) => ({
    _id: oid(),
    ctId: "CT-C3-MATH-0001",
    academicYearId: AY_OID,
    classLevel: 3,
    classId: CLASS_OID,
    sectionId: SECTION_OID,
    subject: "MATH",
    testNumber: 1,
    examDate: new Date("2026-07-10"),
    totalMarks: 20,
    passMark: 8,
    source: "POOL_SET",
    status,
    deadlineDays: 2,
    requestedBy: new mongoose.Types.ObjectId(TEACHER_ID),
    requestedAt: new Date(),
    save: jest.fn().mockResolvedValue(undefined),
  });

  test("markPrinted: REQUESTED → PRINTED, stamps printedAt/By + audit", async () => {
    const doc = makeDoc("REQUESTED");
    mockCtFindById.mockReturnValue(findByIdResult(doc));
    const officeId = oid().toString();
    const res = await markPrinted(doc._id.toString(), officeId);
    expect(res.status).toBe("PRINTED");
    expect(res.printedBy).toBe(officeId);
    expect(res.printedAt).not.toBeNull();
    expect(doc.save).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "CLASS_TEST_PRINTED" }),
    );
    // PQ-5: this legacy entry point must not let the unified queue row drift.
    expect(mockPrUpdateOne).toHaveBeenCalledWith(
      { classTestId: doc._id, status: "REQUESTED" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "PRINTED" }) }),
    );
  });

  test("markPrinted rejects an already-PRINTED record", async () => {
    mockCtFindById.mockReturnValue(findByIdResult(makeDoc("PRINTED")));
    await expect(markPrinted(oid().toString(), oid().toString())).rejects.toThrow(/Only a REQUESTED/);
  });

  test("markPrinted on a missing record throws", async () => {
    mockCtFindById.mockReturnValue(findByIdResult(null));
    await expect(markPrinted(oid().toString(), oid().toString())).rejects.toThrow(/not found/);
  });

  test("cancelRequest: REQUESTED → CANCELLED + audit", async () => {
    const doc = makeDoc("REQUESTED");
    mockCtFindById.mockReturnValue(findByIdResult(doc));
    const res = await cancelRequest(doc._id.toString(), oid().toString());
    expect(res.status).toBe("CANCELLED");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "CLASS_TEST_CANCELLED" }),
    );
  });

  test("cancelRequest refuses a PRINTED official exam", async () => {
    mockCtFindById.mockReturnValue(findByIdResult(makeDoc("PRINTED")));
    await expect(cancelRequest(oid().toString(), oid().toString())).rejects.toThrow(/Only a REQUESTED/);
  });
});

// ---------------------------------------------------------------------------
// retire / restore — the Principal's own route out of a PRINTED exam.
// Built after three prod scripts did this by hand in two days (owner ask 2026-08-03);
// cancelRequest above only ever accepted REQUESTED, so PRINTED had no exit at all.
// ---------------------------------------------------------------------------
describe("retireClassTest / restoreClassTest", () => {
  const makeDoc = (status: string) => ({
    _id: oid(),
    ctId: "CT-C4-ENG-0001",
    academicYearId: AY_OID,
    classLevel: 4,
    classId: CLASS_OID,
    sectionId: SECTION_OID,
    subject: "ENG",
    testNumber: 1,
    examDate: new Date("2026-07-23"),
    totalMarks: 39,
    passMark: 13,
    source: "UPLOADED_PAPER",
    status,
    deadlineDays: 2,
    requestedBy: new mongoose.Types.ObjectId(TEACHER_ID),
    requestedAt: new Date(),
    save: jest.fn().mockResolvedValue(undefined),
  });

  test("retire: PRINTED → CANCELLED, stores the reason + audit", async () => {
    const doc = makeDoc("PRINTED");
    mockCtFindById.mockReturnValue(findByIdResult(doc));
    mockCtResultCount.mockResolvedValue(0);
    const res = await retireClassTest(doc._id.toString(), "  answer papers lost  ", oid().toString());
    expect(res.status).toBe("CANCELLED");
    expect(res.notes).toBe("answer papers lost"); // trimmed
    expect(doc.save).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "CLASS_TEST_CANCELLED",
        meta: expect.objectContaining({ reason: "answer papers lost", priorStatus: "PRINTED" }),
      }),
    );
  });

  test("retire refuses once ANY result exists — hiding marked work is not a retirement", async () => {
    const doc = makeDoc("PRINTED");
    mockCtFindById.mockReturnValue(findByIdResult(doc));
    mockCtResultCount.mockResolvedValue(3);
    await expect(retireClassTest(doc._id.toString(), "wrong paper", oid().toString())).rejects.toThrow(
      /3 result\(s\) entered/,
    );
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("retire requires a reason", async () => {
    const doc = makeDoc("PRINTED");
    mockCtFindById.mockReturnValue(findByIdResult(doc));
    mockCtResultCount.mockResolvedValue(0);
    await expect(retireClassTest(doc._id.toString(), "   ", oid().toString())).rejects.toThrow(/reason is required/);
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("retire refuses anything that is not PRINTED", async () => {
    mockCtFindById.mockReturnValue(findByIdResult(makeDoc("REQUESTED")));
    await expect(retireClassTest(oid().toString(), "x", oid().toString())).rejects.toThrow(/Only a PRINTED/);
  });

  test("restore: CANCELLED → PRINTED + audit, so a mistaken retire is not a dead end", async () => {
    const doc = makeDoc("CANCELLED");
    mockCtFindById.mockReturnValue(findByIdResult(doc));
    const res = await restoreClassTest(doc._id.toString(), oid().toString());
    expect(res.status).toBe("PRINTED");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "CLASS_TEST_RESTORED" }),
    );
  });

  test("restore refuses a live exam", async () => {
    mockCtFindById.mockReturnValue(findByIdResult(makeDoc("PRINTED")));
    await expect(restoreClassTest(oid().toString(), oid().toString())).rejects.toThrow(/Only a retired/);
  });
});

// ===========================================================================
// POST /files/classtest — teacher uploads their own paper (§5.2)
// ===========================================================================

describe("POST /files/classtest", () => {
  const upload = (tok: string | null) => {
    const req = request(app).post("/files/classtest");
    if (tok) req.set("Authorization", `Bearer ${tok}`);
    return req.attach("file", Buffer.from("pdf-bytes"), {
      filename: "paper.pdf",
      contentType: "application/pdf",
    });
  };

  test("unauthenticated → 403", async () => {
    expect((await upload(null)).status).toBe(403);
  });

  test("GUARDIAN → 403 (no tracker:write)", async () => {
    const res = await upload(guardianTok);
    expect(res.status).toBe(403);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test("OFFICE → 200 (D-#342: the office uploads question-request papers here too)", async () => {
    expect((await upload(officeTok)).status).toBe(200);
  });

  test("teacher upload OK — fileId returned, NEVER driveFileId", async () => {
    const res = await upload(teacherTok);
    expect(res.status).toBe(200);
    expect(res.body.fileId).toBe(FILE_ID.toString());
    expect(res.body.kind).toBe("classtest_question");
    expect("driveFileId" in res.body).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain("drive-internal-ct");
    expect(mockStoredCreate).toHaveBeenCalledTimes(1);
  });

  test("wrong mime → 422 Bangla (D-#342 envelope: jpeg/png/pdf/doc/docx), Drive never called", async () => {
    const res = await request(app)
      .post("/files/classtest")
      .set("Authorization", `Bearer ${teacherTok}`)
      .attach("file", Buffer.from("gif"), { filename: "x.gif", contentType: "image/gif" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("শুধু JPEG, PNG, PDF বা Word (DOC/DOCX) ফাইল সংযুক্ত করা যাবে");
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test("Drive down → 503 Bangla and NOTHING persisted (GP-J8)", async () => {
    const { DriveUnavailableError } = jest.requireActual("../modules/platform/services/DriveStore");
    mockUpload.mockRejectedValue(new DriveUnavailableError("down"));
    const res = await upload(teacherTok);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe(FILE_ERRORS_BN.driveDown);
    expect(mockStoredCreate).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// GET /files/:id — class-test paper read gate (Office OR uploading teacher)
// ===========================================================================

describe("GET /files/:id (classtest_question gate)", () => {
  const get = (tok: string | null) => {
    const req = request(app).get(`/files/${FILE_ID.toString()}`);
    if (tok) req.set("Authorization", `Bearer ${tok}`);
    return req;
  };

  test("unauthenticated → 403, Drive never called", async () => {
    const res = await get(null);
    expect(res.status).toBe(403);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  test("the uploading teacher → 200, streamed via the server", async () => {
    const res = await get(teacherTok);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(mockDownload).toHaveBeenCalledWith("drive-internal-ct");
  });

  test("a DIFFERENT teacher → 403 (not the requesting teacher)", async () => {
    const res = await get(otherTeacherTok);
    expect(res.status).toBe(403);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  test("OFFICE (roster:manage, the print operator) → 200", async () => {
    expect((await get(officeTok)).status).toBe(200);
  });

  test("PRINCIPAL (roster:manage) → 200", async () => {
    expect((await get(principalTok)).status).toBe(200);
  });

  test("GUARDIAN → 403", async () => {
    const res = await get(guardianTok);
    expect(res.status).toBe(403);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  test("unknown file id → 404", async () => {
    mockStoredFindById.mockResolvedValue(null);
    expect((await get(officeTok)).status).toBe(404);
  });
});
