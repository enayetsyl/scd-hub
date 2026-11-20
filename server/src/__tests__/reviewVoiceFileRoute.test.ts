/**
 * VN-1 route-level test: GET /files/:id on a `review_voice_note` file (D-#1658).
 *
 *   reviewer draft  -> 200 for the reviewer only
 *   sent clip       -> plan author 200, plan manager 200, question-only manager 403, stranger 403
 * Drive and the Mongoose models are mocked; routes run through supertest with a real JWT.
 */
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const mockDownload = jest.fn();
jest.mock("../modules/platform/services/DriveStore", () => {
  const actual = jest.requireActual("../modules/platform/services/DriveStore");
  return {
    DriveUnavailableError: actual.DriveUnavailableError,
    uploadToDrive: jest.fn(),
    downloadFromDrive: (id: unknown) => mockDownload(id),
  };
});

const mockStoredFindById = jest.fn();
jest.mock("../modules/platform/models/StoredFile", () => ({
  STORED_FILE_KINDS: ["review_voice_note"],
  CHAT_STORED_FILE_KINDS: ["chat_image", "chat_pdf", "chat_video", "chat_audio"],
  COMMENT_STORED_FILE_KINDS: ["comment_image", "comment_pdf", "comment_video", "comment_audio"],
  StoredFile: {
    create: jest.fn(),
    findById: (id: unknown) => ({ lean: () => mockStoredFindById(id) }),
  },
}));

const mockNoteFindOne = jest.fn();
jest.mock("../modules/content/models/ReviewVoiceNote", () => ({
  ReviewVoiceNote: { findOne: (f: unknown) => ({ lean: () => mockNoteFindOne(f) }) },
}));

const mockArtifactFindById = jest.fn();
jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: { findById: (id: unknown) => ({ select: () => ({ lean: () => mockArtifactFindById(id) }) }) },
}));
jest.mock("../modules/content/models/ReviewAssignment", () => ({ ReviewAssignment: {} }));
jest.mock("../modules/foundation/models/User", () => ({ User: { find: jest.fn() } }));
jest.mock("../modules/platform/services/AuditService", () => ({ writeAudit: jest.fn() }));
jest.mock("../modules/notifications/services/emitters", () => ({ emitReviewAssigned: jest.fn() }));

// One person who holds ONLY question_review:assign (no plan_review:assign): everyone else keeps the
// real permission table. Everything that calls callerHasPermission goes through this one module.
const QUESTION_MGR = oid().toString();
// And one who holds ONLY plan_review:assign (VN-2: must not hear a question clip).
const PLAN_MGR = oid().toString();
jest.mock("@scd/shared", () => {
  const actual = jest.requireActual("@scd/shared");
  return {
    ...actual,
    callerHasPermission: (profile: { userId?: string }, perm: string, ...rest: unknown[]) =>
      profile.userId === QUESTION_MGR
        ? perm === "question_review:assign"
        : profile.userId === PLAN_MGR
        ? perm === "plan_review:assign"
        : (actual.callerHasPermission as (...a: unknown[]) => boolean)(profile, perm, ...rest),
  };
});

import { filesRouter } from "../routes/files";

const app = express();
app.use("/files", filesRouter);

const SECRET = process.env.JWT_SECRET ?? "dev-secret";
const token = (userId: string, role: string) => jwt.sign({ userId, role }, SECRET);

const REVIEWER = oid();
const AUTHOR = oid();
const MANAGER = oid();
const STRANGER = oid();
const ARTIFACT = oid();
const FILE = oid();

function note(submitted: boolean, docType = "chapter_plan") {
  return {
    _id: oid(),
    assignmentId: oid(),
    artifactId: ARTIFACT,
    reviewerId: REVIEWER,
    docType,
    fileId: FILE,
    mime: "audio/wav",
    seconds: 5,
    submitted,
  };
}

const get = (userId: string, role: string) =>
  request(app).get(`/files/${FILE.toString()}`).set("Authorization", `Bearer ${token(userId, role)}`);

beforeEach(() => {
  jest.clearAllMocks();
  mockStoredFindById.mockResolvedValue({
    _id: FILE,
    kind: "review_voice_note",
    mime: "audio/wav",
    sizeBytes: 10,
    originalName: "review-voice.wav",
    driveFileId: "drive-internal",
  });
  mockDownload.mockResolvedValue(Buffer.from("RIFFxxxxWAVE"));
  mockArtifactFindById.mockResolvedValue({ importedBy: AUTHOR });
});

describe("GET /files/:id for a review voice note", () => {
  test("a DRAFT: 200 for the reviewer only", async () => {
    mockNoteFindOne.mockResolvedValue(note(false));
    const ok = await get(REVIEWER.toString(), "TEACHER");
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toMatch(/audio\/wav/);
    expect((await get(AUTHOR.toString(), "OFFICE")).status).toBe(403);
    expect((await get(MANAGER.toString(), "PRINCIPAL")).status).toBe(403);
    expect((await get(STRANGER.toString(), "TEACHER")).status).toBe(403);
  });

  test("a SENT clip: the plan author and a plan manager read it", async () => {
    mockNoteFindOne.mockResolvedValue(note(true));
    expect((await get(AUTHOR.toString(), "TEACHER")).status).toBe(200);
    expect((await get(MANAGER.toString(), "PRINCIPAL")).status).toBe(200);
    expect((await get(REVIEWER.toString(), "TEACHER")).status).toBe(200);
  });

  test("a SENT plan clip: a question-only manager and a stranger are refused", async () => {
    mockNoteFindOne.mockResolvedValue(note(true));
    expect((await get(QUESTION_MGR, "OFFICE")).status).toBe(403);
    expect((await get(STRANGER.toString(), "TEACHER")).status).toBe(403);
  });

  test("a SENT question clip (VN-2): reviewer, importer and a question manager read it; a plan-only manager and a stranger do not", async () => {
    mockNoteFindOne.mockResolvedValue(note(true, "question"));
    expect((await get(REVIEWER.toString(), "TEACHER")).status).toBe(200);
    expect((await get(AUTHOR.toString(), "TEACHER")).status).toBe(200);
    expect((await get(QUESTION_MGR, "OFFICE")).status).toBe(200);
    expect((await get(PLAN_MGR, "OFFICE")).status).toBe(403);
    expect((await get(STRANGER.toString(), "TEACHER")).status).toBe(403);
  });

  test("a DRAFT question clip: only its reviewer, not even a question manager", async () => {
    mockNoteFindOne.mockResolvedValue(note(false, "question"));
    expect((await get(REVIEWER.toString(), "TEACHER")).status).toBe(200);
    expect((await get(QUESTION_MGR, "OFFICE")).status).toBe(403);
    expect((await get(AUTHOR.toString(), "TEACHER")).status).toBe(403);
  });

  test("the response never carries the Drive id; a file with no clip row is 403", async () => {
    mockNoteFindOne.mockResolvedValue(note(true));
    const res = await get(MANAGER.toString(), "PRINCIPAL");
    expect(JSON.stringify(res.headers)).not.toContain("drive-internal");
    mockNoteFindOne.mockResolvedValue(null);
    expect((await get(REVIEWER.toString(), "TEACHER")).status).toBe(403);
  });
});
