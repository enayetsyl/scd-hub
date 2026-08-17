/**
 * Class-note archive tests (owner ask 2026-08-17) — the filtered, paginated list
 * behind the "All class notes" screen.
 *
 * What matters here is the SLICE the query asks mongo for: a class filter has to
 * widen to that class's sections (a note stores its section, not its class), the
 * date window has to include both ends, the page has to skip/limit rather than
 * fetch-then-slice, and a teacher's `publishedBy` pin has to survive. Plus the
 * author gate on editing: only the note's own author, or routine:manage.
 */
import mongoose from "mongoose";

const oid = (): mongoose.Types.ObjectId => new mongoose.Types.ObjectId();

const mockNoteFind = jest.fn();
const mockNoteCount = jest.fn();
const mockNoteById = jest.fn();
const mockNoteUpdate = jest.fn();
const mockNoteDistinct = jest.fn();
jest.mock("../modules/routine/models/ClassNote", () => ({
  ClassNote: {
    find: (query: unknown) => ({
      sort: () => ({
        skip: (skip: number) => ({
          limit: (limit: number) => ({ lean: () => mockNoteFind({ query, skip, limit }) }),
        }),
      }),
      // classNotesAdmin's un-paginated shape (find → sort → lean).
      lean: () => mockNoteFind({ query, skip: 0, limit: 0 }),
    }),
    countDocuments: (query: unknown) => mockNoteCount(query),
    findById: (id: unknown) => ({ select: () => ({ lean: () => mockNoteById(id) }) }),
    findByIdAndUpdate: (id: unknown, update: unknown) => ({ lean: () => mockNoteUpdate(id, update) }),
    distinct: (field: string, query: unknown) => mockNoteDistinct(field, query),
  },
}));

const mockSectionFind = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: (query: unknown) => ({ select: () => ({ lean: () => mockSectionFind(query) }) }) },
}));

const mockClassFind = jest.fn();
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: () => ({ select: () => ({ lean: () => mockClassFind() }) }) },
}));

const mockSubjectGroupFind = jest.fn();
jest.mock("../modules/routine/models/SubjectGroup", () => ({
  SubjectGroup: { find: () => ({ select: () => ({ lean: () => mockSubjectGroupFind() }) }) },
}));

const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: () => ({ select: () => ({ lean: () => mockUserFind() }) }) },
}));

const mockFileFind = jest.fn();
jest.mock("../modules/platform/models/StoredFile", () => ({
  StoredFile: { find: () => ({ select: () => ({ lean: () => mockFileFind() }) }) },
}));

import {
  classNotePage,
  classNoteFilterOptions,
  updateClassNote,
} from "../modules/routine/services/RoutineTriggerService";

const CLASS_ID = oid();
const SECTION_A = oid();
const SECTION_B = oid();
const TEACHER = oid();
const OTHER_TEACHER = oid();

/** One stored note, as `.lean()` hands it back. */
const note = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  _id: oid(),
  slotId: oid(),
  groupType: "section",
  groupId: SECTION_A,
  date: new Date(2026, 7, 10, 9, 0, 0),
  subject: "BAN",
  taughtSummaryBn: "পড়ানো হয়েছে",
  publishedBy: TEACHER,
  publishedAt: new Date(2026, 7, 10, 10, 0, 0),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockNoteFind.mockResolvedValue([]);
  mockNoteCount.mockResolvedValue(0);
  mockSectionFind.mockResolvedValue([]);
  mockClassFind.mockResolvedValue([]);
  mockSubjectGroupFind.mockResolvedValue([]);
  mockUserFind.mockResolvedValue([]);
  mockFileFind.mockResolvedValue([]);
  mockNoteDistinct.mockResolvedValue([]);
});

describe("classNotePage", () => {
  test("pages server-side (skip/limit) and reports the total behind the page", async () => {
    mockNoteFind.mockResolvedValue([note()]);
    mockNoteCount.mockResolvedValue(137);
    mockSectionFind.mockResolvedValue([{ _id: SECTION_A, classId: CLASS_ID, code: "A", nameBn: "ক" }]);
    mockClassFind.mockResolvedValue([{ _id: CLASS_ID, level: 4, nameBn: "চতুর্থ" }]);
    mockUserFind.mockResolvedValue([{ _id: TEACHER, name: "রহিম" }]);

    const page = await classNotePage({ page: 3 });

    expect(mockNoteFind).toHaveBeenCalledWith(expect.objectContaining({ skip: 100, limit: 50 }));
    expect(page.total).toBe(137);
    expect(page.page).toBe(3);
    expect(page.pageSize).toBe(50);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({
      classLevel: 4,
      sectionId: SECTION_A.toString(),
      classId: CLASS_ID.toString(),
      authorId: TEACHER.toString(),
      authorName: "রহিম",
    });
  });

  test("a class filter widens to that class's sections", async () => {
    mockSectionFind.mockResolvedValue([{ _id: SECTION_A }, { _id: SECTION_B }]);

    await classNotePage({ classId: CLASS_ID.toString() });

    const { query } = mockNoteFind.mock.calls[0][0] as { query: Record<string, unknown> };
    expect(query.groupType).toBe("section");
    expect(query.groupId).toEqual({ $in: [SECTION_A, SECTION_B] });
    // The count must see the SAME filter, or the pager lies about how many pages exist.
    expect(mockNoteCount).toHaveBeenCalledWith(query);
  });

  test("an explicit section beats the class filter, and the teacher pin survives", async () => {
    await classNotePage({ classId: CLASS_ID.toString(), sectionId: SECTION_B.toString(), teacherId: TEACHER.toString() });

    const { query } = mockNoteFind.mock.calls[0][0] as { query: Record<string, unknown> };
    expect(query.groupId).toEqual(SECTION_B);
    expect(query.publishedBy).toEqual(TEACHER);
    // No section lookup is needed when the section is named outright.
    expect(mockSectionFind).not.toHaveBeenCalledWith(expect.objectContaining({ classId: CLASS_ID.toString() }));
  });

  test("the date window includes both end days in full", async () => {
    await classNotePage({ from: new Date(2026, 7, 1, 13, 30), to: new Date(2026, 7, 5, 2, 0) });

    const { query } = mockNoteFind.mock.calls[0][0] as { query: { date: { $gte: Date; $lte: Date } } };
    expect(query.date.$gte).toEqual(new Date(2026, 7, 1, 0, 0, 0, 0));
    expect(query.date.$lte).toEqual(new Date(2026, 7, 5, 23, 59, 59, 999));
  });

  test("a filter id that is not an ObjectId matches nothing instead of everything", async () => {
    await classNotePage({ teacherId: "not-an-id" });

    const { query } = mockNoteFind.mock.calls[0][0] as { query: { publishedBy: mongoose.Types.ObjectId } };
    expect(query.publishedBy).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(query.publishedBy.toString()).not.toBe("not-an-id");
  });

  test("pageSize is clamped, so a client cannot ask for the whole archive at once", async () => {
    const page = await classNotePage({ pageSize: 5000, page: 0 });
    expect(page.pageSize).toBe(200);
    expect(page.page).toBe(1);
    expect(mockNoteFind).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, limit: 200 }));
  });
});

describe("classNoteFilterOptions", () => {
  test("offers only the values present in the caller's own slice", async () => {
    mockNoteDistinct.mockImplementation((field: string) => {
      if (field === "subject") return Promise.resolve(["ENG", "BAN"]);
      if (field === "publishedBy") return Promise.resolve([TEACHER]);
      return Promise.resolve([SECTION_A]);
    });
    mockSectionFind.mockResolvedValue([{ _id: SECTION_A, classId: CLASS_ID, code: "A", nameBn: "ক" }]);
    mockClassFind.mockResolvedValue([{ _id: CLASS_ID, level: 4, nameBn: "চতুর্থ" }]);
    mockUserFind.mockResolvedValue([{ _id: TEACHER, name: "রহিম" }]);

    const opts = await classNoteFilterOptions({ teacherId: TEACHER.toString() });

    expect(mockNoteDistinct).toHaveBeenCalledWith("subject", expect.objectContaining({ publishedBy: TEACHER }));
    expect(opts.subjects).toEqual(["BAN", "ENG"]);
    expect(opts.classes).toEqual([{ id: CLASS_ID.toString(), label: "চতুর্থ" }]);
    expect(opts.sections).toEqual([{ id: SECTION_A.toString(), label: "ক", parentId: CLASS_ID.toString() }]);
    expect(opts.teachers).toEqual([{ id: TEACHER.toString(), label: "রহিম" }]);
  });
});

describe("updateClassNote author gate", () => {
  test("a teacher may edit the note they authored", async () => {
    const id = oid();
    mockNoteById.mockResolvedValue({ publishedBy: TEACHER });
    mockNoteUpdate.mockResolvedValue({ _id: id, taughtSummaryBn: "নতুন" });

    await expect(
      updateClassNote({ id: id.toString(), taughtSummaryBn: "নতুন", actorId: TEACHER.toString(), canManage: false }),
    ).resolves.toMatchObject({ taughtSummaryBn: "নতুন" });
    expect(mockNoteUpdate).toHaveBeenCalled();
  });

  test("a teacher may NOT edit somebody else's note", async () => {
    mockNoteById.mockResolvedValue({ publishedBy: OTHER_TEACHER });

    await expect(
      updateClassNote({ id: oid().toString(), taughtSummaryBn: "নতুন", actorId: TEACHER.toString(), canManage: false }),
    ).rejects.toThrow(/your own class note/i);
    expect(mockNoteUpdate).not.toHaveBeenCalled();
  });

  test("routine:manage edits any note without an ownership lookup", async () => {
    const id = oid();
    mockNoteUpdate.mockResolvedValue({ _id: id, taughtSummaryBn: "নতুন" });

    await updateClassNote({ id: id.toString(), taughtSummaryBn: "নতুন", actorId: OTHER_TEACHER.toString(), canManage: true });

    expect(mockNoteById).not.toHaveBeenCalled();
    expect(mockNoteUpdate).toHaveBeenCalled();
  });
});
