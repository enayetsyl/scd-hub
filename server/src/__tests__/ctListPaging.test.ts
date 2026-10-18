/**
 * D-#761 — the class-test lists that grew without bound, now paged:
 *
 *   ctQuestionQueuePage / myCtQuestionRequestsPage — the same status order as the
 *     unpaged lists, walked bucket by bucket so a page never reads finished rows it
 *     does not show; teacher names joined for the page only.
 *   myClassTestsPage — a plain queryPage over the caller's own tests.
 *   classTestReportsStatus(examFrom, examTo) — the exam set bounded by Dhaka days in
 *     the database; omitted = every date, exactly as before.
 *
 * DB-free (repo convention): the models are in-memory fakes.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Fake ClassTestQuestionRequest: enough of find/countDocuments for the bucket walk.
// ---------------------------------------------------------------------------
type Doc = Record<string, unknown> & { _id: mongoose.Types.ObjectId; status: string; requestedAt: Date };
let mockReqDocs: Doc[] = [];
const mockReqFinds: Array<{ filter: Record<string, unknown>; skip: number; limit: number }> = [];

function mockMatches(d: Doc, f: Record<string, unknown>): boolean {
  if (f.active && d.active === false) return false;
  if (f.requestedBy && String(d.requestedBy) !== String(f.requestedBy)) return false;
  const s = f.status as string | { $nin: string[] } | undefined;
  if (typeof s === "string" && d.status !== s) return false;
  if (s && typeof s === "object" && s.$nin.includes(d.status)) return false;
  return true;
}

jest.mock("../modules/trackers/models/ClassTestQuestionRequest", () => {
  const actual = jest.requireActual("../modules/trackers/models/ClassTestQuestionRequest");
  return {
    CT_QUESTION_STATUSES: actual.CT_QUESTION_STATUSES,
    CT_QUESTION_EDITABLE: actual.CT_QUESTION_EDITABLE,
    CT_QUESTION_CANCELLABLE: actual.CT_QUESTION_CANCELLABLE,
    ClassTestQuestionRequest: {
      countDocuments: async (f: Record<string, unknown>) => mockReqDocs.filter((d) => mockMatches(d, f)).length,
      find: (f: Record<string, unknown>) => {
        const call = { filter: f, skip: 0, limit: Infinity };
        const chain = {
          sort: () => chain,
          skip: (n: number) => ((call.skip = n), chain),
          limit: (n: number) => ((call.limit = n), chain),
          lean: async () => {
            mockReqFinds.push(call);
            return mockReqDocs
              .filter((d) => mockMatches(d, f))
              .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())
              .slice(call.skip, call.skip + call.limit);
          },
        };
        return chain;
      },
    },
  };
});

const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => ({ select: () => ({ lean: async () => mockUserFind(q) }) }) },
}));

// ---------------------------------------------------------------------------
// Fake ClassTest: records the filter/sort/skip/limit it was asked for.
// ---------------------------------------------------------------------------
const mockCtCalls: Record<string, unknown>[] = [];
let mockCtRows: unknown[] = [];
let mockCtCount = 0;
jest.mock("../modules/trackers/models/ClassTest", () => ({
  ClassTest: {
    find: (filter: unknown) => {
      const call: Record<string, unknown> = { filter };
      mockCtCalls.push(call);
      const chain = {
        sort: (s: unknown) => ((call.sort = s), chain),
        skip: (n: number) => ((call.skip = n), chain),
        limit: (n: number) => ((call.limit = n), chain),
        select: () => chain,
        lean: async () => mockCtRows,
      };
      return chain;
    },
    countDocuments: async (filter: unknown) => {
      mockCtCalls.push({ count: filter });
      return mockCtCount;
    },
  },
}));

import {
  ctQuestionQueuePage,
  myCtQuestionRequestsPage,
} from "../modules/trackers/services/ClassTestQuestionService";
import { listMyClassTestsPage } from "../modules/trackers/services/ClassTestService";
import { reportsStatus } from "../modules/trackers/services/ClassTestSummaryService";

const TEACHER_A = oid();
const TEACHER_B = oid();

function req(status: string, day: number, over: Record<string, unknown> = {}): Doc {
  return {
    _id: oid(),
    status,
    requestedAt: new Date(2026, 6, day),
    requestedBy: TEACHER_A,
    academicYearId: oid(),
    classLevel: 3,
    classId: oid(),
    sectionId: oid(),
    subject: "MATH",
    chapter: "১",
    testNumber: day,
    totalMarks: 20,
    durationMinutes: 30,
    examDate: new Date(2026, 6, day + 3),
    rounds: [],
    ...over,
  };
}

beforeEach(() => {
  mockReqFinds.length = 0;
  mockCtCalls.length = 0;
  mockUserFind.mockReset();
  mockUserFind.mockImplementation(async (q: { _id: { $in: string[] } }) =>
    q._id.$in.map((id) => ({ _id: new mongoose.Types.ObjectId(id), name: id === String(TEACHER_A) ? "Nuha" : "Rubina" })),
  );
});

describe("ctQuestionQueuePage (D-#761)", () => {
  beforeEach(() => {
    mockReqDocs = [
      req("CONFIRMED", 1),
      req("REQUESTED", 2),
      req("CANCELLED", 3),
      req("REQUESTED", 4, { requestedBy: TEACHER_B }),
      req("IN_REVIEW", 5),
      req("CHANGES_REQUESTED", 6),
      req("PRINT_REQUESTED", 7),
      req("REQUESTED", 8, { active: false }), // soft-deleted: never listed, never counted
    ];
  });

  test("work-needed first, newest first inside a status; total counts every live row", async () => {
    const p = await ctQuestionQueuePage({ page: 1, pageSize: 50 });
    expect(p.total).toBe(7);
    expect(p.rows.map((r) => `${r.status}:${r.testNumber}`)).toEqual([
      "REQUESTED:4",
      "REQUESTED:2",
      "CHANGES_REQUESTED:6",
      "IN_REVIEW:5",
      "CONFIRMED:1",
      "PRINT_REQUESTED:7",
      "CANCELLED:3",
    ]);
    expect(p.rows[0].requesterName).toBe("Rubina");
    expect(p.rows[1].requesterName).toBe("Nuha");
  });

  test("a page spanning buckets skips into the first and stops early in the last", async () => {
    const p = await ctQuestionQueuePage({ page: 2, pageSize: 3 });
    expect(p).toMatchObject({ page: 2, pageSize: 3, total: 7 });
    expect(p.rows.map((r) => `${r.status}:${r.testNumber}`)).toEqual(["IN_REVIEW:5", "CONFIRMED:1", "PRINT_REQUESTED:7"]);
    // Only the buckets this page touches were read, each for just its share.
    expect(mockReqFinds.map((c) => [c.filter.status, c.skip, c.limit])).toEqual([
      ["IN_REVIEW", 0, 1],
      ["CONFIRMED", 0, 1],
      ["PRINT_REQUESTED", 0, 1],
    ]);
  });

  test("the page past the end is empty with the total intact", async () => {
    const p = await ctQuestionQueuePage({ page: 3, pageSize: 5 });
    expect(p.rows).toEqual([]);
    expect(p.total).toBe(7);
  });

  test("names are joined for this page's teachers only", async () => {
    await ctQuestionQueuePage({ page: 2, pageSize: 3 });
    expect(mockUserFind.mock.calls[0][0]._id.$in).toEqual([String(TEACHER_A)]);
  });

  test("a status outside the order still lists, last", async () => {
    mockReqDocs.push(req("SOMETHING_NEW", 9));
    const p = await ctQuestionQueuePage({ page: 1, pageSize: 50 });
    expect(p.total).toBe(8);
    expect(p.rows[p.rows.length - 1].status).toBe("SOMETHING_NEW");
  });
});

describe("myCtQuestionRequestsPage (D-#761)", () => {
  test("only the caller's own live rows, in the teacher's action-needed order", async () => {
    mockReqDocs = [
      req("REQUESTED", 1),
      req("IN_REVIEW", 2),
      req("CONFIRMED", 3),
      req("IN_REVIEW", 4, { requestedBy: TEACHER_B }),
      req("CANCELLED", 5),
      req("IN_REVIEW", 6, { active: false }),
    ];
    const p = await myCtQuestionRequestsPage(String(TEACHER_A), { page: 1, pageSize: 2 });
    expect(p.total).toBe(4);
    expect(p.rows.map((r) => `${r.status}:${r.testNumber}`)).toEqual(["IN_REVIEW:2", "REQUESTED:1"]);
    const p2 = await myCtQuestionRequestsPage(String(TEACHER_A), { page: 2, pageSize: 2 });
    expect(p2.rows.map((r) => `${r.status}:${r.testNumber}`)).toEqual(["CONFIRMED:3", "CANCELLED:5"]);
    // The teacher's own list carries no requester name, like the unpaged one.
    expect(p.rows[0].requesterName).toBeNull();
    expect(mockUserFind).not.toHaveBeenCalled();
  });
});

describe("myClassTestsPage (D-#761)", () => {
  test("teacher OR requester, newest first with an _id tie-break, skip/limit in the DB", async () => {
    mockCtRows = [];
    mockCtCount = 123;
    const p = await listMyClassTestsPage("u1", { page: 3, pageSize: 50 });
    expect(p).toEqual({ rows: [], total: 123, page: 3, pageSize: 50 });
    expect(mockCtCalls[0]).toEqual({
      filter: { $or: [{ teacherId: "u1" }, { requestedBy: "u1" }] },
      sort: { requestedAt: -1, _id: -1 },
      skip: 100,
      limit: 50,
    });
    expect(mockCtCalls[1]).toEqual({ count: { $or: [{ teacherId: "u1" }, { requestedBy: "u1" }] } });
  });
});

describe("classTestReportsStatus exam-date window (D-#761)", () => {
  beforeEach(() => {
    mockCtRows = []; // no exams → reportsStatus returns before any other read
  });

  test("omitted = no date bound (every released bundle's behaviour)", async () => {
    await reportsStatus({});
    expect(mockCtCalls[0].filter).toEqual({ status: "PRINTED" });
  });

  test("both ends → whole Dhaka days, inclusive", async () => {
    await reportsStatus({ examFrom: "2026-07-01", examTo: "2026-07-31" });
    const f = mockCtCalls[0].filter as { examDate: { $gte: Date; $lt: Date } };
    expect(f.examDate.$gte.toISOString()).toBe("2026-06-30T18:00:00.000Z"); // 1 Jul 00:00 Dhaka
    expect(f.examDate.$lt.toISOString()).toBe("2026-07-31T18:00:00.000Z"); // 1 Aug 00:00 Dhaka
    // An exam stored at UTC midnight of the last day is inside the window.
    expect(new Date("2026-07-31").getTime()).toBeLessThan(f.examDate.$lt.getTime());
  });

  test("one end only leaves the other open", async () => {
    await reportsStatus({ examFrom: "2026-07-01" });
    expect(mockCtCalls[0].filter).toEqual({
      status: "PRINTED",
      examDate: { $gte: new Date("2026-06-30T18:00:00.000Z") },
    });
  });

  test("a malformed key is refused, not silently ignored", async () => {
    await expect(reportsStatus({ examTo: "31/07/2026" })).rejects.toThrow(/YYYY-MM-DD/);
  });
});
