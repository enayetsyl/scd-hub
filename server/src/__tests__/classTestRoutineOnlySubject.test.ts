/**
 * A SECTION-anchored class test in a subject with no `Subject` row (owner report
 * 2026-10-11: Sajeda, Nursery Arabic — "Subject not found: ARABIC").
 *
 * WHY this exists: ARABIC and QURAN have no `Subject` row (D-#521/#530), so their
 * routine slots bind no teaching grant. The class-test gate resolved the subject id
 * BEFORE checking scope and threw on the missing row — every Arabic exam filed under
 * a section (Nursery..C3 teach Arabic as a section period) failed before it started.
 * Group-anchored Arabic exams never looked the subject up, so they worked.
 *
 * Covered here: subjectIdOrNull returns null instead of throwing; the write gate then
 * asks the ROUTINE (the teacher named on that section × subject passes, others do
 * not, Principal passes, Office/Guardian are refused); the read gate falls back the
 * same way; a subject that HAS a row still goes through the grant check only.
 *
 * DB-free (house convention): every model + cross-service is mocked.
 */
import mongoose from "mongoose";
import type { AppContext } from "../context";

const oid = () => new mongoose.Types.ObjectId();

const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.lean = async () => val;
  return o;
};

const mockSubjectFindOne = jest.fn((_q?: unknown) => leanChain(null));
jest.mock("../modules/foundation/models/Subject", () => ({
  Subject: { findOne: (q: unknown) => mockSubjectFindOne(q) },
}));
const mockTeachesSection = jest.fn(async (..._a: unknown[]) => false);
jest.mock("../modules/trackers/subjectTeacher", () => ({
  teachesSubjectGroup: jest.fn(async () => false),
  teachesSectionSubject: (...a: unknown[]) => mockTeachesSection(...a),
}));
// The section is populated, so the emptied-section owner escape never applies.
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { countDocuments: async () => 20, find: () => leanChain([]) },
}));
jest.mock("../modules/foundation/models/SectionMerge", () => ({ SectionMerge: { findOne: () => leanChain(null) } }));
jest.mock("../modules/foundation/models/Section", () => ({ Section: { find: () => leanChain([]) } }));
jest.mock("../modules/foundation/models/Class", () => ({ Class: { find: () => leanChain([]) } }));
jest.mock("../modules/routine/models/SubjectGroup", () => ({ SubjectGroup: { findById: jest.fn() } }));
jest.mock("../modules/routine/models/SubjectGroupMembership", () => ({
  SubjectGroupMembership: { find: () => leanChain([]) },
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

import { assertAnchorRead, assertAnchorWrite, subjectIdOrNull } from "../modules/trackers/classTestAnchor";
import { ForbiddenError } from "../middleware/authz";

const SAJEDA = oid().toString();
const OTHER = oid().toString();
const NURSERY = oid().toString();
const NURSERY_CLASS = oid().toString();

const EXAM = { sectionId: NURSERY, classId: NURSERY_CLASS, subjectGroupId: null, subject: "ARABIC" };
const ctxOf = (userId: string, role = "TEACHER") => ({ auth: { userId, role } }) as unknown as AppContext;
const arabicId = () => subjectIdOrNull("ARABIC");

beforeEach(() => {
  jest.clearAllMocks();
  mockSubjectFindOne.mockImplementation(() => leanChain(null));
  // The routine names Sajeda — and only Sajeda — on Nursery × ARABIC.
  mockTeachesSection.mockImplementation(async (teacherId) => teacherId === SAJEDA);
  // Arabic slots bind no grant, so Sajeda holds nothing on Nursery.
  mockAssertCanRead.mockRejectedValue(new ForbiddenError());
  mockAssertCanWrite.mockRejectedValue(new ForbiddenError());
});

describe("subjectIdOrNull", () => {
  test("a code with no Subject row → null, not a thrown 'Subject not found'", async () => {
    await expect(subjectIdOrNull("ARABIC")).resolves.toBeNull();
  });

  test("a code with a row → its id", async () => {
    const id = oid();
    mockSubjectFindOne.mockImplementation(() => leanChain({ _id: id }));
    await expect(subjectIdOrNull("SCI")).resolves.toBe(id.toString());
  });
});

describe("write gate on a section-anchored ARABIC exam", () => {
  test("the teacher the routine names on this section × subject may file it", async () => {
    await expect(assertAnchorWrite(ctxOf(SAJEDA), EXAM, arabicId)).resolves.toBeUndefined();
    expect(mockTeachesSection).toHaveBeenCalledWith(SAJEDA, NURSERY, "ARABIC");
    expect(mockAssertCanWrite).not.toHaveBeenCalled();
  });

  test("a teacher the routine does not name is refused", async () => {
    await expect(assertAnchorWrite(ctxOf(OTHER), EXAM, arabicId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("roles mirror assertCanWrite: Principal passes, Office and Guardian are refused", async () => {
    await expect(assertAnchorWrite(ctxOf(OTHER, "PRINCIPAL"), EXAM, arabicId)).resolves.toBeUndefined();
    await expect(assertAnchorWrite(ctxOf(OTHER, "OFFICE"), EXAM, arabicId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assertAnchorWrite(ctxOf(SAJEDA, "GUARDIAN"), EXAM, arabicId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mockTeachesSection).not.toHaveBeenCalled();
  });

  test("a subject WITH a row never consults the routine (grants stay the authority, WC-7)", async () => {
    const sci = { ...EXAM, subject: "SCI" };
    mockSubjectFindOne.mockImplementation(() => leanChain({ _id: oid() }));
    await expect(assertAnchorWrite(ctxOf(SAJEDA), sci, () => subjectIdOrNull("SCI"))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mockTeachesSection).not.toHaveBeenCalled();
  });
});

describe("read gate on a section-anchored ARABIC exam", () => {
  test("the routine's teacher may read it with no grant on the section", async () => {
    await expect(assertAnchorRead(ctxOf(SAJEDA), EXAM)).resolves.toBeUndefined();
  });

  test("another teacher is still refused", async () => {
    await expect(assertAnchorRead(ctxOf(OTHER), EXAM)).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("a subject WITH a row never falls back to the routine", async () => {
    mockSubjectFindOne.mockImplementation(() => leanChain({ _id: oid() }));
    await expect(assertAnchorRead(ctxOf(SAJEDA), { ...EXAM, subject: "SCI" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mockTeachesSection).not.toHaveBeenCalled();
  });

  test("a normal grant passes without touching Subject or the routine", async () => {
    mockAssertCanRead.mockResolvedValue(undefined);
    await expect(assertAnchorRead(ctxOf(OTHER), EXAM)).resolves.toBeUndefined();
    expect(mockSubjectFindOne).not.toHaveBeenCalled();
    expect(mockTeachesSection).not.toHaveBeenCalled();
  });
});
