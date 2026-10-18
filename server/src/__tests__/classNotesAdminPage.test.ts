/**
 * D-#761 — the Principal/Office class-note list pages on the server.
 *
 * `classNotesAdmin` returns the whole date window (30 days ≈ 1,500 enriched notes) and
 * the screen filtered class / teacher / subject in memory. `classNotesAdminPage` must
 * apply the same window, run those filters in the database (class level widens to that
 * level's sections; teacher is a display NAME), page with skip/limit + a stable sort,
 * and count the same filter. `classNotesAdminOptions` lists the values in the window.
 *
 * DB-free (the repo convention): models are mocked.
 */
import mongoose from "mongoose";

const oid = (): mongoose.Types.ObjectId => new mongoose.Types.ObjectId();

const mockNoteFind = jest.fn();
const mockNoteCount = jest.fn();
const mockNoteDistinct = jest.fn();
jest.mock("../modules/routine/models/ClassNote", () => ({
  ClassNote: {
    find: (query: unknown) => ({
      sort: (sort: unknown) => ({
        skip: (skip: number) => ({
          limit: (limit: number) => ({ lean: () => mockNoteFind({ query, sort, skip, limit }) }),
        }),
      }),
    }),
    countDocuments: (query: unknown) => mockNoteCount(query),
    distinct: (field: string, query: unknown) => mockNoteDistinct(field, query),
  },
}));

const mockSectionFind = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: (query: unknown) => ({ select: () => ({ lean: () => mockSectionFind(query) }) }) },
}));
const mockClassFind = jest.fn();
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: (query: unknown) => ({ select: () => ({ lean: () => mockClassFind(query) }) }) },
}));
jest.mock("../modules/routine/models/SubjectGroup", () => ({
  SubjectGroup: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
}));
const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (query: unknown) => ({ select: () => ({ lean: () => mockUserFind(query) }) }) },
}));
jest.mock("../modules/platform/models/StoredFile", () => ({
  StoredFile: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
}));

import { classNotesAdminPage, classNotesAdminOptions } from "../modules/routine/services/RoutineTriggerService";

const CLASS_ID = oid();
const SECTION_A = oid();
const SECTION_B = oid();
const TEACHER = oid();

beforeEach(() => {
  jest.clearAllMocks();
  mockNoteFind.mockResolvedValue([]);
  mockNoteCount.mockResolvedValue(0);
  mockNoteDistinct.mockResolvedValue([]);
  mockSectionFind.mockResolvedValue([]);
  mockClassFind.mockResolvedValue([]);
  mockUserFind.mockResolvedValue([]);
});

describe("classNotesAdminPage", () => {
  test("pages the window in the database, newest first with a stable tiebreak, and counts the same filter", async () => {
    mockNoteCount.mockResolvedValue(1498);
    mockNoteFind.mockResolvedValue([
      {
        _id: oid(),
        slotId: oid(),
        groupType: "section",
        groupId: SECTION_A,
        date: new Date(2026, 9, 10),
        subject: "BAN",
        taughtSummaryBn: "পড়ানো হয়েছে",
        publishedBy: TEACHER,
        publishedAt: new Date(2026, 9, 10, 10),
      },
    ]);
    mockSectionFind.mockResolvedValue([{ _id: SECTION_A, classId: CLASS_ID, code: "A", nameBn: "ক" }]);
    mockClassFind.mockResolvedValue([{ _id: CLASS_ID, level: 4, nameBn: "চতুর্থ" }]);
    mockUserFind.mockResolvedValue([{ _id: TEACHER, name: "রহিম" }]);

    const page = await classNotesAdminPage({
      date: new Date(2026, 8, 19, 15, 0),
      dateTo: new Date(2026, 9, 18, 2, 0),
      page: 2,
    });

    const call = mockNoteFind.mock.calls[0][0] as {
      query: { date: { $gte: Date; $lte: Date } };
      sort: unknown;
      skip: number;
      limit: number;
    };
    expect(call.query.date.$gte).toEqual(new Date(2026, 8, 19, 0, 0, 0, 0));
    expect(call.query.date.$lte).toEqual(new Date(2026, 9, 18, 23, 59, 59, 999));
    expect(call.sort).toEqual({ publishedAt: -1, _id: -1 });
    expect(call).toMatchObject({ skip: 50, limit: 50 });
    expect(mockNoteCount).toHaveBeenCalledWith(call.query);
    expect(page).toMatchObject({ total: 1498, page: 2, pageSize: 50 });
    expect(page.rows[0]).toMatchObject({ classLevel: 4, authorName: "রহিম", sectionNameBn: "ক" });
  });

  test("a reversed window is read the right way round", async () => {
    await classNotesAdminPage({ date: new Date(2026, 9, 18), dateTo: new Date(2026, 9, 12) });
    const { query } = mockNoteFind.mock.calls[0][0] as { query: { date: { $gte: Date; $lte: Date } } };
    expect(query.date.$gte).toEqual(new Date(2026, 9, 12, 0, 0, 0, 0));
    expect(query.date.$lte).toEqual(new Date(2026, 9, 18, 23, 59, 59, 999));
  });

  test("class level widens to that level's sections; teacher is matched by name; subject as given", async () => {
    mockClassFind.mockResolvedValue([{ _id: CLASS_ID }]);
    mockSectionFind.mockResolvedValue([{ _id: SECTION_A }, { _id: SECTION_B }]);
    mockUserFind.mockResolvedValue([{ _id: TEACHER }]);

    await classNotesAdminPage({ date: new Date(2026, 9, 18), classLevel: 4, teacherName: "রহিম", subject: "BAN" });

    expect(mockClassFind).toHaveBeenCalledWith({ level: 4 });
    expect(mockSectionFind).toHaveBeenCalledWith({ classId: { $in: [CLASS_ID] } });
    expect(mockUserFind).toHaveBeenCalledWith({ name: "রহিম" });
    const { query } = mockNoteFind.mock.calls[0][0] as { query: Record<string, unknown> };
    expect(query).toMatchObject({
      subject: "BAN",
      groupType: "section",
      groupId: { $in: [SECTION_A, SECTION_B] },
      publishedBy: { $in: [TEACHER] },
    });
  });

  test("an unknown teacher name matches nothing rather than dropping the filter", async () => {
    await classNotesAdminPage({ date: new Date(2026, 9, 18), teacherName: "নেই" });
    const { query } = mockNoteFind.mock.calls[0][0] as { query: Record<string, unknown> };
    expect(query.publishedBy).toEqual({ $in: [] });
  });

  test("pageSize is clamped", async () => {
    const page = await classNotesAdminPage({ date: new Date(2026, 9, 18), pageSize: 9999 });
    expect(page.pageSize).toBe(200);
  });
});

describe("classNotesAdminOptions", () => {
  test("lists the class levels, teacher names and subjects present in the window", async () => {
    mockNoteDistinct.mockImplementation((field: string) => {
      if (field === "subject") return Promise.resolve(["ENG", "BAN", "BAN"]);
      if (field === "publishedBy") return Promise.resolve([TEACHER]);
      return Promise.resolve([SECTION_A]);
    });
    mockUserFind.mockResolvedValue([{ name: "রহিম" }]);
    mockSectionFind.mockResolvedValue([{ classId: CLASS_ID }]);
    mockClassFind.mockResolvedValue([{ level: 4 }]);

    const opts = await classNotesAdminOptions({ date: new Date(2026, 9, 12), dateTo: new Date(2026, 9, 18) });

    expect(mockNoteDistinct).toHaveBeenCalledWith("groupId", expect.objectContaining({ groupType: "section" }));
    expect(opts).toEqual({ classLevels: [4], teachers: ["রহিম"], subjects: ["BAN", "ENG"] });
  });
});
