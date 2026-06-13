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
jest.mock("../modules/trackers/models/ClassTest", () => ({
  ClassTest: {
    create: (a: unknown) => mockCtCreate(a),
    findById: (id: unknown) => mockCtFindById(id),
    findOne: (q: unknown) => mockCtFindOne(q),
    find: (q: unknown) => mockCtFind(q),
  },
}));

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
  STORED_FILE_KINDS: ["hw_question", "hw_answer", "chat_image", "chat_pdf", "chat_video", "chat_audio", "classtest_question"],
  CHAT_STORED_FILE_KINDS: ["chat_image", "chat_pdf", "chat_video", "chat_audio"],
  StoredFile: {
    create: (a: unknown) => mockStoredCreate(a),
    findById: (id: unknown) => ({ lean: () => mockStoredFindById(id) }),
  },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// Import AFTER mocks
import {
  generateCtId,
  suggestTestNumber,
  defaultPassMark,
  createRequest,
  markPrinted,
  cancelRequest,
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
  jest.clearAllMocks();
  mockSeqUpdate.mockResolvedValue({ seq: 1 });
  mockSectionFindById.mockReturnValue(leanChain({ classId: CLASS_OID }));
  mockClassFindById.mockReturnValue(leanChain({ level: 3, academicYearId: AY_OID }));
  mockSetFindById.mockReturnValue(leanChain({ setType: "CT" }));
  mockCtFindOne.mockReturnValue(leanChain(null)); // suggestTestNumber: none yet → 1
  mockCtCreate.mockImplementation(async (a: Record<string, unknown>) => ({ _id: oid(), ...a }));
  mockUpload.mockResolvedValue("drive-internal-ct");
  mockDownload.mockResolvedValue(Buffer.from("paper-bytes"));
  mockStoredCreate.mockImplementation(async (a: Record<string, unknown>) => ({ _id: FILE_ID, ...a }));
  mockStoredFindById.mockResolvedValue(classtestFile);
  mockWriteAudit.mockResolvedValue(undefined);
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

  test("OFFICE → 403 (Office prints, doesn't file requests — no tracker:write)", async () => {
    expect((await upload(officeTok)).status).toBe(403);
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

  test("wrong mime → 422 Bangla, Drive never called", async () => {
    const res = await request(app)
      .post("/files/classtest")
      .set("Authorization", `Bearer ${teacherTok}`)
      .attach("file", Buffer.from("gif"), { filename: "x.gif", contentType: "image/gif" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe(FILE_ERRORS_BN.badMime);
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
