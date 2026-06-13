/**
 * GP-A homework-file tests (D-#70, prd-guardian-portal §5).
 *
 * Upload    — mime/size rejection (Bangla); staff-only (guardians NEVER upload);
 *             Drive failure → Bangla 503 + NOTHING persisted (GP-J8); the
 *             response carries fileId but NEVER driveFileId.
 * Download  — default-deny (GP-J7): unauthenticated DENY; guardian reads own
 *             child's answer PASS / unlinked DENY; question file for an
 *             enrolled child PASS / other class DENY; unscoped teacher DENY;
 *             Drive failure → Bangla 503.
 * Attach    — kind mismatch rejected; replace allowed; HW_FILE_ATTACHED audited.
 * Source    — no resolver/route response exposes driveFileId.
 *
 * Drive is MOCKED (no live Google in CI) — live verification needs the real
 * credential (§5 setup prerequisite). Routes tested via supertest.
 */
import * as fs from "fs";
import * as path from "path";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

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
  STORED_FILE_KINDS: ["hw_question", "hw_answer", "chat_image", "chat_pdf", "chat_video", "chat_audio"],
  CHAT_STORED_FILE_KINDS: ["chat_image", "chat_pdf", "chat_video", "chat_audio"],
  StoredFile: {
    create: (a: unknown) => mockStoredCreate(a),
    findById: (id: unknown) => ({ lean: () => mockStoredFindById(id) }),
  },
}));

const mockItemFindById = jest.fn();
const mockItemFindOne = jest.fn();
const mockItemUpdateOne = jest.fn();
jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: {
    findById: (id: unknown) => ({ lean: () => mockItemFindById(id) }),
    findOne: (q: unknown) => ({ lean: () => mockItemFindOne(q) }),
    updateOne: (f: unknown, u: unknown) => mockItemUpdateOne(f, u),
  },
}));

const mockRecFindById = jest.fn();
const mockRecFindOne = jest.fn();
const mockRecUpdateOne = jest.fn();
jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: {
    findById: (id: unknown) => ({ lean: () => mockRecFindById(id) }),
    findOne: (q: unknown) => ({ lean: () => mockRecFindOne(q) }),
    updateOne: (f: unknown, u: unknown) => mockRecUpdateOne(f, u),
  },
}));

const mockGuardianFindById = jest.fn();
jest.mock("../modules/foundation/models/Guardian", () => ({
  Guardian: { findById: (id: unknown) => ({ lean: () => mockGuardianFindById(id) }) },
}));

const mockLinkFind = jest.fn();
const mockLinkFindOne = jest.fn();
jest.mock("../modules/foundation/models/GuardianLink", () => ({
  GuardianLink: {
    find: (q: unknown) => ({ lean: () => mockLinkFind(q) }),
    findOne: (q: unknown) => ({ lean: () => mockLinkFindOne(q) }),
  },
}));

const mockStudentFindOne = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { findOne: (q: unknown) => ({ lean: () => mockStudentFindOne(q) }) },
}));

// Teacher scope union — empty by default (the DENY case); pure helpers stay real.
const mockComposeScope = jest.fn();
jest.mock("../modules/foundation/services/ScopeGrantService", () => {
  const actual = jest.requireActual("../modules/foundation/services/ScopeGrantService");
  return {
    ...actual,
    composeTeacherScope: (uid: unknown, now: unknown) => mockComposeScope(uid, now),
  };
});

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// Import AFTER mocks
import { filesRouter, validateUpload, FILE_ERRORS_BN, MAX_FILE_BYTES } from "../routes/files";
import {
  attachQuestionFile,
  attachAnswerFile,
} from "../modules/trackers/services/HomeworkFileService";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const app = express();
app.use("/files", filesRouter);

const SECRET = process.env.JWT_SECRET ?? "dev-secret";
const token = (userId: string, role: string) => jwt.sign({ userId, role }, SECRET);

const TEACHER_ID = oid().toString();
const PRINCIPAL_ID = oid().toString();
const GUARDIAN_ID = oid();
const STUDENT_ID = oid();
const SECTION_ID = oid();
const CLASS_ID = oid();
const FILE_ID = oid();
const ITEM_ID = oid();
const RECORD_ID = oid();

const teacherTok = token(TEACHER_ID, "TEACHER");
const principalTok = token(PRINCIPAL_ID, "PRINCIPAL");
const guardianTok = token(GUARDIAN_ID.toString(), "GUARDIAN");

const answerFile = {
  _id: FILE_ID,
  kind: "hw_answer",
  mime: "image/jpeg",
  sizeBytes: 1234,
  originalName: "answer.jpg",
  driveFileId: "drive-internal-xyz",
};
const questionFile = { ...answerFile, kind: "hw_question", originalName: "question.pdf", mime: "application/pdf" };

const recordDoc = {
  _id: RECORD_ID,
  hwId: "HW-C2-BAN-0001",
  studentId: STUDENT_ID,
  sectionId: SECTION_ID,
  classId: CLASS_ID,
  answerFileId: FILE_ID,
};
const itemDoc = {
  _id: ITEM_ID,
  hwId: "HW-C2-BAN-0001",
  sectionId: SECTION_ID,
  classId: CLASS_ID,
  questionFileId: FILE_ID,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockComposeScope.mockResolvedValue({ scopes: [], expiredProxyGrantIds: [] });
  mockGuardianFindById.mockResolvedValue({ _id: GUARDIAN_ID, active: true });
  mockLinkFindOne.mockResolvedValue({ guardianId: GUARDIAN_ID, studentId: STUDENT_ID });
  mockLinkFind.mockResolvedValue([{ guardianId: GUARDIAN_ID, studentId: STUDENT_ID }]);
  mockStudentFindOne.mockResolvedValue({ _id: STUDENT_ID, classId: CLASS_ID, active: true });
  mockUpload.mockResolvedValue("drive-internal-xyz");
  mockDownload.mockResolvedValue(Buffer.from("file-bytes"));
  mockStoredCreate.mockImplementation(async (a: Record<string, unknown>) => ({
    _id: FILE_ID,
    ...a,
  }));
  mockStoredFindById.mockResolvedValue(answerFile);
  mockItemFindById.mockResolvedValue(itemDoc);
  mockItemFindOne.mockResolvedValue(itemDoc);
  mockRecFindById.mockResolvedValue(recordDoc);
  mockRecFindOne.mockResolvedValue(recordDoc);
  mockItemUpdateOne.mockResolvedValue({ acknowledged: true });
  mockRecUpdateOne.mockResolvedValue({ acknowledged: true });
});

// ===========================================================================
// validateUpload — mime/size gate (pure)
// ===========================================================================

describe("validateUpload", () => {
  test("accepts jpeg/png/pdf within 5 MB", () => {
    expect(validateUpload("image/jpeg", 1024)).toBeNull();
    expect(validateUpload("image/png", MAX_FILE_BYTES)).toBeNull();
    expect(validateUpload("application/pdf", 5000)).toBeNull();
  });
  test("rejects other mimes (Bangla)", () => {
    expect(validateUpload("image/gif", 1024)).toBe(FILE_ERRORS_BN.badMime);
    expect(validateUpload("application/zip", 1024)).toBe(FILE_ERRORS_BN.badMime);
  });
  test("rejects > 5 MB (Bangla)", () => {
    expect(validateUpload("image/jpeg", MAX_FILE_BYTES + 1)).toBe(FILE_ERRORS_BN.tooLarge);
  });
});

// ===========================================================================
// POST /files/hw — staff upload
// ===========================================================================

describe("POST /files/hw", () => {
  const attach = (tok: string | null, kind = "question") => {
    const req = request(app).post(`/files/hw?kind=${kind}`);
    if (tok) req.set("Authorization", `Bearer ${tok}`);
    return req.attach("file", Buffer.from("pdf-bytes"), {
      filename: "q.pdf",
      contentType: "application/pdf",
    });
  };

  test("unauthenticated → 403", async () => {
    const res = await attach(null);
    expect(res.status).toBe(403);
  });

  test("GUARDIAN → 403 (guardians never upload, D-#70)", async () => {
    const res = await attach(guardianTok);
    expect(res.status).toBe(403);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test("OFFICE → 403 (no tracker:write)", async () => {
    const res = await attach(token(oid().toString(), "OFFICE"));
    expect(res.status).toBe(403);
  });

  test("teacher upload OK — returns fileId, NEVER driveFileId (GP-J7)", async () => {
    const res = await attach(teacherTok);
    expect(res.status).toBe(200);
    expect(res.body.fileId).toBe(FILE_ID.toString());
    expect(res.body.kind).toBe("hw_question");
    expect("driveFileId" in res.body).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain("drive-internal-xyz");
    expect(mockStoredCreate).toHaveBeenCalledTimes(1);
  });

  test("wrong mime → 422 Bangla, Drive never called", async () => {
    const res = await request(app)
      .post("/files/hw?kind=question")
      .set("Authorization", `Bearer ${teacherTok}`)
      .attach("file", Buffer.from("gif"), { filename: "x.gif", contentType: "image/gif" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe(FILE_ERRORS_BN.badMime);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test("missing/invalid kind → 400", async () => {
    const res = await request(app)
      .post("/files/hw")
      .set("Authorization", `Bearer ${teacherTok}`)
      .attach("file", Buffer.from("x"), { filename: "x.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
  });

  test("Drive down → 503 Bangla and NOTHING persisted (GP-J8)", async () => {
    const { DriveUnavailableError } = jest.requireActual(
      "../modules/platform/services/DriveStore",
    );
    mockUpload.mockRejectedValue(new DriveUnavailableError("down"));
    const res = await attach(teacherTok);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe(FILE_ERRORS_BN.driveDown);
    expect(mockStoredCreate).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// GET /files/:id — default-deny download (GP-J7)
// ===========================================================================

describe("GET /files/:id", () => {
  const get = (tok: string | null) => {
    const req = request(app).get(`/files/${FILE_ID.toString()}`);
    if (tok) req.set("Authorization", `Bearer ${tok}`);
    return req;
  };

  test("unauthenticated → 403 (never public, ADR-005)", async () => {
    const res = await get(null);
    expect(res.status).toBe(403);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  test("guardian downloads own child's ANSWER file → 200, streamed via the server", async () => {
    const res = await get(guardianTok);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
    expect(res.body.toString()).toBe("file-bytes");
    expect(mockDownload).toHaveBeenCalledWith("drive-internal-xyz");
  });

  test("guardian NOT linked to the record's student → 403 (GP-J7)", async () => {
    mockLinkFindOne.mockResolvedValue(null);
    const res = await get(guardianTok);
    expect(res.status).toBe(403);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  test("guardian downloads QUESTION file with an enrolled child → 200", async () => {
    mockStoredFindById.mockResolvedValue(questionFile);
    const res = await get(guardianTok);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
  });

  test("guardian QUESTION file, child in ANOTHER class → 403", async () => {
    mockStoredFindById.mockResolvedValue(questionFile);
    mockStudentFindOne.mockResolvedValue(null); // no linked child in the item's class
    const res = await get(guardianTok);
    expect(res.status).toBe(403);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  test("teacher WITHOUT read scope on the section → 403", async () => {
    const res = await get(teacherTok); // composeTeacherScope → empty scopes
    expect(res.status).toBe(403);
  });

  test("PRINCIPAL → 200 (unscoped read)", async () => {
    const res = await get(principalTok);
    expect(res.status).toBe(200);
  });

  test("unknown file id → 404", async () => {
    mockStoredFindById.mockResolvedValue(null);
    const res = await get(guardianTok);
    expect(res.status).toBe(404);
  });

  test("Drive down on read → 503 Bangla, screen stays usable (GP-J8)", async () => {
    const { DriveUnavailableError } = jest.requireActual(
      "../modules/platform/services/DriveStore",
    );
    mockDownload.mockRejectedValue(new DriveUnavailableError("down"));
    const res = await get(guardianTok);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("এই মুহূর্তে ফাইলটি খোলা যাচ্ছে না");
  });
});

// ===========================================================================
// Attach service — kind gate + audit (resolver enforces write-scope)
// ===========================================================================

describe("attachQuestionFile / attachAnswerFile", () => {
  test("attachQuestionFile sets the ref and audits HW_FILE_ATTACHED", async () => {
    mockStoredFindById.mockResolvedValue(questionFile);
    const res = await attachQuestionFile(ITEM_ID.toString(), FILE_ID.toString(), TEACHER_ID);
    expect(res).toEqual({ id: ITEM_ID.toString(), hwId: "HW-C2-BAN-0001", fileId: FILE_ID.toString() });
    expect(mockItemUpdateOne).toHaveBeenCalledWith(
      { _id: ITEM_ID },
      { $set: { questionFileId: expect.any(mongoose.Types.ObjectId) } },
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "HW_FILE_ATTACHED", targetKind: "HomeworkItem" }),
    );
  });

  test("attachQuestionFile REJECTS an hw_answer file (kind mismatch)", async () => {
    mockStoredFindById.mockResolvedValue(answerFile);
    await expect(
      attachQuestionFile(ITEM_ID.toString(), FILE_ID.toString(), TEACHER_ID),
    ).rejects.toThrow(/kind mismatch/);
    expect(mockItemUpdateOne).not.toHaveBeenCalled();
  });

  test("attachAnswerFile sets the ref on the record and audits", async () => {
    mockStoredFindById.mockResolvedValue(answerFile);
    const res = await attachAnswerFile(RECORD_ID.toString(), FILE_ID.toString(), TEACHER_ID);
    expect(res.hwId).toBe("HW-C2-BAN-0001");
    expect(mockRecUpdateOne).toHaveBeenCalledTimes(1);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "HW_FILE_ATTACHED", targetKind: "HomeworkStudentRecord" }),
    );
  });

  test("attachAnswerFile REJECTS an hw_question file", async () => {
    mockStoredFindById.mockResolvedValue(questionFile);
    await expect(
      attachAnswerFile(RECORD_ID.toString(), FILE_ID.toString(), TEACHER_ID),
    ).rejects.toThrow(/kind mismatch/);
  });
});

// ===========================================================================
// Source guard — driveFileId never crosses to a client (GP-J7)
// ===========================================================================

describe("driveFileId never exposed (source guard)", () => {
  test("no GraphQL resolver file references driveFileId", () => {
    const modulesDir = path.resolve(__dirname, "../modules");
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(full));
        else if (e.name.endsWith(".ts") && full.includes("resolvers")) out.push(full);
      }
      return out;
    };
    for (const f of walk(modulesDir)) {
      expect(fs.readFileSync(f, "utf8")).not.toMatch(/driveFileId/);
    }
  });

  test("the upload response shape carries no driveFileId key (route source)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../routes/files.ts"), "utf8");
    // Every res.json(...) literal in the route must not serialize driveFileId.
    const jsonBlocks = src.match(/res\.json\(\{[\s\S]*?\}\)/g) ?? [];
    expect(jsonBlocks.length).toBeGreaterThan(0);
    for (const block of jsonBlocks) {
      expect(block).not.toMatch(/driveFileId\s*:/);
    }
  });
});
