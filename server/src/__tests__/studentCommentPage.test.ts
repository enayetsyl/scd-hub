/**
 * D-#761 — the three student-comment lists page on the server:
 *   listSectionCommentsPage (the section worklist), myCommentsPage (the author's own
 *   comments, every one they ever wrote) and reviewInboxPage (the undelivered queue).
 *
 * Each must skip/limit in the database with a stable newest-first sort, count the same
 * filter, and join names for the page's rows only.
 *
 * DB-free (the repo convention): models are mocked.
 */
import mongoose from "mongoose";

const oid = (): mongoose.Types.ObjectId => new mongoose.Types.ObjectId();

const chain = { sort: jest.fn(), skip: jest.fn(), limit: jest.fn(), lean: jest.fn() };
const mockFind = jest.fn((_q: unknown) => chain);
const mockCount = jest.fn((_q: unknown) => Promise.resolve(0));
jest.mock("../modules/comments/models/StudentComment", () => ({
  StudentComment: {
    find: (q: unknown) => mockFind(q),
    countDocuments: (q: unknown) => mockCount(q),
  },
}));

const mockStudentFind = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: (q: unknown) => ({ select: () => ({ lean: () => mockStudentFind(q) }) }) },
}));
const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => ({ select: () => ({ lean: () => mockUserFind(q) }) }) },
}));
jest.mock("../modules/platform/models/StoredFile", () => ({ StoredFile: {} }));
jest.mock("../modules/platform/services/AuditService", () => ({ writeAudit: jest.fn() }));

import {
  listSectionCommentsPage,
  myCommentsPage,
  reviewInboxPage,
} from "../modules/comments/services/StudentCommentService";

const SECTION = oid();
const STUDENT = oid();
const AUTHOR = oid();

const comment = (): Record<string, unknown> => ({
  _id: oid(),
  studentId: STUDENT,
  sectionId: SECTION,
  authorUserId: AUTHOR,
  type: "academic",
  sentiment: "positive",
  text: "ভালো করেছে",
  attachmentIds: [],
  deliveredAt: null,
  deliveryChannels: [],
  discardedAt: null,
  discardReason: null,
  createdAt: new Date("2026-10-01T04:00:00Z"),
  updatedAt: new Date("2026-10-01T04:00:00Z"),
});

beforeEach(() => {
  jest.clearAllMocks();
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.lean.mockResolvedValue([]);
  mockStudentFind.mockResolvedValue([{ _id: STUDENT, name: "আয়েশা" }]);
  mockUserFind.mockResolvedValue([{ _id: AUTHOR, name: "রহিম" }]);
});

const STABLE_NEWEST_FIRST = { createdAt: -1, _id: -1 };

describe("listSectionCommentsPage", () => {
  test("one page of the section, newest first, with the section's total", async () => {
    chain.lean.mockResolvedValueOnce([comment()]);
    mockCount.mockResolvedValueOnce(312);

    const p = await listSectionCommentsPage(SECTION.toString(), { page: 4, pageSize: 50 });

    expect(mockFind).toHaveBeenCalledWith({ sectionId: SECTION });
    expect(mockCount).toHaveBeenCalledWith({ sectionId: SECTION });
    expect(chain.sort).toHaveBeenCalledWith(STABLE_NEWEST_FIRST);
    expect(chain.skip).toHaveBeenCalledWith(150);
    expect(chain.limit).toHaveBeenCalledWith(50);
    expect(p).toMatchObject({ total: 312, page: 4, pageSize: 50 });
    expect(p.rows[0]).toMatchObject({ studentId: STUDENT.toString(), text: "ভালো করেছে" });
  });
});

describe("myCommentsPage", () => {
  test("pins the caller as author and joins student names for the page only", async () => {
    chain.lean.mockResolvedValueOnce([comment()]);
    mockCount.mockResolvedValueOnce(1);

    const p = await myCommentsPage(AUTHOR.toString(), undefined, {});

    expect(mockFind).toHaveBeenCalledWith({ authorUserId: AUTHOR });
    expect(chain.sort).toHaveBeenCalledWith(STABLE_NEWEST_FIRST);
    expect(chain.limit).toHaveBeenCalledWith(50);
    expect(mockStudentFind).toHaveBeenCalledWith({ _id: { $in: [STUDENT.toString()] } });
    expect(p.rows[0]).toMatchObject({ studentName: "আয়েশা" });
  });

  test("narrows to one student when asked, and refuses a bad id", async () => {
    await myCommentsPage(AUTHOR.toString(), STUDENT.toString(), { page: 1 });
    expect(mockFind).toHaveBeenCalledWith({ authorUserId: AUTHOR, studentId: STUDENT });
    expect(() => myCommentsPage(AUTHOR.toString(), "nope", {})).toThrow("Invalid student id");
  });

  test("an empty page does not query names", async () => {
    const p = await myCommentsPage(AUTHOR.toString(), undefined, { page: 9 });
    expect(p.rows).toEqual([]);
    expect(mockStudentFind).not.toHaveBeenCalled();
  });
});

describe("reviewInboxPage", () => {
  test("the undelivered, undiscarded queue, one page, with child + author names", async () => {
    chain.lean.mockResolvedValueOnce([comment()]);
    mockCount.mockResolvedValueOnce(73);

    const p = await reviewInboxPage({ page: 2, pageSize: 25 });

    expect(mockFind).toHaveBeenCalledWith({ deliveredAt: null, discardedAt: null });
    expect(mockCount).toHaveBeenCalledWith({ deliveredAt: null, discardedAt: null });
    expect(chain.sort).toHaveBeenCalledWith(STABLE_NEWEST_FIRST);
    expect(chain.skip).toHaveBeenCalledWith(25);
    expect(chain.limit).toHaveBeenCalledWith(25);
    expect(p).toMatchObject({ total: 73, page: 2, pageSize: 25 });
    expect(p.rows[0]).toMatchObject({ studentName: "আয়েশা", authorName: "রহিম" });
  });
});
