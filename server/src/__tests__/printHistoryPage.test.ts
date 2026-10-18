/**
 * D-#761 — the print screens, PAGED.
 *
 *   1. printHistoryPage — every document reachable (no scan cap), same rows/order as
 *      printHistory, `total` the real count, the Office teacher chip row-level, and only
 *      the page's representatives loaded in full
 *   2. printHistoryFacets — chip options from the whole window, not one page
 *   3. myPrintRequestsPage — in-flight vs past, newest first with an _id tie-break
 *
 * DB-free (repo convention): the PrintRequest + Class models are mocked; the grouping is real.
 */
import mongoose from "mongoose";

const mockScan = jest.fn();
const mockFullLoad = jest.fn();
const mockCount = jest.fn();
/** Every find() the service ran: its filter and the chain it asked for. */
const mockFinds: Array<{ q: Record<string, any>; select?: unknown; sort?: unknown; skip?: unknown; limit?: unknown }> = [];

jest.mock("../modules/printing/models/PrintRequest", () => ({
  PrintRequest: {
    countDocuments: (q: unknown) => Promise.resolve(mockCount(q)),
    find: (q: Record<string, any>) => {
      const rec: (typeof mockFinds)[number] = { q };
      mockFinds.push(rec);
      const chain: Record<string, unknown> = {};
      chain.select = (s: unknown) => { rec.select = s; return chain; };
      chain.sort = (s: unknown) => { rec.sort = s; return chain; };
      chain.skip = (n: unknown) => { rec.skip = n; return chain; };
      chain.limit = (n: unknown) => { rec.limit = n; return chain; };
      // A `_id: { $in }` read is the page's full-document load; anything else is a scan.
      chain.lean = () => Promise.resolve(q._id?.$in ? mockFullLoad(q._id.$in) : mockScan(q));
      return chain;
    },
  },
}));
const mockClassFind = jest.fn().mockResolvedValue([]);
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: (q: unknown) => ({ select: () => ({ lean: () => mockClassFind(q) }) }) },
}));
// Loaded by the service module but unused on these paths.
jest.mock("../modules/attendance/services/AttendanceReportService", () => ({}));
jest.mock("../modules/realtime/bus", () => ({ publishRealtime: jest.fn() }));
jest.mock("../modules/platform/services/AuditService", () => ({ writeAudit: jest.fn() }));
jest.mock("../modules/assessment/models/AssessmentSet", () => ({ AssessmentSet: {} }));
jest.mock("../modules/content/models/ContentArtifact", () => ({ ContentArtifact: {} }));
jest.mock("../modules/platform/models/StoredFile", () => ({ StoredFile: {} }));
jest.mock("../modules/notifications/services/emitters", () => ({
  emitPrintDelivered: jest.fn(),
  emitPrintRequested: jest.fn(),
}));
jest.mock("../modules/foundation/models/User", () => ({ User: {} }));
jest.mock("../modules/foundation/models/Section", () => ({ Section: {} }));
jest.mock("../modules/trackers/models/ClassTest", () => ({ ClassTest: {} }));

import {
  printHistory,
  printHistoryPage,
  printHistoryFacets,
  myPrintRequestsPage,
  PRINT_HISTORY_SCAN_CAP,
  PrintRequestError,
} from "../modules/printing/services/PrintRequestService";

const oid = () => new mongoose.Types.ObjectId();
const TEACHER = oid().toString();
const OTHER = oid().toString();

const histDoc = (over: Record<string, unknown> = {}): any => ({
  _id: oid(),
  title: "Worksheet",
  purpose: "HOMEWORK",
  sourceType: "UPLOAD",
  fileIds: [oid()],
  status: "PRINTED",
  requestedBy: new mongoose.Types.ObjectId(TEACHER),
  requestedAt: new Date("2026-07-01T04:00:00Z"),
  printedAt: new Date("2026-07-01T05:00:00Z"),
  ...over,
});

/** `n` distinct documents, newest first, one minute apart. */
const docs = (n: number, over: Record<string, unknown> = {}) =>
  Array.from({ length: n }, (_, i) =>
    histDoc({ printedAt: new Date(Date.UTC(2026, 6, 1, 5, 0) - i * 60_000), ...over }),
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockFinds.length = 0;
  mockClassFind.mockResolvedValue([]);
  // The full load hands back the scanned doc with its title marked, so a test can see
  // the row's `latest` was replaced by the FULL document.
  mockFullLoad.mockImplementation((ids: mongoose.Types.ObjectId[]) =>
    ids.map((id) => ({ _id: id, title: `full ${id.toString()}` })),
  );
});

describe("printHistoryPage — every document reachable", () => {
  test("no scan cap: a history longer than PRINT_HISTORY_SCAN_CAP is read whole", async () => {
    mockScan.mockResolvedValue(docs(PRINT_HISTORY_SCAN_CAP + 5));
    const page = await printHistoryPage({}, { page: 1, pageSize: 50 });
    const scan = mockFinds[0];
    expect(scan.limit).toBeUndefined();
    expect(page.total).toBe(PRINT_HISTORY_SCAN_CAP + 5);
    expect(page.rows).toHaveLength(50);
  });

  test("the scan projects to the grouping fields and sorts stably", async () => {
    mockScan.mockResolvedValue([]);
    await printHistoryPage({}, {});
    expect(String(mockFinds[0].select)).toContain("fileIds");
    expect(String(mockFinds[0].select)).not.toContain("title");
    expect(mockFinds[0].sort).toEqual({ printedAt: -1, requestedAt: -1, _id: -1 });
  });

  test("pages through the same order as printHistory, no row twice, none lost", async () => {
    const all = docs(7);
    mockScan.mockResolvedValue(all);
    const p1 = await printHistoryPage({}, { page: 1, pageSize: 3 });
    const p2 = await printHistoryPage({}, { page: 2, pageSize: 3 });
    const p3 = await printHistoryPage({}, { page: 3, pageSize: 3 });
    const paged = [...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.key);
    expect(new Set(paged).size).toBe(7);
    expect([p1.total, p2.total, p3.total]).toEqual([7, 7, 7]);
    expect(p3.rows).toHaveLength(1);

    const old = await printHistory();
    expect(paged).toEqual(old.rows.map((r) => r.key));
  });

  test("only the page's representatives are loaded in full", async () => {
    mockScan.mockResolvedValue(docs(5));
    const page = await printHistoryPage({}, { page: 1, pageSize: 2 });
    const full = mockFinds.find((f) => f.q._id?.$in);
    expect(full?.q._id.$in).toHaveLength(2);
    expect(page.rows[0].latest.title).toBe(`full ${page.rows[0].latest._id.toString()}`);
  });

  test("an empty page skips the full load", async () => {
    mockScan.mockResolvedValue([]);
    const page = await printHistoryPage({}, {});
    expect(page).toMatchObject({ rows: [], total: 0, page: 1 });
    expect(mockFullLoad).not.toHaveBeenCalled();
  });

  test("class/subject/purpose filters go to the database query, like printHistory's", async () => {
    mockScan.mockResolvedValue([]);
    const cls = oid().toString();
    await printHistoryPage({ classId: cls, subject: "BAN", purpose: "HOMEWORK", requestedBy: TEACHER }, {});
    const q = mockFinds[0].q;
    expect(q).toMatchObject({ status: { $in: ["PRINTED", "DELIVERED"] }, subject: "BAN", purpose: "HOMEWORK" });
    expect(q.requestedBy.toString()).toBe(TEACHER);
    expect(q.$and[0].$or[0].classId.toString()).toBe(cls);
  });

  test("printedBy keeps every document that person printed at least once — whole rows", async () => {
    const shared = oid();
    mockScan.mockResolvedValue([
      // One document printed by both: the row stays whole (count 2) under either chip.
      histDoc({ fileIds: [shared] }),
      histDoc({ fileIds: [shared], requestedBy: new mongoose.Types.ObjectId(OTHER) }),
      histDoc({ fileIds: [oid()] }), // the teacher's alone
    ]);
    const page = await printHistoryPage({ printedBy: OTHER }, {});
    expect(page.total).toBe(1);
    expect(page.rows[0].printCount).toBe(2);
    // Row-level, not a job filter: the query itself is not narrowed to OTHER.
    expect(mockFinds[0].q.requestedBy).toBeUndefined();
  });

  test("rejects a malformed printedBy and the same bad input printHistory rejects", async () => {
    await expect(printHistoryPage({ printedBy: "nope" }, {})).rejects.toThrow(PrintRequestError);
    await expect(printHistoryPage({ purpose: "NONSENSE" }, {})).rejects.toThrow(PrintRequestError);
    await expect(printHistoryPage({ fromKey: "2026-07-31", toKey: "2026-07-01" }, {})).rejects.toThrow(/not be after/);
  });
});

describe("printHistoryFacets — chip options from the whole window", () => {
  test("options span every document, not a page; only scope + window reach the query", async () => {
    const c1 = oid(), c3 = oid();
    mockScan.mockResolvedValue([
      histDoc({ classId: c3, subject: "MATH", purpose: "CLASSWORK", printedAt: new Date("2026-07-20T05:00:00Z") }),
      histDoc({ classId: c1, subject: "BAN", purpose: "HOMEWORK", requestedBy: new mongoose.Types.ObjectId(OTHER) }),
      histDoc({ classId: null, subject: null, purpose: "OTHER" }),
    ]);
    mockClassFind.mockResolvedValue([{ _id: c1, level: 1 }, { _id: c3, level: 3 }]);

    const f = await printHistoryFacets({ requestedBy: null, fromKey: "2026-07-01", toKey: null });
    expect(f.subjects).toEqual(["BAN", "MATH"]);
    // Most recently printed first.
    expect(f.purposes).toEqual(["CLASSWORK", "HOMEWORK", "OTHER"]);
    expect(f.classes).toEqual(
      expect.arrayContaining([{ classId: c1.toString(), classLevel: 1 }, { classId: c3.toString(), classLevel: 3 }]),
    );
    expect(f.hasNoClass).toBe(true);
    expect(f.requesterIds.sort()).toEqual([TEACHER, OTHER].sort());

    const q = mockFinds[0].q;
    expect(q.subject).toBeUndefined();
    expect(q.purpose).toBeUndefined();
    expect(q.$and).toHaveLength(1); // the date window only
  });

  test("a teacher's facets are their own prints only", async () => {
    mockScan.mockResolvedValue([]);
    await printHistoryFacets({ requestedBy: TEACHER });
    expect(mockFinds[0].q.requestedBy.toString()).toBe(TEACHER);
  });
});

describe("myPrintRequestsPage — the teacher's own list, paged", () => {
  test("in flight = REQUESTED/PRINTED, newest first with an _id tie-break", async () => {
    mockScan.mockResolvedValue([{ _id: oid() }]);
    mockCount.mockReturnValue(31);
    const page = await myPrintRequestsPage(TEACHER, true, { page: 2, pageSize: 25 });
    const f = mockFinds[0];
    expect(f.q.requestedBy.toString()).toBe(TEACHER);
    expect(f.q.status).toEqual({ $in: ["REQUESTED", "PRINTED"] });
    expect(f.sort).toEqual({ requestedAt: -1, _id: -1 });
    expect([f.skip, f.limit]).toEqual([25, 25]);
    expect(page).toMatchObject({ total: 31, page: 2, pageSize: 25 });
    expect(page.rows).toHaveLength(1);
  });

  test("past = everything else; omitted = all", async () => {
    mockScan.mockResolvedValue([]);
    mockCount.mockReturnValue(0);
    await myPrintRequestsPage(TEACHER, false, {});
    expect(mockFinds[0].q.status).toEqual({ $nin: ["REQUESTED", "PRINTED"] });
    await myPrintRequestsPage(TEACHER, null, {});
    expect(mockFinds[1].q.status).toBeUndefined();
  });
});
