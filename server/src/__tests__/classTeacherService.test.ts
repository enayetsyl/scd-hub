/**
 * CT-1 tests — ClassTeacherService (assign + support + append-only log, D-#53).
 *
 * CT1.1/CT1.6 — assignClassTeacher sets/clears + appends a class_teacher log row
 * CT1.5/CT1.6 — setSupportTeacher adds/removes (no dup) + appends a support log row
 * CT1.2      — mySectionsAsClassTeacher returns the caller's sections
 *
 * DB-free: Section/User/ClassTeacherAssignment mocked.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const mockSectionFindById = jest.fn();
const mockSectionFind = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: {
    findById: (id: unknown) => mockSectionFindById(id),
    find: (q: unknown) => ({ lean: () => mockSectionFind(q) }),
  },
}));

const mockUserFindById = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { findById: (id: unknown) => ({ lean: () => mockUserFindById(id) }) },
}));

const mockLogCreate = jest.fn();
jest.mock("../modules/foundation/models/ClassTeacherAssignment", () => ({
  ClassTeacherAssignment: {
    create: (d: unknown) => mockLogCreate(d),
    find: () => ({ sort: () => ({ lean: () => [] }) }),
  },
}));

import {
  assignClassTeacher,
  setSupportTeacher,
  mySectionsAsClassTeacher,
} from "../modules/foundation/services/ClassTeacherService";

function makeSection(over: Record<string, unknown> = {}) {
  const doc: Record<string, unknown> = { _id: oid(), classTeacherId: undefined, supportTeacherIds: [], ...over };
  doc.save = jest.fn().mockResolvedValue(doc);
  doc.lean = jest.fn().mockResolvedValue(doc);
  return doc;
}

const ACTOR = oid().toString();
const SECTION = oid().toString();

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindById.mockResolvedValue({ role: "TEACHER" });
});

describe("CT1.1/CT1.6 assignClassTeacher", () => {
  test("assigns a TEACHER and appends an 'assigned' class_teacher log row", async () => {
    const doc = makeSection();
    mockSectionFindById.mockReturnValue(doc);
    const teacher = oid().toString();
    await assignClassTeacher(SECTION, teacher, ACTOR);
    expect((doc.save as jest.Mock)).toHaveBeenCalled();
    expect(doc.classTeacherId?.toString()).toBe(teacher);
    expect(mockLogCreate).toHaveBeenCalledTimes(1);
    expect(mockLogCreate.mock.calls[0][0]).toMatchObject({ role: "class_teacher", op: "assigned" });
  });

  test("clearing (userId null) logs a 'cleared' row and unsets the field", async () => {
    const doc = makeSection({ classTeacherId: oid() });
    mockSectionFindById.mockReturnValue(doc);
    await assignClassTeacher(SECTION, null, ACTOR);
    expect(doc.classTeacherId).toBeUndefined();
    expect(mockLogCreate.mock.calls[0][0]).toMatchObject({ role: "class_teacher", op: "cleared" });
  });

  test("rejects a non-TEACHER assignee", async () => {
    mockSectionFindById.mockReturnValue(makeSection());
    mockUserFindById.mockResolvedValue({ role: "OFFICE" });
    await expect(assignClassTeacher(SECTION, oid().toString(), ACTOR)).rejects.toThrow(/TEACHER/);
    expect(mockLogCreate).not.toHaveBeenCalled();
  });
});

describe("CT1.5/CT1.6 setSupportTeacher", () => {
  test("adds a support teacher (no duplicate) and logs 'assigned'", async () => {
    const doc = makeSection({ supportTeacherIds: [] });
    mockSectionFindById.mockReturnValue(doc);
    const t = oid().toString();
    await setSupportTeacher(SECTION, t, true, ACTOR);
    expect((doc.supportTeacherIds as unknown[]).length).toBe(1);
    // re-adding the same teacher does not duplicate
    await setSupportTeacher(SECTION, t, true, ACTOR);
    expect((doc.supportTeacherIds as unknown[]).length).toBe(1);
    expect(mockLogCreate.mock.calls[0][0]).toMatchObject({ role: "support", op: "assigned" });
  });

  test("removes a support teacher and logs 'removed'", async () => {
    const t = oid();
    const doc = makeSection({ supportTeacherIds: [t] });
    mockSectionFindById.mockReturnValue(doc);
    await setSupportTeacher(SECTION, t.toString(), false, ACTOR);
    expect((doc.supportTeacherIds as unknown[]).length).toBe(0);
    expect(mockLogCreate.mock.calls[0][0]).toMatchObject({ role: "support", op: "removed" });
  });
});

describe("CT1.2 mySectionsAsClassTeacher", () => {
  test("returns the caller's sections", async () => {
    mockSectionFind.mockResolvedValue([{ _id: oid() }, { _id: oid() }]);
    const rows = await mySectionsAsClassTeacher(oid().toString());
    expect(rows).toHaveLength(2);
  });
});
