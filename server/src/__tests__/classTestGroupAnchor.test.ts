/**
 * Class test anchored on a SUBJECT GROUP — D-#507 (prd-tracker-class-test §CT-12).
 *
 * WHY this exists: Arabic is taught both ways at this school — 12 active
 * section-shaped periods and 25 group-shaped ones across 5 cross-class groups whose
 * members come from 2–4 different CLASSES each. A `ClassTest` required a `sectionId`
 * and counted the section's roster, so a group exam could only be filed by pretending
 * it belonged to one section: the marks screen would then list children who never
 * attend that Arabic group and offer no way to reach the members from other sections.
 * Hence the second anchor.
 *
 * Covered here:
 *   createRequest  — a group anchor stores subjectGroupId with classLevel/classId/
 *                    sectionId NULL, mints `CT-G-{CODE}-{nnnn}` off its own sequence,
 *                    takes the year from the CURRENT AcademicYear, and attributes the
 *                    exam via the GROUP's routine slot.
 *   refusals       — both anchors / neither; a Quran-track group (D-#36); a retired
 *                    group; copies-per-present (no class to count); a duplicate Test #
 *                    on the same GROUP while the same number on a section is fine.
 *   roster         — the denominator is the group's ACTIVE membership, never a section.
 *   authz          — PRINCIPAL yes, OFFICE no, the group's routine teacher yes, another
 *                    teacher no (teacher scopes are section grants and cannot answer).
 *
 * DB-free (house convention): every model + cross-service is mocked.
 */
import mongoose from "mongoose";
import type { AppContext } from "../context";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.limit = () => o;
  o.lean = async () => val;
  return o;
};

const mockSeqUpdate = jest.fn();
jest.mock("../modules/trackers/models/ClassTestSequence", () => ({
  ClassTestSequence: { findOneAndUpdate: (...a: unknown[]) => mockSeqUpdate(...a) },
}));

const mockGroupSeqUpdate = jest.fn();
jest.mock("../modules/trackers/models/ClassTestGroupSequence", () => ({
  ClassTestGroupSequence: { findOneAndUpdate: (...a: unknown[]) => mockGroupSeqUpdate(...a) },
}));

const mockCtCreate = jest.fn();
const mockCtFindOne = jest.fn();
jest.mock("../modules/trackers/models/ClassTest", () => ({
  ClassTest: {
    create: (a: unknown) => mockCtCreate(a),
    findById: () => leanChain(null),
    findOne: (q: unknown) => mockCtFindOne(q),
    find: () => leanChain([]),
    updateOne: async () => ({}),
  },
}));

jest.mock("../modules/trackers/models/ClassTestResult", () => ({
  ClassTestResult: { countDocuments: async () => 0, find: () => leanChain([]) },
}));

const mockCreatePrintRequest = jest.fn();
jest.mock("../modules/printing/services/PrintRequestService", () => ({
  createPrintRequest: (i: unknown) => mockCreatePrintRequest(i),
}));
jest.mock("../modules/printing/models/PrintRequest", () => ({
  PrintRequest: { updateOne: async () => ({}) },
}));

const mockSectionFindById = jest.fn();
const mockSectionFind = jest.fn((_q?: unknown) => leanChain([]));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: {
    findById: (id: unknown) => mockSectionFindById(id),
    find: (...a: unknown[]) => mockSectionFind(...(a as [])),
  },
}));

const mockClassFindById = jest.fn();
const mockClassFind = jest.fn((_q?: unknown) => leanChain([]));
jest.mock("../modules/foundation/models/Class", () => ({
  Class: {
    findById: (id: unknown) => mockClassFindById(id),
    find: (...a: unknown[]) => mockClassFind(...(a as [])),
  },
}));

const mockYearFindOne = jest.fn();
jest.mock("../modules/foundation/models/AcademicYear", () => ({
  AcademicYear: { findOne: (q: unknown) => mockYearFindOne(q) },
}));

const mockGroupFindById = jest.fn();
jest.mock("../modules/routine/models/SubjectGroup", () => ({
  SubjectGroup: { findById: (id: unknown) => mockGroupFindById(id), find: () => leanChain([]) },
}));

const mockMembershipFind = jest.fn((_q?: unknown) => leanChain([]));
jest.mock("../modules/routine/models/SubjectGroupMembership", () => ({
  SubjectGroupMembership: {
    find: (...a: unknown[]) => mockMembershipFind(...(a as [])),
    findOne: () => leanChain(null),
  },
}));

const mockStudentFind = jest.fn((_q?: unknown) => leanChain([]));
const mockStudentCount = jest.fn(async (_q?: unknown) => 0);
jest.mock("../modules/foundation/models/Student", () => ({
  Student: {
    find: (...a: unknown[]) => mockStudentFind(...(a as [])),
    countDocuments: (q: unknown) => mockStudentCount(q),
  },
}));

const mockSetFindById = jest.fn();
jest.mock("../modules/assessment/models/AssessmentSet", () => ({
  AssessmentSet: { findById: (id: unknown) => mockSetFindById(id) },
}));

const mockStoredFindById = jest.fn();
jest.mock("../modules/platform/models/StoredFile", () => ({
  StoredFile: { findById: (id: unknown) => ({ lean: () => mockStoredFindById(id) }) },
}));

const mockSlotFind = jest.fn((_q?: unknown) => leanChain([]));
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (...a: unknown[]) => mockSlotFind(...(a as [])) },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

jest.mock("../modules/foundation/models/User", () => ({
  User: { findById: () => ({ select: () => ({ lean: async () => ({ name: "শিক্ষক" }) }) }) },
}));

// Import AFTER mocks
import { createRequest, generateGroupCtId } from "../modules/trackers/services/ClassTestService";
import {
  assertAnchorWrite,
  rosterCount,
  rosterStudentIds,
} from "../modules/trackers/classTestAnchor";
import { ForbiddenError } from "../middleware/authz";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEACHER_ID = oid().toString();
const OTHER_TEACHER_ID = oid().toString();
const AY_OID = oid();
const GROUP_OID = oid();
const SECTION_OID = oid();
const CLASS_OID = oid();
const FILE_OID = oid();

const arabicGroup = {
  _id: GROUP_OID,
  code: "ARABIC_BOOK_2_GIRLS",
  track: "arabic",
  nameBn: "আরবি বই ২ (মেয়ে)",
  active: true,
};

const ctxOf = (userId: string, role: string) =>
  ({ auth: { userId, role } }) as unknown as AppContext;

/** An uploaded paper owned by the requesting teacher (the group path's only source). */
const paperInput = {
  subject: "ARABIC",
  examDate: "2026-08-20",
  totalMarks: 20,
  source: "UPLOADED_PAPER",
  questionFileId: FILE_OID.toString(),
  skipPrint: true,
  actorId: TEACHER_ID,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockYearFindOne.mockReturnValue(leanChain({ _id: AY_OID }));
  mockGroupFindById.mockReturnValue(leanChain(arabicGroup));
  mockSectionFindById.mockReturnValue(leanChain({ classId: CLASS_OID }));
  mockClassFindById.mockReturnValue(leanChain({ level: 3, academicYearId: AY_OID }));
  mockStoredFindById.mockResolvedValue({ kind: "classtest_question", uploadedBy: TEACHER_ID });
  mockCtFindOne.mockReturnValue(leanChain(null)); // no duplicate, no prior test number
  mockGroupSeqUpdate.mockResolvedValue({ seq: 1 });
  mockSeqUpdate.mockResolvedValue({ seq: 1 });
  mockSlotFind.mockReturnValue(leanChain([]));
  mockCtCreate.mockImplementation(async (doc: Record<string, unknown>) => ({
    _id: oid(),
    ...doc,
    createdAt: new Date("2026-08-17T00:00:00Z"),
    updatedAt: new Date("2026-08-17T00:00:00Z"),
  }));
});

// ===========================================================================
// The id scheme
// ===========================================================================

describe("generateGroupCtId (D-#507)", () => {
  test("mints CT-G-{CODE}-{nnnn} off the group's own year sequence", async () => {
    mockGroupSeqUpdate.mockResolvedValue({ seq: 7 });
    const id = await generateGroupCtId(AY_OID.toString(), GROUP_OID.toString(), "ARABIC_BOOK_2_GIRLS");
    expect(id).toBe("CT-G-ARABIC_BOOK_2_GIRLS-0007");
    // Keyed by (year, group) — NOT by subject, so an id can never repeat.
    expect(mockGroupSeqUpdate).toHaveBeenCalledWith(
      { academicYearId: AY_OID.toString(), subjectGroupId: GROUP_OID.toString() },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
  });

  test("normalises a code that carries spaces or lower case", async () => {
    mockGroupSeqUpdate.mockResolvedValue({ seq: 1 });
    const id = await generateGroupCtId(AY_OID.toString(), GROUP_OID.toString(), " arabic book 1 mixed ");
    expect(id).toBe("CT-G-ARABIC_BOOK_1_MIXED-0001");
  });
});

// ===========================================================================
// createRequest — the group anchor
// ===========================================================================

describe("createRequest with a subject-group anchor (D-#507)", () => {
  test("stores the group, leaves section/class NULL, and takes the CURRENT year", async () => {
    const res = await createRequest({ ...paperInput, subjectGroupId: GROUP_OID.toString() });

    expect(res.subjectGroupId).toBe(GROUP_OID.toString());
    expect(res.sectionId).toBeNull();
    expect(res.classId).toBeNull();
    expect(res.classLevel).toBeNull();
    expect(res.ctId).toBe("CT-G-ARABIC_BOOK_2_GIRLS-0001");
    expect(res.academicYearId).toBe(AY_OID.toString());
    // The section-shaped derivation must NOT run — there is no section to read.
    expect(mockSectionFindById).not.toHaveBeenCalled();
    expect(mockSeqUpdate).not.toHaveBeenCalled(); // the section sequence is untouched
  });

  test("attributes the exam to the teacher the GROUP's routine names", async () => {
    mockSlotFind.mockReturnValue(
      leanChain([
        {
          groupType: "subjectgroup",
          groupId: GROUP_OID,
          subject: "ARABIC",
          dayOfWeek: "THU",
          periodNumber: 2,
          teacherId: OTHER_TEACHER_ID,
          effectiveFrom: new Date(2026, 0, 1),
        },
      ]),
    );

    const res = await createRequest({ ...paperInput, subjectGroupId: GROUP_OID.toString() });

    // 2026-08-20 is a Thursday, so the slot above is the cell's live slot.
    expect(res.teacherId).toBe(OTHER_TEACHER_ID);
    // It asked the routine about a SUBJECTGROUP unit, not a section.
    const q = mockSlotFind.mock.calls[0][0] as { groupType: unknown; groupId: unknown };
    expect(q.groupType).toBe("subjectgroup");
  });

  test("falls back to the requester when the group's routine names nobody", async () => {
    const res = await createRequest({ ...paperInput, subjectGroupId: GROUP_OID.toString() });
    expect(res.teacherId).toBe(TEACHER_ID);
  });

  test("refuses BOTH anchors and refuses NEITHER", async () => {
    await expect(
      createRequest({ ...paperInput, sectionId: SECTION_OID.toString(), subjectGroupId: GROUP_OID.toString() }),
    ).rejects.toThrow(/exactly one of sectionId or subjectGroupId/i);
    await expect(createRequest({ ...paperInput })).rejects.toThrow(
      /exactly one of sectionId or subjectGroupId/i,
    );
    expect(mockCtCreate).not.toHaveBeenCalled();
  });

  test("refuses a QURAN-track group — Quran is out of this subject axis (D-#36)", async () => {
    mockGroupFindById.mockReturnValue(
      leanChain({ ...arabicGroup, track: "quran", code: "QURAN_HIFZ_1_MIXED" }),
    );
    await expect(
      createRequest({ ...paperInput, subject: "ARABIC", subjectGroupId: GROUP_OID.toString() }),
    ).rejects.toThrow(/Only an Arabic subject group/i);
    expect(mockCtCreate).not.toHaveBeenCalled();
  });

  test("refuses a retired group and a missing group", async () => {
    mockGroupFindById.mockReturnValue(leanChain({ ...arabicGroup, active: false }));
    await expect(
      createRequest({ ...paperInput, subjectGroupId: GROUP_OID.toString() }),
    ).rejects.toThrow(/retired/i);

    mockGroupFindById.mockReturnValue(leanChain(null));
    await expect(
      createRequest({ ...paperInput, subjectGroupId: GROUP_OID.toString() }),
    ).rejects.toThrow(/Subject group not found/i);
  });

  test("refuses copies-per-present: a cross-class group has no class to count", async () => {
    await expect(
      createRequest({
        ...paperInput,
        skipPrint: false,
        colour: "BW",
        sides: "SINGLE",
        copiesMode: "CLASS_PRESENT",
        subjectGroupId: GROUP_OID.toString(),
      }),
    ).rejects.toThrow(/Copies-per-present needs a class/i);
  });

  test("the duplicate guard is keyed by the GROUP, not by a section", async () => {
    await createRequest({ ...paperInput, subjectGroupId: GROUP_OID.toString(), testNumber: 3 });
    const guardQuery = mockCtFindOne.mock.calls[0][0] as Record<string, unknown>;
    expect(guardQuery.subjectGroupId).toEqual(GROUP_OID);
    expect(guardQuery.sectionId).toBeUndefined();
    expect(guardQuery.testNumber).toBe(3);
  });

  test("a duplicate Test # on the same group is refused", async () => {
    mockCtFindOne.mockReturnValue(
      leanChain({ ctId: "CT-G-ARABIC_BOOK_2_GIRLS-0001", examDate: new Date("2026-08-01"), status: "PRINTED" }),
    );
    await expect(
      createRequest({ ...paperInput, subjectGroupId: GROUP_OID.toString(), testNumber: 1 }),
    ).rejects.toThrow(/already exists/i);
  });

  test("a section-anchored request is unchanged by all of this", async () => {
    const res = await createRequest({ ...paperInput, sectionId: SECTION_OID.toString(), subject: "BAN" });
    expect(res.sectionId).toBe(SECTION_OID.toString());
    expect(res.subjectGroupId).toBeNull();
    expect(res.classLevel).toBe(3);
    expect(res.ctId).toBe("CT-C3-BAN-0001"); // the section id scheme, section sequence
    expect(mockGroupSeqUpdate).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// The roster — the whole point of the anchor
// ===========================================================================

describe("roster resolution (D-#507)", () => {
  const A = oid();
  const B = oid();
  const C = oid();

  test("a group exam's roster is the group's ACTIVE members, from any section", () => {
    mockMembershipFind.mockReturnValue(leanChain([{ studentId: A }, { studentId: B }, { studentId: C }]));
    // C has left the school — an inactive student is not on the roster.
    mockStudentFind.mockReturnValue(leanChain([{ _id: A }, { _id: B }]));

    return rosterStudentIds({
      sectionId: null,
      classId: null,
      subjectGroupId: GROUP_OID.toString(),
      subject: "ARABIC",
    }).then((ids) => {
      expect(ids.sort()).toEqual([A.toString(), B.toString()].sort());
      // It never asked for a section roster.
      expect(mockStudentCount).not.toHaveBeenCalled();
    });
  });

  test("an empty group yields an empty roster, with no student query at all", async () => {
    mockMembershipFind.mockReturnValue(leanChain([]));
    const ids = await rosterStudentIds({
      sectionId: null,
      classId: null,
      subjectGroupId: GROUP_OID.toString(),
      subject: "ARABIC",
    });
    expect(ids).toEqual([]);
    expect(mockStudentFind).not.toHaveBeenCalled();
  });

  test("a section exam still counts the SECTION's active students", async () => {
    mockStudentCount.mockResolvedValue(24);
    const n = await rosterCount({
      sectionId: SECTION_OID.toString(),
      classId: CLASS_OID.toString(),
      subjectGroupId: null,
      subject: "BAN",
    });
    expect(n).toBe(24);
    expect(mockStudentCount).toHaveBeenCalledWith({ sectionId: SECTION_OID.toString(), active: true });
    expect(mockMembershipFind).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Authz — a section grant cannot answer for a cross-class group
// ===========================================================================

describe("assertAnchorWrite on a group exam (D-#507)", () => {
  const groupTest = {
    sectionId: null,
    classId: null,
    subjectGroupId: GROUP_OID.toString(),
    subject: "ARABIC",
  };
  const subjectId = async () => oid().toString();

  test("PRINCIPAL passes; OFFICE and GUARDIAN are refused", async () => {
    await expect(
      assertAnchorWrite(ctxOf(oid().toString(), "PRINCIPAL"), groupTest, subjectId),
    ).resolves.toBeUndefined();
    await expect(
      assertAnchorWrite(ctxOf(oid().toString(), "OFFICE"), groupTest, subjectId),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      assertAnchorWrite(ctxOf(oid().toString(), "GUARDIAN"), groupTest, subjectId),
    ).rejects.toThrow(ForbiddenError);
  });

  test("the teacher the routine names on that group passes", async () => {
    mockSlotFind.mockReturnValue(leanChain([{ _id: oid() }]));
    await expect(
      assertAnchorWrite(ctxOf(TEACHER_ID, "TEACHER"), groupTest, subjectId),
    ).resolves.toBeUndefined();
    const q = mockSlotFind.mock.calls[0][0] as Record<string, unknown>;
    expect(q).toMatchObject({
      groupType: "subjectgroup",
      groupId: GROUP_OID.toString(),
      subject: "ARABIC",
      teacherId: TEACHER_ID,
      active: true,
    });
  });

  test("a teacher the routine does NOT name on that group is refused", async () => {
    mockSlotFind.mockReturnValue(leanChain([])); // no slot for this teacher
    await expect(
      assertAnchorWrite(ctxOf(OTHER_TEACHER_ID, "TEACHER"), groupTest, subjectId),
    ).rejects.toThrow(ForbiddenError);
  });
});
