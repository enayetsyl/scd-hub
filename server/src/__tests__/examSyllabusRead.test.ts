/**
 * Exam-syllabus READ tests (SY-6, docs/prd-exam-syllabus.md §6).
 *
 * Scoping — Principal/Office see every status; a teacher sees PUBLISHED rows plus
 *           placeholders for their OWN not-yet-published subjects; a guardian sees
 *           their linked child's class, PUBLISHED only, and the predicate is applied
 *           in the guardian resolver itself rather than delegated to a role branch.
 * Detail  — an unpublished row is refused to anyone but Principal/Office, so a
 *           hand-typed deep link cannot reach a draft.
 * Derived — written/oral is summed from the rows (D-#85), never stored.
 * Inbox   — mySyllabusApprovals returns [] rather than throwing for a caller with
 *           none: the drawer badge reads it on every render (the 791e5fe rule).
 *
 * DB-free (repo convention): models + the guardian gate are mocked.
 */
import mongoose from "mongoose";
import type { AppContext } from "../context";

const oid = () => new mongoose.Types.ObjectId();

const CLASS = oid();
const EXAM = oid();
const TEACHER_ID = oid().toString();

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSyllabusFind = jest.fn();
const mockSyllabusFindOne = jest.fn();
jest.mock("../modules/exams/models/ExamSyllabus", () => {
  const actual = jest.requireActual("../modules/exams/models/ExamSyllabus");
  return {
    ...actual,
    ExamSyllabus: {
      find: (q: unknown) => ({ lean: async () => mockSyllabusFind(q) }),
      findOne: (q: unknown) => ({ lean: async () => mockSyllabusFindOne(q) }),
    },
  };
});

const mockRoutineSlots = jest.fn();
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: {
    find: () => ({ select: () => ({ lean: async () => mockRoutineSlots() }) }),
  },
}));

jest.mock("../modules/exams/models/ExamClassNote", () => ({
  ExamClassNote: {
    find: () => ({ lean: async () => [] }),
    findOne: () => ({
      lean: async () => ({ questionTypes: ["mcq", "descriptive"], noteMd: "শ্রেণি ভিত্তিক নোট" }),
    }),
  },
}));

const mockClass = jest.fn(() => ({ nameBn: "শ্রেণি ৩", level: 3 }) as unknown);
jest.mock("../modules/foundation/models/Class", () => ({
  Class: {
    findById: () => ({ select: () => ({ lean: async () => mockClass() }) }),
    find: () => ({ select: () => ({ lean: async () => [] }) }),
  },
}));

// Quran/Arabic level groups. Empty by default — every class-board test here is
// about class-wise subjects, and a level row must never depend on them.
const mockGroups = jest.fn(() => [] as unknown[]);
const mockMemberships = jest.fn(() => [] as unknown[]);
jest.mock("../modules/routine/models/SubjectGroup", () => ({
  SubjectGroup: {
    find: () => ({ select: () => ({ lean: async () => mockGroups() }) }),
  },
}));
jest.mock("../modules/routine/models/SubjectGroupMembership", () => ({
  SubjectGroupMembership: {
    find: () => ({ select: () => ({ lean: async () => mockMemberships() }) }),
  },
}));

const mockStudent = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { findById: () => ({ select: () => ({ lean: async () => mockStudent() }) }) },
}));

const mockGuardianGate = jest.fn();
jest.mock("../middleware/authz", () => {
  const actual = jest.requireActual("../middleware/authz");
  return {
    ...actual,
    assertGuardianOfStudent: (ctx: unknown, id: string) => mockGuardianGate(ctx, id),
  };
});

const mockScope = jest.fn();
jest.mock("../modules/teaching-notes/services/TeachingNoteService", () => ({
  myTeachingNoteScope: (ctx: unknown) => mockScope(ctx),
}));

import {
  classSyllabus,
  syllabusDetail,
  guardianChildSyllabus,
  mySyllabusApprovals,
  splitWrittenOral,
} from "../modules/exams/services/ExamSyllabusReadService";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function ctxFor(role: "PRINCIPAL" | "OFFICE" | "TEACHER" | "GUARDIAN", userId = oid().toString()) {
  return {
    req: {} as AppContext["req"],
    res: {} as AppContext["res"],
    auth: { userId, role, additionalTemplates: [], grantedPermissions: [], revokedPermissions: [] },
  } as AppContext;
}

const MARKS = [
  { seq: 1, label: "ক্লাস টেস্ট", component: "CT", total: 10 },
  { seq: 2, label: "আদব", component: "ADAB", total: 10 },
  { seq: 3, label: "লিখিত", count: 8, marksEach: 10, total: 60 },
  { seq: 4, label: "মৌখিক", itemType: "oral", count: 2, marksEach: 10, total: 20 },
];

function row(over: Record<string, unknown> = {}) {
  return {
    _id: oid(),
    examId: EXAM,
    classId: CLASS,
    subject: "BAN",
    bodyMd: "বাংলা মূল বই",
    marks: MARKS,
    questionTypes: ["mcq"],
    examDateKey: "2026-12-09",
    status: "PUBLISHED",
    publishedAt: new Date(),
    sendBackReason: null,
    ...over,
  };
}

beforeEach(() => {
  // Default for every test: the admin board reads the routine on each call, so an
  // unset mock would throw rather than fail a meaningful assertion.
  mockRoutineSlots.mockReturnValue([]);
});
beforeEach(() => {
  jest.clearAllMocks();
  mockScope.mockResolvedValue([]);
  mockGuardianGate.mockResolvedValue(undefined);
  mockStudent.mockReturnValue({ classId: CLASS });
});

// ---------------------------------------------------------------------------

describe("splitWrittenOral (§5.4 — derived, never stored)", () => {
  test("sums the oral rows apart from the rest", () => {
    expect(splitWrittenOral(MARKS as never)).toEqual({
      writtenMarks: 80,
      oralMarks: 20,
      totalMarks: 100,
    });
  });

  test("a sheet with no oral row reports oral 0 and written = total", () => {
    const written = MARKS.filter((m) => m.itemType !== "oral");
    const r = splitWrittenOral(written as never);
    expect(r.oralMarks).toBe(0);
    expect(r.writtenMarks).toBe(r.totalMarks);
  });
});

describe("classSyllabus", () => {
  test("Principal/Office read EVERY status — no publishedAt filter on the query", async () => {
    mockSyllabusFind.mockReturnValue([row({ status: "DRAFT", publishedAt: null })]);
    const view = await classSyllabus(ctxFor("OFFICE"), EXAM.toString(), CLASS.toString());
    expect(mockSyllabusFind.mock.calls[0][0].publishedAt).toBeUndefined();
    expect(view.subjects[0].status).toBe("DRAFT");
  });

  test("a TEACHER's query is filtered to published rows — not a caller-supplied flag", async () => {
    mockSyllabusFind.mockReturnValue([row()]);
    await classSyllabus(ctxFor("TEACHER", TEACHER_ID), EXAM.toString(), CLASS.toString());
    expect(mockSyllabusFind.mock.calls[0][0].publishedAt).toEqual({ $ne: null });
  });

  test("the class footer is carried once on the view, not copied onto every subject", async () => {
    mockSyllabusFind.mockReturnValue([row(), row({ subject: "MATH" })]);
    const view = await classSyllabus(ctxFor("OFFICE"), EXAM.toString(), CLASS.toString());
    expect(view.noteMd).toBe("শ্রেণি ভিত্তিক নোট");
    expect(view.questionTypes).toEqual(["mcq", "descriptive"]);
  });

  test("a teacher's OWN unpublished subject appears as a pending placeholder, not absent", async () => {
    mockSyllabusFind.mockReturnValue([]); // nothing published for this class
    mockScope.mockResolvedValue([{ classLevel: 3, subject: "ENG" }]);
    const view = await classSyllabus(ctxFor("TEACHER", TEACHER_ID), EXAM.toString(), CLASS.toString());
    const eng = view.subjects.find((s) => s.subject === "ENG");
    // Absent would read as "this class does not sit English"; pending reads as
    // "not ready yet", which is the truth.
    expect(eng).toBeDefined();
    expect(eng!.pending).toBe(true);
    expect(eng!.id).toBeNull();
    expect(eng!.isMine).toBe(true);
  });

  // D-#685 — from class one up these two are taught in cross-grade LEVEL groups,
  // so no single class board can show one paper that is right for the class.
  test("QURAN and ARABIC are OFF a class board from class one up, for the teacher who holds them", async () => {
    mockSyllabusFind.mockReturnValue([]);
    mockScope.mockResolvedValue([
      { classLevel: 3, subject: "ARABIC" },
      { classLevel: 3, subject: "QURAN" },
    ]);
    const view = await classSyllabus(ctxFor("TEACHER", TEACHER_ID), EXAM.toString(), CLASS.toString());
    expect(view.subjects.find((s) => s.subject === "ARABIC")).toBeUndefined();
    expect(view.subjects.find((s) => s.subject === "QURAN")).toBeUndefined();
  });

  test("...and off the OFFICE board too, which is the writing surface", async () => {
    mockSyllabusFind.mockReturnValue([]);
    mockScope.mockResolvedValue(null);
    mockRoutineSlots.mockReturnValue([]); // no routine → the full-subject fallback
    const view = await classSyllabus(ctxFor("OFFICE"), EXAM.toString(), CLASS.toString());
    expect(view.subjects.find((s) => s.subject === "ARABIC")).toBeUndefined();
    expect(view.subjects.find((s) => s.subject === "QURAN")).toBeUndefined();
    expect(view.subjects.find((s) => s.subject === "BAN")).toBeDefined();
  });

  test("below class one they STAY class-wise — নার্সারি and কেজি have no level groups", async () => {
    mockSyllabusFind.mockReturnValue([]);
    mockScope.mockResolvedValue(null);
    mockRoutineSlots.mockReturnValue([]);
    mockClass.mockReturnValueOnce({ nameBn: "নার্সারি", level: -1 });
    const view = await classSyllabus(ctxFor("OFFICE"), EXAM.toString(), CLASS.toString());
    expect(view.subjects.find((s) => s.subject === "ARABIC")).toBeDefined();
    expect(view.subjects.find((s) => s.subject === "QURAN")).toBeDefined();
  });

  test("a subject the teacher does NOT teach and that is unpublished stays absent", async () => {
    mockSyllabusFind.mockReturnValue([]);
    mockScope.mockResolvedValue([{ classLevel: 3, subject: "ARABIC" }]);
    const view = await classSyllabus(ctxFor("TEACHER", TEACHER_ID), EXAM.toString(), CLASS.toString());
    expect(view.subjects.find((s) => s.subject === "SCI")).toBeUndefined();
  });

  test("own subjects sort first, then the sheet's subject order — never alphabetical", async () => {
    mockSyllabusFind.mockReturnValue([
      row({ subject: "BAN" }),
      row({ subject: "MATH" }),
      row({ subject: "SCI" }),
    ]);
    mockScope.mockResolvedValue([{ classLevel: 3, subject: "SCI" }]);
    const view = await classSyllabus(ctxFor("TEACHER", TEACHER_ID), EXAM.toString(), CLASS.toString());
    expect(view.subjects[0].subject).toBe("SCI");
    expect(view.subjects[0].isMine).toBe(true);
  });

  test("marks ride through and the written/oral split is computed per subject", async () => {
    mockSyllabusFind.mockReturnValue([row()]);
    const view = await classSyllabus(ctxFor("OFFICE"), EXAM.toString(), CLASS.toString());
    expect(view.subjects[0].totalMarks).toBe(100);
    expect(view.subjects[0].writtenMarks).toBe(80);
    expect(view.subjects[0].oralMarks).toBe(20);
  });
});

describe("syllabusDetail", () => {
  test("Principal/Office may open an unpublished row", async () => {
    mockSyllabusFindOne.mockReturnValue(row({ status: "DRAFT", publishedAt: null }));
    const d = await syllabusDetail(ctxFor("PRINCIPAL"), EXAM.toString(), CLASS.toString(), "BAN" as never);
    expect(d?.status).toBe("DRAFT");
  });

  test("a teacher deep-linking to an unpublished row is REFUSED", async () => {
    mockSyllabusFindOne.mockReturnValue(row({ status: "DRAFT", publishedAt: null }));
    await expect(
      syllabusDetail(ctxFor("TEACHER", TEACHER_ID), EXAM.toString(), CLASS.toString(), "BAN" as never),
    ).rejects.toThrow(/প্রকাশ/);
  });

  test("a missing row is null, not an error", async () => {
    mockSyllabusFindOne.mockReturnValue(null);
    expect(
      await syllabusDetail(ctxFor("OFFICE"), EXAM.toString(), CLASS.toString(), "BAN" as never),
    ).toBeNull();
  });
});

describe("guardianChildSyllabus", () => {
  test("goes through assertGuardianOfStudent — the link-scoped gate, not a role test", async () => {
    mockSyllabusFind.mockReturnValue([row()]);
    await guardianChildSyllabus(ctxFor("GUARDIAN"), EXAM.toString(), "student1");
    expect(mockGuardianGate).toHaveBeenCalledWith(expect.anything(), "student1");
  });

  test("an unlinked child is refused before anything is read", async () => {
    mockGuardianGate.mockRejectedValue(new Error("not linked"));
    await expect(
      guardianChildSyllabus(ctxFor("GUARDIAN"), EXAM.toString(), "other-child"),
    ).rejects.toThrow();
    expect(mockSyllabusFind).not.toHaveBeenCalled();
  });

  test("ALWAYS filters to publishedAt — the guardian never depends on a role branch", async () => {
    mockSyllabusFind.mockReturnValue([row()]);
    await guardianChildSyllabus(ctxFor("GUARDIAN"), EXAM.toString(), "student1");
    expect(mockSyllabusFind.mock.calls[0][0].publishedAt).toEqual({ $ne: null });
  });

  test("reads the class from the STUDENT, so a classId cannot be supplied by the caller", async () => {
    mockSyllabusFind.mockReturnValue([row()]);
    const view = await guardianChildSyllabus(ctxFor("GUARDIAN"), EXAM.toString(), "student1");
    expect(view.classId).toBe(CLASS.toString());
    expect(mockSyllabusFind.mock.calls[0][0].classId).toBe(CLASS.toString());
  });

  test("a student with no class is refused rather than returning the whole school", async () => {
    mockStudent.mockReturnValue({});
    await expect(
      guardianChildSyllabus(ctxFor("GUARDIAN"), EXAM.toString(), "student1"),
    ).rejects.toThrow();
  });

  test("nothing is ever flagged isMine for a guardian", async () => {
    mockSyllabusFind.mockReturnValue([row()]);
    const view = await guardianChildSyllabus(ctxFor("GUARDIAN"), EXAM.toString(), "student1");
    expect(view.subjects.every((s) => !s.isMine)).toBe(true);
  });
});

describe("mySyllabusApprovals", () => {
  test("returns the caller's TEACHER_REVIEW rows", async () => {
    mockSyllabusFind.mockReturnValue([row({ status: "TEACHER_REVIEW" })]);
    const rows = await mySyllabusApprovals(ctxFor("TEACHER", TEACHER_ID));
    expect(rows).toHaveLength(1);
    expect(mockSyllabusFind.mock.calls[0][0].status).toBe("TEACHER_REVIEW");
  });

  test("a GUARDIAN gets [] and NO query — the drawer badge must never error", async () => {
    const rows = await mySyllabusApprovals(ctxFor("GUARDIAN"));
    expect(rows).toEqual([]);
    expect(mockSyllabusFind).not.toHaveBeenCalled();
  });

  test("an unauthenticated caller gets [] rather than throwing (the 791e5fe rule)", async () => {
    const rows = await mySyllabusApprovals({
      req: {} as AppContext["req"],
      res: {} as AppContext["res"],
      auth: null,
    });
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The Principal's coverage board (SY-5)
// ---------------------------------------------------------------------------

describe("examSyllabusBoard", () => {
  test("a TEACHER is refused — it is the one read that shows drafts school-wide", async () => {
    const { examSyllabusBoard } = await import(
      "../modules/exams/services/ExamSyllabusReadService"
    );
    await expect(
      examSyllabusBoard(ctxFor("TEACHER", TEACHER_ID), EXAM.toString()),
    ).rejects.toThrow(/অনুমতি নেই/);
  });

  test("a GUARDIAN is refused", async () => {
    const { examSyllabusBoard } = await import(
      "../modules/exams/services/ExamSyllabusReadService"
    );
    await expect(
      examSyllabusBoard(ctxFor("GUARDIAN"), EXAM.toString()),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The drawer badge's source (SY-5)
// ---------------------------------------------------------------------------

describe("mySyllabusApprovalCount", () => {
  test("a GUARDIAN gets 0 without touching the database — the drawer must never error", async () => {
    const { mySyllabusApprovalCount } = await import(
      "../modules/exams/services/ExamSyllabusReadService"
    );
    expect(await mySyllabusApprovalCount(ctxFor("GUARDIAN"))).toBe(0);
  });

  test("an unauthenticated caller gets 0 rather than throwing (the 791e5fe rule)", async () => {
    const { mySyllabusApprovalCount } = await import(
      "../modules/exams/services/ExamSyllabusReadService"
    );
    expect(
      await mySyllabusApprovalCount({
        req: {} as AppContext["req"],
        res: {} as AppContext["res"],
        auth: null,
      }),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The empty-database case — how the board actually starts (found on prod)
// ---------------------------------------------------------------------------

describe("classSyllabus with NO syllabus rows yet", () => {
  /**
   * The bug this pins: every earlier test mocked the row list and handed back
   * rows, so none of them saw the state the school actually starts from — an exam
   * created, nothing written. Office got an empty board with nothing to tap and no
   * way to create the first row, which made the whole module unusable.
   */
  beforeEach(() => {
    mockSyllabusFind.mockReturnValue([]);
    mockRoutineSlots.mockReturnValue([
      { subject: "BAN" },
      { subject: "BAN" },
      { subject: "MATH" },
      { subject: "ARABIC" },
      { subject: "NOT_A_SUBJECT" },
    ]);
  });

  test("OFFICE gets one writable placeholder per subject the ROUTINE says the class sits", async () => {
    const { classSyllabus } = await import(
      "../modules/exams/services/ExamSyllabusReadService"
    );
    const view = await classSyllabus(ctxFor("OFFICE"), EXAM.toString(), CLASS.toString());
    // ARABIC is in this class's routine and is still NOT offered here: from class
    // one up it is taught in cross-grade level groups, so it belongs on the level
    // board, not on any one class's (D-#685).
    expect(view.subjects.map((s) => s.subject).sort()).toEqual(["BAN", "MATH"]);
    // Every one is a placeholder waiting to be written — not a saved row.
    expect(view.subjects.every((s) => s.pending && s.id === null)).toBe(true);
  });

  test("a subject the routine does not carry is NOT offered", async () => {
    const { classSyllabus } = await import(
      "../modules/exams/services/ExamSyllabusReadService"
    );
    const view = await classSyllabus(ctxFor("OFFICE"), EXAM.toString(), CLASS.toString());
    expect(view.subjects.map((s) => s.subject)).not.toContain("SCI");
  });

  test("an unrecognised routine subject is ignored rather than offered", async () => {
    const { classSyllabus } = await import(
      "../modules/exams/services/ExamSyllabusReadService"
    );
    const view = await classSyllabus(ctxFor("OFFICE"), EXAM.toString(), CLASS.toString());
    expect(view.subjects.map((s) => s.subject)).not.toContain("NOT_A_SUBJECT");
  });

  test("a class with NO routine at all still gets a full writable board, never a dead end", async () => {
    mockRoutineSlots.mockReturnValue([]);
    const { classSyllabus } = await import(
      "../modules/exams/services/ExamSyllabusReadService"
    );
    const view = await classSyllabus(ctxFor("OFFICE"), EXAM.toString(), CLASS.toString());
    expect(view.subjects.length).toBeGreaterThan(0);
  });

  test("PRINCIPAL gets the same writable board as Office", async () => {
    const { classSyllabus } = await import(
      "../modules/exams/services/ExamSyllabusReadService"
    );
    const view = await classSyllabus(
      ctxFor("PRINCIPAL"),
      EXAM.toString(),
      CLASS.toString(),
    );
    expect(view.subjects.length).toBe(2);
  });

  test("a TEACHER still sees only their own pairs — the fix does not widen their board", async () => {
    const { classSyllabus } = await import(
      "../modules/exams/services/ExamSyllabusReadService"
    );
    const view = await classSyllabus(
      ctxFor("TEACHER", TEACHER_ID),
      EXAM.toString(),
      CLASS.toString(),
    );
    // The teacher scope mock decides this; what matters is that the ADMIN branch
    // did not leak the whole routine into a teacher's view.
    expect(view.subjects.every((s) => s.isMine)).toBe(true);
  });
});
