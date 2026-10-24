/**
 * D-#761 — server pages for the growing lists of the paging sweep (batch 4):
 * scholarship papers, chat oversight, trackers, Saturday-revision history, the script
 * archive (search WITHOUT the silent 500 cap + the retention list) and the video-review
 * board rows.
 *
 * DB-free: every model is a mocked chain, so the assertions are about the query each page
 * builds — filter, stable sort with an `_id` tie-break, skip/limit, the real total — and
 * that the per-row joins run for the page only.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

type Calls = { find?: unknown; sort?: unknown; skip?: number; limit?: number; count?: unknown; pipeline?: unknown };
function pagedModel(calls: Calls, docs: () => unknown[], total: () => number) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.sort = (s: unknown) => { calls.sort = s; return chain; };
  chain.skip = (n: number) => { calls.skip = n; return chain; };
  chain.limit = (n: number) => { calls.limit = n; return chain; };
  chain.lean = async () => docs();
  return {
    find: (q: unknown) => { calls.find = q; return chain; },
    countDocuments: async (q: unknown) => { calls.count = q; return total(); },
    aggregate: async (p: unknown) => { calls.pipeline = p; return docs(); },
  };
}
const reset = (c: Calls) => { for (const k of Object.keys(c)) delete (c as Record<string, unknown>)[k]; };

// --- scholarship ------------------------------------------------------------
const paperCalls: Calls = {};
let paperDocs: unknown[] = [];
jest.mock("../modules/scholarship/models/ScholarshipPaper", () => ({
  ScholarshipPaper: pagedModel(paperCalls, () => paperDocs, () => 120),
}));
const mockScoreFind = jest.fn();
jest.mock("../modules/scholarship/models/ScholarshipScore", () => ({
  ScholarshipScore: {
    find: (q: unknown) => ({ select: () => ({ lean: async () => mockScoreFind(q) }) }),
  },
}));

// --- chat ---------------------------------------------------------------------
const convCalls: Calls = {};
jest.mock("../modules/chat/models/Conversation", () => ({
  Conversation: pagedModel(convCalls, () => [{ _id: "c1" }], () => 75),
}));

// --- trackers -----------------------------------------------------------------
const trackerCalls: Calls = {};
jest.mock("../modules/trackers/models/TrackerRecord", () => ({
  TrackerRecord: pagedModel(trackerCalls, () => [{ n: 1 }, { n: 2 }], () => 52),
}));

// --- revision -----------------------------------------------------------------
const revCalls: Calls = {};
let revDocs: unknown[] = [];
jest.mock("../modules/saturday-revision/models/RevisionEntry", () => ({
  RevisionEntry: pagedModel(revCalls, () => revDocs, () => 60),
}));

// --- archive ------------------------------------------------------------------
const bundleCalls: Calls = {};
let bundleDocs: unknown[] = [];
let bundleTotal = 0;
jest.mock("../modules/archive/models/ScriptBundle", () => ({
  ScriptBundle: pagedModel(bundleCalls, () => bundleDocs, () => bundleTotal),
}));
const currentYear = { _id: oid(), startDate: new Date(2026, 0, 1) };
const previousYear = { _id: oid(), startDate: new Date(2025, 0, 1) };
jest.mock("../modules/foundation/models/AcademicYear", () => ({
  AcademicYear: {
    findOne: (q: Record<string, unknown>) => {
      const val = q.current ? currentYear : previousYear;
      return { lean: async () => val, sort: () => ({ lean: async () => val }) };
    },
  },
}));

// --- video review ---------------------------------------------------------------
const videoCalls: Calls = {};
let videoDocs: unknown[] = [];
jest.mock("../modules/classroom-observation/models/VideoReviewAssignment", () => ({
  VideoReviewAssignment: pagedModel(videoCalls, () => videoDocs, () => 7),
}));
const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => ({ select: () => ({ lean: async () => mockUserFind(q) }) }) },
}));

import { listPapersPage } from "../modules/scholarship/services/ScholarshipService";
import { oversightConversationsPage } from "../modules/chat/services/ChatOversightService";
import { listTrackersPage } from "../modules/trackers/services/TrackerService";
import { studentRevisionHistoryPage } from "../modules/saturday-revision/services/RevisionService";
import { listBundlesPage, listDisposablePage } from "../modules/archive/services/ArchiveService";
import { videoReviewRowsPage } from "../modules/classroom-observation/services/VideoReviewService";

beforeEach(() => {
  jest.clearAllMocks();
  for (const c of [paperCalls, convCalls, trackerCalls, revCalls, bundleCalls, videoCalls]) reset(c);
});

describe("scholarshipPapersPage", () => {
  test("pages the papers in the database; scores are read for the page's papers only", async () => {
    const sectionId = oid().toString();
    const p = { _id: oid(), paperId: "SP-0001", name: "Mock 1", subjects: ["ENG"], paperDate: new Date(2026, 9, 1), totalMarks: 50, items: [{}, {}], status: "SCORED" };
    paperDocs = [p];
    mockScoreFind.mockResolvedValue([
      { paperId: p._id, status: "PRESENT", itemMarks: [{ marks: 20 }, { marks: 20 }] },
      { paperId: p._id, status: "ABSENT", itemMarks: [] },
    ]);

    const page = await listPapersPage(sectionId, "ENG", { page: 3, pageSize: 50 });

    expect(paperCalls.find).toEqual({ sectionId: new mongoose.Types.ObjectId(sectionId), subjects: "ENG" });
    expect(paperCalls).toMatchObject({ sort: { paperDate: -1, createdAt: -1, _id: -1 }, skip: 100, limit: 50 });
    expect(page.total).toBe(120);
    expect(page.rows[0]).toMatchObject({ paperId: "SP-0001", scoredCount: 2, presentCount: 1, classPercent: 80, itemCount: 2 });
    expect((mockScoreFind.mock.calls[0][0] as { paperId: { $in: unknown[] } }).paperId.$in).toEqual([p._id]);
  });
});

describe("oversightConversationsPage", () => {
  test("every conversation, newest activity first, _id tie-break", async () => {
    const page = await oversightConversationsPage({ page: 2, pageSize: 25 });
    expect(convCalls.find).toEqual({});
    expect(convCalls).toMatchObject({ sort: { lastMessageAt: -1, createdAt: -1, _id: -1 }, skip: 25, limit: 25 });
    expect(page).toMatchObject({ total: 75, page: 2, pageSize: 25 });
  });
});

describe("trackersPage", () => {
  test("the section's filters, newest first; rows mapped by the caller's shaper", async () => {
    const page = await listTrackersPage(
      { sectionId: "sec1", trackerKind: "classtest", status: "open" },
      { page: 2, pageSize: 50 },
      (docs) => docs.map((d) => `row ${(d as { n: number }).n}`),
    );
    expect(trackerCalls.find).toEqual({ sectionId: "sec1", trackerKind: "classtest", status: "open" });
    expect(trackerCalls).toMatchObject({ sort: { createdAt: -1, _id: -1 }, skip: 50, limit: 50 });
    expect(page).toEqual({ rows: ["row 1", "row 2"], total: 52, page: 2, pageSize: 50 });
  });
});

describe("studentRevisionHistoryPage", () => {
  test("one student's entries, newest first, shaped", async () => {
    const studentId = oid().toString();
    revDocs = [
      {
        _id: oid(), groupId: oid(), studentId: new mongoose.Types.ObjectId(studentId), date: new Date(2026, 9, 17),
        present: true, portions: [{ category: "SABAQ", status: "COMPLETED", fromSurah: 2, fromAyah: 253, toSurah: 2, toAyah: 260, tanbih: 1, fath: 0 }],
        teacherUserId: oid(), createdAt: new Date(), updatedAt: new Date(),
      },
    ];
    const page = await studentRevisionHistoryPage(studentId, {});
    expect(revCalls.find).toEqual({ studentId: new mongoose.Types.ObjectId(studentId) });
    expect(revCalls).toMatchObject({ sort: { date: -1, _id: -1 }, skip: 0, limit: 50 });
    expect(page.total).toBe(60);
    expect(page.rows[0].portions[0].mistakes).toEqual({ harf: 0, ghunnah: 0, madd: 0, other: 0 });
  });

  test("a bad id is refused before any read", async () => {
    await expect(studentRevisionHistoryPage("not-an-id", {})).rejects.toThrow();
    expect(revCalls.find).toBeUndefined();
  });
});

describe("scriptBundlesPage / disposableScriptBundlesPage", () => {
  const bundle = () => ({
    _id: oid(), source: { kind: "CLASS_TEST", refId: oid() }, sourceLabel: "CT-C5-BAN-0001",
    academicYearId: oid(), classLevel: 5, sectionId: oid(), subject: "BAN", testNumber: 1,
    examDate: new Date(2026, 3, 1), scriptCount: 30, boxId: oid(), filedBy: oid(),
    filedAt: new Date(2026, 3, 2), status: "FILED", checkouts: [], attachmentFileIds: [],
  });

  test("the search has no silent cap: page 11 of 600 matches is reachable and total is real", async () => {
    bundleDocs = [bundle()];
    bundleTotal = 600;
    const page = await listBundlesPage({ labelQuery: "CT-C5" }, { page: 11, pageSize: 50 });
    expect(bundleCalls.find).toEqual({ sourceLabel: { $regex: "CT-C5", $options: "i" } });
    expect(bundleCalls).toMatchObject({ sort: { examDate: -1, _id: -1 }, skip: 500, limit: 50 });
    expect(page.total).toBe(600);
    expect(page.rows[0]).toMatchObject({ sourceLabel: "CT-C5-BAN-0001", overdue: false });
  });

  test("the search escapes regex metacharacters", async () => {
    bundleDocs = [];
    await listBundlesPage({ labelQuery: "a.b" }, {});
    expect(bundleCalls.find).toEqual({ sourceLabel: { $regex: "a\\.b", $options: "i" } });
  });

  test("the retention list excludes the protected years, oldest exam first", async () => {
    bundleDocs = [];
    bundleTotal = 3;
    const page = await listDisposablePage({ page: 1, pageSize: 2 });
    expect(bundleCalls.find).toEqual({ status: "FILED", academicYearId: { $nin: [currentYear._id, previousYear._id] } });
    expect(bundleCalls).toMatchObject({ sort: { examDate: 1, _id: 1 }, skip: 0, limit: 2 });
    expect(page.total).toBe(3);
  });
});

describe("videoReviewRowsPage", () => {
  const row = (status: string) => ({
    _id: oid(), youtubeUrl: "https://youtu.be/x", classDate: "2026-10-01", timeLabel: "9:00",
    classLabel: "C3", room: "R1", teacherId: oid(), status, createdAt: new Date(),
  });

  test("PENDING first then newest class date, paged in the pipeline; names joined for the page", async () => {
    const r = row("PENDING");
    videoDocs = [r];
    mockUserFind.mockResolvedValue([{ _id: r.teacherId, name: "Rubina" }]);
    const page = await videoReviewRowsPage(null, { page: 2, pageSize: 5 });
    const pipeline = videoCalls.pipeline as Array<Record<string, unknown>>;
    expect(pipeline[0]).toEqual({ $match: { active: { $ne: false } } });
    expect(pipeline.find((s) => s.$sort)).toEqual({ $sort: { _pendingRank: 1, classDate: -1, _id: -1 } });
    expect(pipeline.find((s) => "$skip" in s)).toEqual({ $skip: 5 });
    expect(pipeline.find((s) => "$limit" in s)).toEqual({ $limit: 5 });
    expect(videoCalls.count).toEqual({ active: { $ne: false } });
    expect(page).toMatchObject({ total: 7, page: 2, pageSize: 5 });
    expect(page.rows[0].teacherName).toBe("Rubina");
  });

  test("the status filter runs on the server", async () => {
    videoDocs = [];
    mockUserFind.mockResolvedValue([]);
    await videoReviewRowsPage("NOT_OK", {});
    expect((videoCalls.pipeline as Array<Record<string, unknown>>)[0]).toEqual({
      $match: { active: { $ne: false }, status: "NOT_OK" },
    });
    expect(videoCalls.count).toEqual({ active: { $ne: false }, status: "NOT_OK" });
  });
});
