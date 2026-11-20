/**
 * VN-1 tests — voice notes on a review round (D-#1658).
 *
 * Pure helpers, the add / delete / list service, the submit hook (drafts become part of the review;
 * voice counts as feedback) and the GET /files/:id gate. DB-free: Mongoose models + Drive mocked.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (before importing the code under test)
// ---------------------------------------------------------------------------

const mockUpload = jest.fn();
const mockDriveDelete = jest.fn();
jest.mock("../modules/platform/services/DriveStore", () => {
  const actual = jest.requireActual("../modules/platform/services/DriveStore");
  return {
    DriveUnavailableError: actual.DriveUnavailableError,
    uploadToDrive: (i: unknown) => mockUpload(i),
    deleteFromDrive: (id: unknown) => mockDriveDelete(id),
  };
});

const mockStoredCreate = jest.fn();
const mockStoredFindById = jest.fn();
const mockStoredDelete = jest.fn();
jest.mock("../modules/platform/models/StoredFile", () => ({
  StoredFile: {
    create: (a: unknown) => mockStoredCreate(a),
    findById: (id: unknown) => ({ lean: () => mockStoredFindById(id) }),
    deleteOne: (f: unknown) => mockStoredDelete(f),
  },
}));

const mockNoteCreate = jest.fn();
const mockNoteCount = jest.fn();
const mockNoteFind = jest.fn();
const mockNoteFindById = jest.fn();
const mockNoteFindOne = jest.fn();
const mockNoteDelete = jest.fn();
const mockNoteUpdateMany = jest.fn();
jest.mock("../modules/content/models/ReviewVoiceNote", () => ({
  ReviewVoiceNote: {
    create: (a: unknown) => mockNoteCreate(a),
    countDocuments: (f: unknown) => mockNoteCount(f),
    find: (f: unknown) => ({ sort: () => ({ lean: () => mockNoteFind(f) }) }),
    findById: (id: unknown) => mockNoteFindById(id),
    findOne: (f: unknown) => ({ lean: () => mockNoteFindOne(f) }),
    deleteOne: (f: unknown) => mockNoteDelete(f),
    updateMany: (f: unknown, u: unknown) => mockNoteUpdateMany(f, u),
  },
}));

const mockRoundFindById = jest.fn();
jest.mock("../modules/content/models/ReviewAssignment", () => ({
  ReviewAssignment: {
    findById: (id: unknown) => mockRoundFindById(id),
  },
}));

const mockArtifactFindById = jest.fn();
jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: {
    findById: (id: unknown) => mockArtifactFindById(id),
  },
}));
jest.mock("../modules/foundation/models/User", () => ({ User: { find: jest.fn() } }));
jest.mock("../modules/platform/services/AuditService", () => ({ writeAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../modules/notifications/services/emitters", () => ({ emitReviewAssigned: jest.fn() }));

import {
  MAX_VOICE_NOTES_PER_ROUND,
  MAX_VOICE_NOTE_BASE64_CHARS,
  VOICE_NOTE_ERRORS_BN,
  addReviewVoiceNote,
  assertReviewVoiceFileReadAccess,
  attachDraftVoiceNotes,
  cleanSpot,
  deleteReviewVoiceNote,
  listReviewVoiceNotes,
  managerPermissionFor,
  normaliseAudioMime,
  validateVoiceNoteAudio,
} from "../modules/content/services/ReviewVoiceNoteService";
import { submitPlanReview } from "../modules/content/services/ReviewService";
import { DriveUnavailableError } from "../modules/platform/services/DriveStore";
import { ForbiddenError } from "../middleware/authz";
import type { AppContext } from "../context";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REVIEWER = oid();
const OTHER = oid();
const AUTHOR = oid();
const ARTIFACT = oid();
const ROUND = oid();
const AUDIO_B64 = Buffer.from("RIFF....WAVEfmt fake audio bytes").toString("base64");
const AAC_B64 = Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x01, 0x02]).toString("base64");

function round(over: Record<string, unknown> = {}) {
  return {
    _id: ROUND,
    docType: "chapter_plan",
    reviewerId: REVIEWER,
    artifactId: ARTIFACT,
    status: "assigned",
    ...over,
  };
}

function noteRow(over: Record<string, unknown> = {}) {
  return {
    _id: oid(),
    assignmentId: ROUND,
    artifactId: ARTIFACT,
    reviewerId: REVIEWER,
    docType: "chapter_plan",
    fileId: oid(),
    seconds: 12.5,
    spot: "Hook",
    submitted: false,
    createdAt: new Date("2026-11-20T09:00:00Z"),
    ...over,
  };
}

const lean = <T,>(v: T) => ({ lean: () => Promise.resolve(v), select: () => ({ lean: () => Promise.resolve(v) }) });

beforeEach(() => {
  jest.clearAllMocks();
  mockUpload.mockResolvedValue("drive-1");
  mockDriveDelete.mockResolvedValue(undefined);
  mockStoredCreate.mockImplementation(async (a: Record<string, unknown>) => ({ _id: oid(), ...a }));
  mockNoteCreate.mockImplementation(async (a: Record<string, unknown>) => ({
    _id: oid(),
    createdAt: new Date("2026-11-20T09:00:00Z"),
    ...a,
  }));
  mockNoteCount.mockResolvedValue(0);
  mockRoundFindById.mockResolvedValue(round());
  mockArtifactFindById.mockReturnValue(lean({ importedBy: AUTHOR }));
  mockNoteUpdateMany.mockResolvedValue({ modifiedCount: 0 });
});

const add = (over: Record<string, unknown> = {}) =>
  addReviewVoiceNote({
    assignmentId: ROUND.toString(),
    reviewerId: REVIEWER.toString(),
    audioBase64: AUDIO_B64,
    mimeType: "audio/wav",
    seconds: 12.34,
    spot: "  Hook  ",
    ...over,
  });

// ---------------------------------------------------------------------------
// Pure helpers + limits
// ---------------------------------------------------------------------------

describe("helpers and limits", () => {
  test("normaliseAudioMime strips parameters and refuses non-recorder types", () => {
    expect(normaliseAudioMime("audio/wav;codecs=1")).toBe("audio/wav");
    expect(normaliseAudioMime("AUDIO/AAC")).toBe("audio/aac");
    expect(normaliseAudioMime("video/mp4")).toBeNull();
    expect(normaliseAudioMime("audio/webm")).toBeNull();
    expect(normaliseAudioMime(undefined)).toBeNull();
  });

  test("cleanSpot trims, collapses spaces, caps at 80, blank is null", () => {
    expect(cleanSpot("  Exit   check ")).toBe("Exit check");
    expect(cleanSpot("   ")).toBeNull();
    expect(cleanSpot(null)).toBeNull();
    expect(cleanSpot("x".repeat(200))).toHaveLength(80);
  });

  test("validateVoiceNoteAudio enforces type, size and 90 s", () => {
    expect(validateVoiceNoteAudio("audio/wav", 1000, 30)).toBeNull();
    expect(validateVoiceNoteAudio("audio/wav", 1000, 90)).toBeNull();
    expect(validateVoiceNoteAudio("audio/wav", 1000, 95)).toBe(VOICE_NOTE_ERRORS_BN.tooLong);
    expect(validateVoiceNoteAudio("audio/wav", 5 * 1024 * 1024, 30)).toBe(VOICE_NOTE_ERRORS_BN.tooLarge);
    expect(validateVoiceNoteAudio("audio/wav", 0, 30)).toBe(VOICE_NOTE_ERRORS_BN.empty);
    expect(validateVoiceNoteAudio("audio/wav", 1000, 0)).toBe(VOICE_NOTE_ERRORS_BN.empty);
    expect(validateVoiceNoteAudio("image/png", 1000, 30)).toBe(VOICE_NOTE_ERRORS_BN.badAudio);
  });

  test("managerPermissionFor picks the question permission for questions only", () => {
    expect(managerPermissionFor("chapter_plan")).toBe("plan_review:assign");
    expect(managerPermissionFor("session_plan")).toBe("plan_review:assign");
    expect(managerPermissionFor("question")).toBe("question_review:assign");
  });
});

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

describe("addReviewVoiceNote", () => {
  test("saves a DRAFT clip: Drive first, StoredFile kind, spot cleaned, seconds rounded", async () => {
    const dto = await add();
    expect(mockUpload).toHaveBeenCalledWith(expect.objectContaining({ mime: "audio/wav", subfolder: "review-voice" }));
    expect(mockStoredCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "review_voice_note", mime: "audio/wav", driveFileId: "drive-1" }),
    );
    expect(mockNoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({ spot: "Hook", seconds: 12.3, submitted: false, docType: "chapter_plan" }),
    );
    expect(dto.submitted).toBe(false);
    expect(dto.spot).toBe("Hook");
    expect(dto.seconds).toBe(12.3);
  });

  test("a clip with no spot stores none", async () => {
    await add({ spot: "  " });
    expect(mockNoteCreate).toHaveBeenCalledWith(expect.objectContaining({ spot: undefined }));
  });

  test("an ADTS AAC clip passes the header check; a wrong header or wrong-looking bytes are refused", async () => {
    await expect(add({ mimeType: "audio/aac", audioBase64: AAC_B64 })).resolves.toBeDefined();
    await expect(add({ mimeType: "audio/wav", audioBase64: AAC_B64 })).rejects.toThrow(VOICE_NOTE_ERRORS_BN.badAudio);
    await expect(add({ audioBase64: Buffer.from("not audio at all").toString("base64") })).rejects.toThrow(
      VOICE_NOTE_ERRORS_BN.badAudio,
    );
  });

  test("an oversized base64 string is refused before it is decoded", async () => {
    const spy = jest.spyOn(Buffer, "from");
    await expect(add({ audioBase64: "A".repeat(MAX_VOICE_NOTE_BASE64_CHARS + 1) })).rejects.toThrow(
      VOICE_NOTE_ERRORS_BN.tooLarge,
    );
    expect((spy.mock.calls as unknown[][]).some((c) => c[1] === "base64")).toBe(false);
    spy.mockRestore();
  });

  test("a non-plan (question) round is refused until VN-2", async () => {
    mockRoundFindById.mockResolvedValue(round({ docType: "question" }));
    await expect(add()).rejects.toThrow(VOICE_NOTE_ERRORS_BN.notPlan);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test("racing past the early count: the over-cap clip is rolled back", async () => {
    mockNoteCount.mockResolvedValueOnce(MAX_VOICE_NOTES_PER_ROUND - 1).mockResolvedValueOnce(MAX_VOICE_NOTES_PER_ROUND + 1);
    await expect(add()).rejects.toThrow(VOICE_NOTE_ERRORS_BN.tooMany);
    expect(mockNoteDelete).toHaveBeenCalled();
    expect(mockStoredDelete).toHaveBeenCalled();
    expect(mockDriveDelete).toHaveBeenCalledWith("drive-1");
  });

  test("only the assigned reviewer may add", async () => {
    await expect(add({ reviewerId: OTHER.toString() })).rejects.toThrow(/FORBIDDEN/);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test("a closed round refuses new clips", async () => {
    mockRoundFindById.mockResolvedValue(round({ status: "superseded" }));
    await expect(add()).rejects.toThrow(VOICE_NOTE_ERRORS_BN.closed);
  });

  test("a submitted (still editable) round accepts new clips", async () => {
    mockRoundFindById.mockResolvedValue(round({ status: "submitted" }));
    await expect(add()).resolves.toBeDefined();
  });

  test("the 11th clip is refused", async () => {
    mockNoteCount.mockResolvedValue(MAX_VOICE_NOTES_PER_ROUND);
    await expect(add()).rejects.toThrow(VOICE_NOTE_ERRORS_BN.tooMany);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test("a clip over 90 s, a wrong type or empty audio is refused before any lookup", async () => {
    await expect(add({ seconds: 120 })).rejects.toThrow(VOICE_NOTE_ERRORS_BN.tooLong);
    await expect(add({ mimeType: "video/mp4" })).rejects.toThrow(VOICE_NOTE_ERRORS_BN.badAudio);
    await expect(add({ audioBase64: "" })).rejects.toThrow(VOICE_NOTE_ERRORS_BN.empty);
    expect(mockRoundFindById).not.toHaveBeenCalled();
  });

  test("Drive down: Bangla error and nothing persisted", async () => {
    mockUpload.mockRejectedValue(new DriveUnavailableError());
    await expect(add()).rejects.toThrow(VOICE_NOTE_ERRORS_BN.driveDown);
    expect(mockStoredCreate).not.toHaveBeenCalled();
    expect(mockNoteCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

describe("deleteReviewVoiceNote", () => {
  test("the reviewer deletes their own clip (row, StoredFile, Drive copy)", async () => {
    const row = noteRow();
    mockNoteFindById.mockResolvedValue(row);
    mockStoredFindById.mockResolvedValue({ driveFileId: "drive-9" });
    await expect(deleteReviewVoiceNote({ noteId: row._id.toString(), reviewerId: REVIEWER.toString() })).resolves.toBe(true);
    expect(mockNoteDelete).toHaveBeenCalledWith({ _id: row._id });
    expect(mockStoredDelete).toHaveBeenCalledWith({ _id: row.fileId });
    expect(mockDriveDelete).toHaveBeenCalledWith("drive-9");
  });

  test("someone else cannot delete it", async () => {
    mockNoteFindById.mockResolvedValue(noteRow());
    await expect(deleteReviewVoiceNote({ noteId: "x", reviewerId: OTHER.toString() })).rejects.toThrow(/FORBIDDEN/);
    expect(mockNoteDelete).not.toHaveBeenCalled();
  });

  test("a SENT clip cannot be deleted", async () => {
    mockNoteFindById.mockResolvedValue(noteRow({ submitted: true }));
    await expect(deleteReviewVoiceNote({ noteId: "x", reviewerId: REVIEWER.toString() })).rejects.toThrow(
      VOICE_NOTE_ERRORS_BN.sentLocked,
    );
    expect(mockNoteDelete).not.toHaveBeenCalled();
  });

  test("a closed round keeps its clips", async () => {
    mockNoteFindById.mockResolvedValue(noteRow());
    mockRoundFindById.mockResolvedValue(round({ status: "cancelled" }));
    await expect(deleteReviewVoiceNote({ noteId: "x", reviewerId: REVIEWER.toString() })).rejects.toThrow(
      VOICE_NOTE_ERRORS_BN.closed,
    );
  });

  test("an unknown clip says so", async () => {
    mockNoteFindById.mockResolvedValue(null);
    await expect(deleteReviewVoiceNote({ noteId: "x", reviewerId: REVIEWER.toString() })).rejects.toThrow(
      VOICE_NOTE_ERRORS_BN.notFound,
    );
  });
});

// ---------------------------------------------------------------------------
// List - who can read
// ---------------------------------------------------------------------------

describe("listReviewVoiceNotes", () => {
  beforeEach(() => {
    mockRoundFindById.mockReturnValue(lean(round()));
    mockNoteFind.mockResolvedValue([noteRow({ submitted: true })]);
  });

  test("the reviewer sees all their clips, drafts included", async () => {
    await listReviewVoiceNotes(ROUND.toString(), { userId: REVIEWER.toString(), managerFor: () => false });
    const filter = mockNoteFind.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.submitted).toBeUndefined();
  });

  test("a review manager sees submitted clips only", async () => {
    const out = await listReviewVoiceNotes(ROUND.toString(), { userId: OTHER.toString(), managerFor: () => true });
    expect((mockNoteFind.mock.calls[0][0] as Record<string, unknown>).submitted).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0].fileId).toBeTruthy();
  });

  test("the plan author sees submitted clips only", async () => {
    await listReviewVoiceNotes(ROUND.toString(), { userId: AUTHOR.toString(), managerFor: () => false });
    expect((mockNoteFind.mock.calls[0][0] as Record<string, unknown>).submitted).toBe(true);
  });

  test("a manager is decided by the round's own doc-type", async () => {
    mockRoundFindById.mockReturnValue(lean(round({ docType: "question" })));
    const seen: string[] = [];
    const out = await listReviewVoiceNotes(ROUND.toString(), {
      userId: OTHER.toString(),
      managerFor: (d) => (seen.push(d), d === "chapter_plan"),
    });
    expect(seen).toEqual(["question"]);
    expect(out).toEqual([]);
  });

  test("anyone else gets nothing and no query runs", async () => {
    const out = await listReviewVoiceNotes(ROUND.toString(), { userId: OTHER.toString(), managerFor: () => false });
    expect(out).toEqual([]);
    expect(mockNoteFind).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Submit hook
// ---------------------------------------------------------------------------

describe("submitPlanReview with voice notes", () => {
  function assignmentDoc() {
    return {
      _id: ROUND,
      docType: "chapter_plan",
      reviewerId: REVIEWER,
      artifactId: ARTIFACT,
      status: "assigned",
      subject: "BAN",
      classLevel: 3,
      anchorWord: "x",
      addressNumber: "1",
      assignedBy: AUTHOR,
      assignedAt: new Date(),
      roundNumber: 1,
      save: jest.fn().mockResolvedValue(true),
    };
  }
  const submit = (verdict: string, feedback?: string) =>
    submitPlanReview({
      assignmentId: ROUND.toString(),
      reviewerId: REVIEWER.toString(),
      verdict,
      feedback,
    });

  beforeEach(() => {
    mockRoundFindById.mockResolvedValue(assignmentDoc());
    mockArtifactFindById.mockResolvedValue({ reviewStatus: "draft", save: jest.fn().mockResolvedValue(true) });
  });

  test("submitting flips the reviewer's drafts to sent", async () => {
    mockNoteUpdateMany.mockResolvedValue({ modifiedCount: 3 });
    await submit("APPROVE");
    expect(mockNoteUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ submitted: false }),
      { $set: { submitted: true } },
    );
    await expect(attachDraftVoiceNotes(ROUND.toString(), REVIEWER.toString())).resolves.toBe(3);
  });

  test("changes requested with voice only (no text) is allowed", async () => {
    mockNoteCount.mockResolvedValue(2);
    await expect(submit("CHANGES_REQUESTED", "")).resolves.toBeDefined();
  });

  test("changes requested with neither text nor voice is still refused", async () => {
    mockNoteCount.mockResolvedValue(0);
    await expect(submit("CHANGES_REQUESTED", "")).rejects.toThrow(/feedback is required/i);
  });
});

// ---------------------------------------------------------------------------
// /files gate
// ---------------------------------------------------------------------------

describe("assertReviewVoiceFileReadAccess", () => {
  const ctxFor = (userId: string, role: string) => ({ auth: { userId, role } }) as unknown as AppContext;
  const FILE = oid().toString();

  test("the reviewer reads their own draft", async () => {
    mockNoteFindOne.mockResolvedValue(noteRow({ submitted: false }));
    await expect(assertReviewVoiceFileReadAccess(ctxFor(REVIEWER.toString(), "TEACHER"), FILE)).resolves.toBeUndefined();
  });

  test("a draft is private: the author and a manager are refused", async () => {
    mockNoteFindOne.mockResolvedValue(noteRow({ submitted: false }));
    await expect(assertReviewVoiceFileReadAccess(ctxFor(AUTHOR.toString(), "OFFICE"), FILE)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assertReviewVoiceFileReadAccess(ctxFor(OTHER.toString(), "PRINCIPAL"), FILE)).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("a submitted clip: the plan author and a review manager read it", async () => {
    mockNoteFindOne.mockResolvedValue(noteRow({ submitted: true }));
    await expect(assertReviewVoiceFileReadAccess(ctxFor(AUTHOR.toString(), "TEACHER"), FILE)).resolves.toBeUndefined();
    await expect(assertReviewVoiceFileReadAccess(ctxFor(OTHER.toString(), "PRINCIPAL"), FILE)).resolves.toBeUndefined();
  });

  test("a submitted clip: an unrelated teacher is refused", async () => {
    mockNoteFindOne.mockResolvedValue(noteRow({ submitted: true }));
    await expect(assertReviewVoiceFileReadAccess(ctxFor(OTHER.toString(), "TEACHER"), FILE)).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("a file with no clip row, or no login, is refused", async () => {
    mockNoteFindOne.mockResolvedValue(null);
    await expect(assertReviewVoiceFileReadAccess(ctxFor(REVIEWER.toString(), "TEACHER"), FILE)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assertReviewVoiceFileReadAccess({ auth: null } as unknown as AppContext, FILE)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
