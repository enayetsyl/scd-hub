/**
 * VN-T1 tests — automatic transcripts of review voice notes (D-#1662). DB-free: models, Drive, the AI
 * settings, the cap check and Gemini (the TranscriptModel seam / meteredGeminiFetch) are all mocked.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const mockFindOneAndUpdate = jest.fn();
const mockUpdateOne = jest.fn();
const mockUpdateMany = jest.fn();
const mockNoteFind = jest.fn();
jest.mock("../modules/content/models/ReviewVoiceNote", () => ({
  ReviewVoiceNote: {
    findOneAndUpdate: (f: unknown, u: unknown, o: unknown) => mockFindOneAndUpdate(f, u, o),
    updateOne: (f: unknown, u: unknown) => mockUpdateOne(f, u),
    updateMany: (f: unknown, u: unknown) => mockUpdateMany(f, u),
    find: (f: unknown) => ({
      sort: () => ({ lean: () => mockNoteFind(f) }),
      limit: () => ({ lean: () => mockNoteFind(f) }),
    }),
  },
}));
const mockStoredFind = jest.fn();
jest.mock("../modules/platform/models/StoredFile", () => ({
  StoredFile: { findById: (id: unknown) => ({ lean: () => mockStoredFind(id) }) },
}));
const mockDownload = jest.fn();
jest.mock("../modules/platform/services/DriveStore", () => ({
  downloadFromDrive: (id: unknown) => mockDownload(id),
  uploadToDrive: jest.fn(),
  deleteFromDrive: jest.fn(),
  DriveUnavailableError: class extends Error {},
}));
const mockRoute = jest.fn();
jest.mock("../modules/platform/services/AiSettingService", () => ({
  refreshAiConfig: async () => undefined,
  aiRouteFor: (k: string) => mockRoute(k),
}));
const mockMetered = jest.fn();
jest.mock("../modules/platform/ai/meteredFetch", () => ({ meteredGeminiFetch: (...a: unknown[]) => mockMetered(...a) }));
class MockCapError extends Error {
  name = "AiCapError";
}
const mockCaps = jest.fn();
const mockAlert = jest.fn();
jest.mock("../modules/platform/services/AiUsageService", () => ({
  AiCapError: MockCapError,
  assertWithinCaps: (c: unknown) => mockCaps(c),
  alertIfBudget: (f: unknown, at: unknown) => mockAlert(f, at),
}));
const mockRoundFind = jest.fn();
jest.mock("../modules/content/models/ReviewAssignment", () => ({
  ReviewAssignment: { findById: (id: unknown) => ({ lean: () => mockRoundFind(id) }) },
}));
const mockArtifactFind = jest.fn();
jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: { findById: () => ({ select: () => ({ lean: () => mockArtifactFind() }) }) },
}));
jest.mock("../modules/foundation/models/User", () => ({ User: { find: jest.fn() } }));
jest.mock("../modules/platform/services/AuditService", () => ({ writeAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../modules/notifications/services/emitters", () => ({ emitReviewAssigned: jest.fn() }));

import {
  GeminiTranscriber,
  MAX_TRANSCRIPT_TRIES,
  TRANSCRIPT_QUOTA_RETRY_AFTER_MS,
  TRANSCRIPT_RETRY_AFTER_MS,
  TRANSCRIPT_STALE_PENDING_MS,
  TranscriptHttpError,
  queueVoiceTranscripts,
  resolveTranscriber,
  runFirstAttempts,
  sweepVoiceTranscripts,
  transcribeClaimed,
  type Resolved,
  type TranscriptModel,
} from "../modules/content/services/ReviewVoiceTranscriptService";
import { listReviewVoiceNotes, toVoiceNoteDTO } from "../modules/content/services/ReviewVoiceNoteService";
import type { IReviewVoiceNote } from "../modules/content/models/ReviewVoiceNote";

const REVIEWER = oid();
const STRANGER = oid();
const AUTHOR = oid();
const ROUND = oid();

function note(over: Record<string, unknown> = {}): IReviewVoiceNote {
  return {
    _id: oid(),
    assignmentId: ROUND,
    artifactId: oid(),
    reviewerId: REVIEWER,
    docType: "chapter_plan",
    fileId: oid(),
    mime: "audio/wav",
    seconds: 10,
    submitted: true,
    createdAt: new Date("2026-11-20T09:00:00Z"),
    ...over,
  } as unknown as IReviewVoiceNote;
}

const okModel = (text = "hello"): TranscriptModel => ({ name: "m-test", transcribe: jest.fn().mockResolvedValue(text) });
const failModel = (status: number): TranscriptModel => ({
  name: "m-test",
  transcribe: jest.fn().mockRejectedValue(new TranscriptHttpError(status)),
});
const withModel = (m: TranscriptModel): Resolved => ({ model: m, why: null });

beforeEach(() => {
  jest.resetAllMocks();
  mockCaps.mockResolvedValue(undefined);
  mockAlert.mockResolvedValue(0);
  mockStoredFind.mockResolvedValue({ driveFileId: "drv1" });
  mockDownload.mockResolvedValue(Buffer.from("RIFF....WAVE"));
  mockUpdateOne.mockResolvedValue({});
  mockUpdateMany.mockResolvedValue({ modifiedCount: 0 });
  mockNoteFind.mockResolvedValue([]);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("transcribeClaimed", () => {
  it("success stores DONE + transcript + model", async () => {
    const n = note();
    const at = new Date("2026-11-20T10:00:00Z");
    expect(await transcribeClaimed(n, withModel(okModel("some words")), () => at)).toBe("DONE");
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: n._id },
      { $set: { transcriptStatus: "DONE", transcript: "some words", transcriptModel: "m-test", transcribedAt: at, transcriptAttemptAt: at } },
    );
  });

  it("a successful call runs the budget alert afterwards", async () => {
    await transcribeClaimed(note(), withModel(okModel()));
    expect(mockAlert).toHaveBeenCalledWith("voice_transcript", expect.any(Date));
  });

  it("a 429 becomes QUOTA and gives the try back", async () => {
    expect(await transcribeClaimed(note(), withModel(failModel(429)))).toBe("QUOTA");
    const upd = mockUpdateOne.mock.calls[0][1];
    expect(upd.$set.transcriptStatus).toBe("QUOTA");
    expect(upd.$inc).toEqual({ transcriptTries: -1 });
  });

  it("any other failure becomes FAILED (a try stays used)", async () => {
    expect(await transcribeClaimed(note(), withModel(failModel(500)))).toBe("FAILED");
    expect(mockUpdateOne.mock.calls[0][1].$inc).toBeUndefined();
    mockDownload.mockRejectedValueOnce(new Error("drive down"));
    expect(await transcribeClaimed(note(), withModel(okModel()))).toBe("FAILED");
  });

  it("a cap refusal sets QUOTA, gives the try back and makes no Gemini call", async () => {
    mockCaps.mockRejectedValueOnce(new MockCapError("cap"));
    const m = okModel();
    expect(await transcribeClaimed(note(), withModel(m))).toBe("QUOTA");
    expect(m.transcribe).not.toHaveBeenCalled();
    expect(mockUpdateOne.mock.calls[0][1].$inc).toEqual({ transcriptTries: -1 });
    expect(mockCaps.mock.calls[0][0]).toMatchObject({ feature: "voice_transcript", provider: "gemini", model: "m-test" });
  });

  it("no key stores NO_KEY and makes no call", async () => {
    mockRoute.mockResolvedValue({ enabled: true, primary: { provider: "gemini", model: "x", key: null }, fallback: null });
    expect(await transcribeClaimed(note())).toBe("NO_KEY");
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("the feature switched off stores OFF and makes no call", async () => {
    mockRoute.mockResolvedValue({ enabled: false, primary: { provider: "gemini", model: "x", key: "k" }, fallback: null });
    expect(await transcribeClaimed(note())).toBe("OFF");
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("resolveTranscriber builds a Gemini model when on, keyed and gemini", async () => {
    mockRoute.mockResolvedValue({ enabled: true, primary: { provider: "gemini", model: "gem-x", key: "k" }, fallback: null });
    const r = await resolveTranscriber();
    expect(r.why).toBeNull();
    expect(r.model?.name).toBe("gem-x");
    expect(mockRoute).toHaveBeenCalledWith("voice_transcript");
  });
});

describe("queue + sweep", () => {
  it("queueing marks sent clips PENDING and kicks once; never throws", async () => {
    mockUpdateMany.mockResolvedValue({ modifiedCount: 2 });
    const kick = jest.fn();
    expect(await queueVoiceTranscripts(ROUND.toString(), REVIEWER.toString(), kick)).toBe(2);
    expect(kick).toHaveBeenCalledTimes(1);
    const filter = mockUpdateMany.mock.calls[0][0];
    expect(filter.submitted).toBe(true);
    expect(filter.transcriptStatus).toEqual({ $exists: false });
    mockUpdateMany.mockRejectedValueOnce(new Error("db"));
    expect(await queueVoiceTranscripts(ROUND.toString(), REVIEWER.toString(), kick)).toBe(0);
  });

  it("first attempts work through the round's fresh PENDING clips", async () => {
    mockFindOneAndUpdate.mockResolvedValueOnce(note()).mockResolvedValueOnce(note()).mockResolvedValueOnce(null);
    const m = okModel();
    expect(await runFirstAttempts(ROUND.toString(), withModel(m))).toBe(2);
    expect(m.transcribe).toHaveBeenCalledTimes(2);
  });

  it("the sweep claims PENDING/FAILED (idle 10 min, under 3 tries) and QUOTA (idle 60 min) clips", async () => {
    mockFindOneAndUpdate.mockResolvedValueOnce(note()).mockResolvedValueOnce(null);
    const now = new Date("2026-11-20T12:00:00Z");
    expect(await sweepVoiceTranscripts(() => now, withModel(okModel()))).toBe(1);
    const [filter, update] = mockFindOneAndUpdate.mock.calls[0];
    const [pf, , q] = filter.$or;
    expect(pf.transcriptStatus).toEqual({ $in: ["PENDING", "FAILED"] });
    expect(pf.transcriptTries).toEqual({ $lt: MAX_TRANSCRIPT_TRIES });
    expect(MAX_TRANSCRIPT_TRIES).toBe(3);
    expect(pf.transcriptAttemptAt.$lte).toEqual(new Date(now.getTime() - TRANSCRIPT_RETRY_AFTER_MS));
    expect(q).toEqual({ transcriptStatus: "QUOTA", transcriptAttemptAt: { $lte: new Date(now.getTime() - TRANSCRIPT_QUOTA_RETRY_AFTER_MS) } });
    expect(update.$inc).toEqual({ transcriptTries: 1 });
  });

  it("a run takes at most 2 clips", async () => {
    mockFindOneAndUpdate.mockResolvedValue(note());
    const ok = okModel();
    expect(await sweepVoiceTranscripts(() => new Date(), withModel(ok))).toBe(2);
    expect(ok.transcribe).toHaveBeenCalledTimes(2);
  });

  it("the first QUOTA ends the run", async () => {
    mockFindOneAndUpdate.mockResolvedValue(note());
    const limited = failModel(429);
    expect(await sweepVoiceTranscripts(() => new Date(), withModel(limited), 5)).toBe(1);
    expect(limited.transcribe).toHaveBeenCalledTimes(1);
  });

  it("stale PENDING clips out of tries become FAILED", async () => {
    mockFindOneAndUpdate.mockResolvedValue(null);
    const now = new Date("2026-11-20T12:00:00Z");
    await sweepVoiceTranscripts(() => now, withModel(okModel()));
    const [f, u] = mockUpdateMany.mock.calls[0];
    expect(f).toMatchObject({ transcriptStatus: "PENDING", transcriptTries: { $gte: 3 } });
    expect(f.transcriptAttemptAt.$lte).toEqual(new Date(now.getTime() - TRANSCRIPT_STALE_PENDING_MS));
    expect(u).toEqual({ $set: { transcriptStatus: "FAILED" } });
  });

  it("when the transcriber resolves, OFF / NO_KEY clips are re-queued; when it does not, they are not", async () => {
    const ids = [oid(), oid()];
    mockNoteFind.mockResolvedValue(ids.map((_id) => ({ _id })));
    mockFindOneAndUpdate.mockResolvedValue(null);
    await sweepVoiceTranscripts(() => new Date(), withModel(okModel()));
    const requeue = mockUpdateMany.mock.calls.find((c) => c[0]._id);
    expect(requeue![0]._id).toEqual({ $in: ids });
    expect(requeue![1].$set).toMatchObject({ transcriptStatus: "PENDING", transcriptTries: 0 });
    mockUpdateMany.mockClear();
    await sweepVoiceTranscripts(() => new Date(), { model: null, why: "OFF" });
    expect(mockUpdateMany.mock.calls.some((c) => c[0]._id)).toBe(false);
  });
});

describe("GeminiTranscriber", () => {
  it("meters as voice_transcript, sends the clip's audio as inline_data and tags the clip", async () => {
    mockMetered.mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: " hi " }] } }] }) });
    const text = await new GeminiTranscriber("k", "gem-x").transcribe({ mimeType: "audio/aac", data: "QUJD" }, { noteId: "n1" });
    expect(text).toBe("hi");
    const [feature, model, , init, ctx] = mockMetered.mock.calls[0];
    expect(feature).toBe("voice_transcript");
    expect(model).toBe("gem-x");
    expect(ctx).toEqual({ refType: "review_voice_note", refId: "n1" });
    const body = JSON.parse(init.body);
    expect(body.contents[0].parts[1].inline_data).toEqual({ mime_type: "audio/aac", data: "QUJD" });
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it("a non-OK reply throws TranscriptHttpError with the status", async () => {
    mockMetered.mockResolvedValue({ ok: false, status: 429 });
    await expect(new GeminiTranscriber("k", "m").transcribe({ mimeType: "audio/wav", data: "x" }, { noteId: "n" })).rejects.toMatchObject({ status: 429 });
  });
});

describe("who sees the transcript", () => {
  it("the DTO carries the text only when DONE", () => {
    expect(toVoiceNoteDTO(note({ transcriptStatus: "DONE", transcript: "text" })).transcript).toBe("text");
    expect(toVoiceNoteDTO(note({ transcriptStatus: "PENDING", transcript: "stale" })).transcript).toBeNull();
    expect(toVoiceNoteDTO(note({ transcriptStatus: "QUOTA" })).transcriptStatus).toBe("QUOTA");
    expect(toVoiceNoteDTO(note()).transcriptStatus).toBeNull();
  });

  it("listing is still row-scoped: a stranger gets nothing; reviewer, author and manager get the clip", async () => {
    mockRoundFind.mockResolvedValue({ reviewerId: REVIEWER, artifactId: oid(), docType: "chapter_plan" });
    mockArtifactFind.mockResolvedValue({ importedBy: AUTHOR });
    mockNoteFind.mockResolvedValue([note({ transcriptStatus: "DONE", transcript: "text" })]);
    const none = await listReviewVoiceNotes(ROUND.toString(), { userId: STRANGER.toString(), managerFor: () => false });
    expect(none).toEqual([]);
    const mine = await listReviewVoiceNotes(ROUND.toString(), { userId: REVIEWER.toString(), managerFor: () => false });
    expect(mine[0].transcript).toBe("text");
    const author = await listReviewVoiceNotes(ROUND.toString(), { userId: AUTHOR.toString(), managerFor: () => false });
    expect(author[0].transcript).toBe("text");
    const manager = await listReviewVoiceNotes(ROUND.toString(), { userId: STRANGER.toString(), managerFor: () => true });
    expect(manager).toHaveLength(1);
  });
});
