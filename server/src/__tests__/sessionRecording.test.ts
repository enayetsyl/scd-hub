/**
 * Session Recording CO-2 tests (prd-classroom-observation §CO-2, D-#149).
 *
 * parseYoutubeVideoId — the PURE id extractor: a bare 11-char id, or a pasted
 *                       YouTube URL (watch?v= / youtu.be / embed / shorts); rejects
 *                       empty / wrong-length / garbage.
 * recordSessionRecording — persists a client-uploaded unlisted video against an
 *                       anchor (exactly one of section/group), stamps privacyStatus
 *                       "unlisted" + uploadedBy, audits SESSION_RECORDING_LINKED;
 *                       refuses a bad anchor / classDate / youtubeVideoId.
 * getSessionRecording — read-or-null; invalid id throws.
 *
 * DB-free (repo convention): the model + audit are mocked.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the module under test)
// ---------------------------------------------------------------------------

const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.lean = async () => val;
  return o;
};

const mockCreate = jest.fn();
const mockFindById = jest.fn();
jest.mock("../modules/classroom-observation/models/SessionRecording", () => ({
  RECORDING_PRIVACY_STATUSES: ["unlisted"],
  SessionRecording: {
    create: (doc: unknown) => mockCreate(doc),
    findById: (id: unknown) => mockFindById(id),
  },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// Import AFTER mocks
import {
  parseYoutubeVideoId,
  recordSessionRecording,
  getSessionRecording,
  SessionRecordingError,
} from "../modules/classroom-observation/services/SessionRecordingService";

const TEACHER = oid();
const OFFICE = oid();
const SECTION = oid();
const GROUP = oid();

const VIDEO_ID = "dQw4w9WgXcQ"; // a valid 11-char YouTube id shape

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
  mockCreate.mockImplementation(async (doc: Record<string, unknown>) => ({
    _id: oid(),
    ...doc,
    createdAt: new Date("2026-06-14T00:00:00Z"),
    updatedAt: new Date("2026-06-14T00:00:00Z"),
  }));
});

// ===========================================================================
// parseYoutubeVideoId — the pure extractor (§CO-2)
// ===========================================================================

describe("parseYoutubeVideoId", () => {
  test("returns a bare 11-char id unchanged", () => {
    expect(parseYoutubeVideoId(VIDEO_ID)).toBe(VIDEO_ID);
    expect(parseYoutubeVideoId(`  ${VIDEO_ID}  `)).toBe(VIDEO_ID); // trimmed
  });

  test("extracts the id from URL forms", () => {
    expect(parseYoutubeVideoId(`https://www.youtube.com/watch?v=${VIDEO_ID}`)).toBe(VIDEO_ID);
    expect(parseYoutubeVideoId(`https://www.youtube.com/watch?v=${VIDEO_ID}&t=42s`)).toBe(VIDEO_ID);
    expect(parseYoutubeVideoId(`https://youtu.be/${VIDEO_ID}`)).toBe(VIDEO_ID);
    expect(parseYoutubeVideoId(`https://www.youtube.com/embed/${VIDEO_ID}`)).toBe(VIDEO_ID);
    expect(parseYoutubeVideoId(`https://www.youtube.com/shorts/${VIDEO_ID}`)).toBe(VIDEO_ID);
  });

  test("rejects empty / wrong-length / garbage", () => {
    expect(() => parseYoutubeVideoId("")).toThrow(/required/);
    expect(() => parseYoutubeVideoId("   ")).toThrow(/required/);
    expect(() => parseYoutubeVideoId("tooShort")).toThrow(/11-character/);
    expect(() => parseYoutubeVideoId("waytoolongforanid")).toThrow(/11-character/);
    expect(() => parseYoutubeVideoId("not a url at all")).toThrow(/11-character/);
  });
});

// ===========================================================================
// recordSessionRecording
// ===========================================================================

describe("recordSessionRecording", () => {
  const base = {
    subject: "MATH",
    teacherId: TEACHER.toString(),
    classDate: "2026-06-14",
    youtubeVideoId: VIDEO_ID,
    sectionId: SECTION.toString(),
    actorId: OFFICE.toString(),
  };

  test("persists an unlisted recording + audits SESSION_RECORDING_LINKED", async () => {
    const res = await recordSessionRecording(base);
    expect(res.youtubeVideoId).toBe(VIDEO_ID);
    expect(res.privacyStatus).toBe("unlisted");
    expect(res.teacherId).toBe(TEACHER.toString());
    expect(res.uploadedBy).toBe(OFFICE.toString());
    expect(res.sectionId).toBe(SECTION.toString());
    expect(res.subjectGroupId).toBeNull();
    // the model was told to store privacyStatus "unlisted"
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ privacyStatus: "unlisted", youtubeVideoId: VIDEO_ID }));
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "SESSION_RECORDING_LINKED", targetKind: "SessionRecording" }),
    );
  });

  test("accepts a pasted YouTube URL (id extracted before persisting)", async () => {
    const res = await recordSessionRecording({ ...base, youtubeVideoId: `https://youtu.be/${VIDEO_ID}` });
    expect(res.youtubeVideoId).toBe(VIDEO_ID);
  });

  test("anchors on a subjectGroup when no section is given", async () => {
    const res = await recordSessionRecording({ ...base, sectionId: undefined, subjectGroupId: GROUP.toString() });
    expect(res.subjectGroupId).toBe(GROUP.toString());
    expect(res.sectionId).toBeNull();
  });

  test("requires EXACTLY ONE anchor (both section + group refused)", async () => {
    await expect(
      recordSessionRecording({ ...base, subjectGroupId: GROUP.toString() }),
    ).rejects.toThrow(/exactly one of sectionId or subjectGroupId/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("requires an anchor (neither section nor group refused)", async () => {
    await expect(
      recordSessionRecording({ ...base, sectionId: undefined }),
    ).rejects.toThrow(/exactly one of sectionId or subjectGroupId/);
  });

  test("rejects a bad classDate", async () => {
    await expect(recordSessionRecording({ ...base, classDate: "14-06-2026" })).rejects.toThrow(/YYYY-MM-DD/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("rejects an invalid youtubeVideoId before persisting", async () => {
    await expect(recordSessionRecording({ ...base, youtubeVideoId: "nope" })).rejects.toBeInstanceOf(SessionRecordingError);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// getSessionRecording
// ===========================================================================

describe("getSessionRecording", () => {
  test("returns the shaped recording when found", async () => {
    const id = oid();
    mockFindById.mockReturnValue(
      leanChain({
        _id: id,
        subject: "MATH",
        teacherId: TEACHER,
        classDate: "2026-06-14",
        sectionId: SECTION,
        subjectGroupId: null,
        routineSlotId: null,
        periodNumber: 3,
        youtubeVideoId: VIDEO_ID,
        privacyStatus: "unlisted",
        uploadedBy: OFFICE,
        createdAt: new Date("2026-06-14T00:00:00Z"),
        updatedAt: new Date("2026-06-14T00:00:00Z"),
      }),
    );
    const res = await getSessionRecording(id.toString());
    expect(res?.youtubeVideoId).toBe(VIDEO_ID);
    expect(res?.privacyStatus).toBe("unlisted");
  });

  test("returns null when not found", async () => {
    mockFindById.mockReturnValue(leanChain(null));
    expect(await getSessionRecording(oid().toString())).toBeNull();
  });

  test("throws on an invalid id", async () => {
    await expect(getSessionRecording("not-an-id")).rejects.toBeInstanceOf(SessionRecordingError);
  });
});
