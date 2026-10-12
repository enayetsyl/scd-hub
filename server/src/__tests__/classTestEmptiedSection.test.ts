/**
 * A class test whose SECTION has since been emptied (owner report 2026-10-04).
 *
 * WHY this exists: the 2026-10-01 boys/girls split moved every C4/C5 student out of
 * the combined sections and ended those sections' routine rows, which expired the
 * teachers' grants on them. Tamany's Science Test #4 (CT-C4-SCI-0004, sat 09-17,
 * no marks yet) then failed twice over: the read gate refused her ("Something went
 * wrong"), and even past it the roster — the section's CURRENT students — was empty.
 *
 * Covered here:
 *   roster — a populated section is unchanged; an emptied one falls back to the
 *            class's students, or to a merge snapshot's moves for a merge source;
 *            the roster rows then name each child's CURRENT section.
 *   count  — an emptied section counts that same roster (not 0 → "entered = complete"),
 *            bounded to children enrolled by the exam day (D-#722).
 *   authz  — the exam's own teacher passes read+write on an emptied section; another
 *            teacher does not; nobody passes on a section that still has students.
 *
 * DB-free (house convention): every model + cross-service is mocked.
 */
import mongoose from "mongoose";
import type { AppContext } from "../context";

const oid = () => new mongoose.Types.ObjectId();

const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

const mockStudentFind = jest.fn((_q?: unknown) => leanChain([]));
const mockStudentCount = jest.fn(async (_q?: unknown) => 0);
jest.mock("../modules/foundation/models/Student", () => ({
  Student: {
    find: (q: unknown) => mockStudentFind(q),
    countDocuments: (q: unknown) => mockStudentCount(q),
  },
}));
const mockMergeFindOne = jest.fn((_q?: unknown) => leanChain(null));
jest.mock("../modules/foundation/models/SectionMerge", () => ({
  SectionMerge: { findOne: (q: unknown) => mockMergeFindOne(q) },
}));
const mockSectionFind = jest.fn((_q?: unknown) => leanChain([]));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: (q: unknown) => mockSectionFind(q) },
}));
const mockClassFind = jest.fn((_q?: unknown) => leanChain([]));
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: (q: unknown) => mockClassFind(q) },
}));
jest.mock("../modules/routine/models/SubjectGroup", () => ({ SubjectGroup: { findById: jest.fn() } }));
jest.mock("../modules/routine/models/SubjectGroupMembership", () => ({
  SubjectGroupMembership: { find: () => leanChain([]) },
}));
jest.mock("../modules/trackers/subjectTeacher", () => ({
  teachesSubjectGroup: jest.fn(async () => false),
  teachesSectionSubject: jest.fn(async () => false),
}));
// SCIENCE has a `Subject` row, so a refused read never takes the routine-only path.
jest.mock("../modules/foundation/models/Subject", () => ({
  Subject: { findOne: () => leanChain({ _id: new (jest.requireActual("mongoose").Types.ObjectId)() }) },
}));
jest.mock("../modules/foundation/services/RoleScope", () => ({ isAdminStaff: () => false }));

const mockAssertCanRead = jest.fn();
const mockAssertCanWrite = jest.fn();
jest.mock("../middleware/authz", () => {
  class ForbiddenError extends Error {}
  return {
    ForbiddenError,
    assertCanRead: (...a: unknown[]) => mockAssertCanRead(...a),
    assertCanWrite: (...a: unknown[]) => mockAssertCanWrite(...a),
  };
});

import {
  assertAnchorRead,
  assertAnchorWrite,
  classTestRosterStudents,
  rosterCount,
  rosterStudentIds,
} from "../modules/trackers/classTestAnchor";
import { ForbiddenError } from "../middleware/authz";

const TAMANY = oid().toString();
const OTHER = oid().toString();
const SECTION = oid().toString();
const CLASS = oid().toString();
const BOYS = oid(), GIRLS = oid();

const EXAM = { sectionId: SECTION, classId: CLASS, subjectGroupId: null, subject: "SCIENCE", teacherId: TAMANY };
const ctxOf = (userId: string) => ({ auth: { userId, role: "TEACHER" } }) as unknown as AppContext;
const subjectId = async () => oid().toString();

beforeEach(() => {
  jest.clearAllMocks();
  mockStudentFind.mockImplementation(() => leanChain([]));
  mockStudentCount.mockImplementation(async () => 0);
  mockMergeFindOne.mockImplementation(() => leanChain(null));
  // The teacher's grant on the old section is gone — every scope check refuses.
  mockAssertCanRead.mockRejectedValue(new ForbiddenError());
  mockAssertCanWrite.mockRejectedValue(new ForbiddenError());
});

describe("roster of an exam whose section was emptied", () => {
  test("a populated section keeps its own students (unchanged)", async () => {
    const s1 = oid();
    mockStudentFind.mockImplementationOnce(() => leanChain([{ _id: s1 }]));
    expect(await rosterStudentIds(EXAM)).toEqual([s1.toString()]);
    expect(mockStudentFind).toHaveBeenCalledTimes(1);
    expect(mockMergeFindOne).not.toHaveBeenCalled();
  });

  test("a split section → the class's active students (who sat it before they moved)", async () => {
    const boy = oid(), girl = oid();
    mockStudentFind
      .mockImplementationOnce(() => leanChain([])) // the section itself: nobody left
      .mockImplementationOnce(() => leanChain([{ _id: boy }, { _id: girl }]));
    expect(await rosterStudentIds(EXAM)).toEqual([boy.toString(), girl.toString()]);
    const fallbackQuery = mockStudentFind.mock.calls[1][0] as Record<string, unknown>;
    expect(String(fallbackQuery.classId)).toBe(CLASS);
    expect(fallbackQuery.active).toBe(true);
  });

  test("a MERGE source section → exactly the students the merge moved out of it", async () => {
    const mine = oid(), fromOtherSource = oid();
    mockMergeFindOne.mockImplementation(() =>
      leanChain({
        moves: [
          { studentId: mine, fromSectionId: new mongoose.Types.ObjectId(SECTION) },
          { studentId: fromOtherSource, fromSectionId: oid() },
        ],
      }),
    );
    mockStudentFind
      .mockImplementationOnce(() => leanChain([]))
      .mockImplementationOnce(() => leanChain([{ _id: mine }]));
    await rosterStudentIds(EXAM);
    const fallbackQuery = mockStudentFind.mock.calls[1][0] as { _id: { $in: unknown[] }; classId?: unknown };
    expect(fallbackQuery._id.$in.map(String)).toEqual([mine.toString()]);
    expect(fallbackQuery.classId).toBeUndefined();
  });

  test("the fallback roster names each child's CURRENT section (বালক / বালিকা)", async () => {
    const boy = oid(), girl = oid();
    mockStudentFind
      .mockImplementationOnce(() => leanChain([]))
      .mockImplementationOnce(() => leanChain([{ _id: boy }, { _id: girl }]))
      .mockImplementationOnce(() =>
        leanChain([
          { _id: boy, schoolId: "101", name: "Boy", sectionId: BOYS },
          { _id: girl, schoolId: "102", name: "Girl", sectionId: GIRLS },
        ]),
      );
    const classOid = new mongoose.Types.ObjectId(CLASS);
    mockSectionFind.mockImplementation(() =>
      leanChain([
        { _id: BOYS, nameBn: "বালক", classId: classOid },
        { _id: GIRLS, nameBn: "বালিকা", classId: classOid },
      ]),
    );
    mockClassFind.mockImplementation(() => leanChain([{ _id: classOid, nameBn: "৪র্থ" }]));

    const rows = await classTestRosterStudents(EXAM);
    expect(rows.map((r) => r.sectionNameBn).sort()).toEqual(["৪র্থ · বালক", "৪র্থ · বালিকা"]);
  });
});

// D-#722: counting 0 here made the completion denominator fall back to the ENTERED count,
// so an exam half-marked when the class split read complete and left every chase list.
describe("completion denominator of an exam whose section was emptied", () => {
  const EXAM_DAY = "2026-09-17T00:00:00.000Z";
  test("counts the reconstructed roster, not 0", async () => {
    mockStudentFind.mockImplementationOnce(() =>
      leanChain([{ _id: BOYS, createdAt: new Date("2026-01-05") }, { _id: GIRLS, createdAt: new Date("2026-01-05") }]),
    );
    expect(await rosterCount({ ...EXAM, examDate: EXAM_DAY })).toBe(2);
  });

  test("a child admitted AFTER the exam day is not owed a mark", async () => {
    mockStudentFind.mockImplementationOnce(() =>
      leanChain([{ _id: BOYS, createdAt: new Date("2026-01-05") }, { _id: GIRLS, createdAt: new Date("2026-09-25") }]),
    );
    expect(await rosterCount({ ...EXAM, examDate: EXAM_DAY })).toBe(1);
    // ...and the marks screen lists the same children the denominator counts.
    mockStudentFind
      .mockImplementationOnce(() => leanChain([]))
      .mockImplementationOnce(() =>
        leanChain([{ _id: BOYS, createdAt: new Date("2026-01-05") }, { _id: GIRLS, createdAt: new Date("2026-09-25") }]),
      );
    expect(await rosterStudentIds({ ...EXAM, examDate: EXAM_DAY })).toEqual([BOYS.toString()]);
  });

  test("a populated section is still a plain count", async () => {
    mockStudentCount.mockImplementationOnce(async () => 7);
    expect(await rosterCount({ ...EXAM, examDate: EXAM_DAY })).toBe(7);
    expect(mockStudentFind).not.toHaveBeenCalled();
  });
});

describe("access to an exam whose section was emptied", () => {
  test("the exam's own teacher may read and write it", async () => {
    await expect(assertAnchorRead(ctxOf(TAMANY), EXAM)).resolves.toBeUndefined();
    await expect(
      assertAnchorWrite(ctxOf(TAMANY), EXAM, subjectId, "enter_classtest_result"),
    ).resolves.toBeUndefined();
  });

  test("another teacher is still refused", async () => {
    await expect(assertAnchorRead(ctxOf(OTHER), EXAM)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assertAnchorWrite(ctxOf(OTHER), EXAM, subjectId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("the exam's teacher is refused while the section still has students (a lost grant is real there)", async () => {
    mockStudentCount.mockImplementation(async () => 12);
    await expect(assertAnchorRead(ctxOf(TAMANY), EXAM)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assertAnchorWrite(ctxOf(TAMANY), EXAM, subjectId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("a normal grant passes without consulting the roster", async () => {
    mockAssertCanRead.mockResolvedValue(undefined);
    await expect(assertAnchorRead(ctxOf(OTHER), EXAM)).resolves.toBeUndefined();
    expect(mockStudentCount).not.toHaveBeenCalled();
  });
});
