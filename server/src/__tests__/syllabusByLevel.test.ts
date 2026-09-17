/**
 * Level-keyed exam syllabuses (D-#688).
 *
 * Quran and Arabic from class one up are taught in cross-grade LEVEL groups, not
 * classes: চতুর্থ শ্রেণি alone spans five Quran levels, and বুক ২ (বালিকা) holds
 * children from four different classes. A class-keyed syllabus for those subjects
 * would have to be five papers at once, and its মানবন্টন could only ever be right
 * for one of them.
 *
 * What is asserted here:
 *   anchor   — a row is keyed by class XOR level, enforced as a sentence rather
 *              than left to a duplicate-key error.
 *   indexes  — the two unique indexes are PARTIAL and key on `$exists`, because a
 *              stored `classId: null` would let the old index allow exactly ONE
 *              Arabic row per exam.
 *   approver — every gate in the chain derives its approver set from ONE dispatch,
 *              so a level row cannot be seated on a teacher who does not hold it.
 *   reads    — the class board stops showing these subjects from class one up; the
 *              level board shows the levels that have children; a guardian cannot
 *              name a level directly.
 *
 * DB-free (repo convention): models are mocked, and the structural rules are read
 * off the source, which is the only place they exist.
 */
import { readFileSync } from "fs";
import path from "path";
import mongoose from "mongoose";
import type { AppContext } from "../context";

/** Source reads are CRLF-normalised — the repo checks out with Windows endings. */
const read = (rel: string): string =>
  readFileSync(path.resolve(__dirname, rel), "utf8").split("\r\n").join("\n");

const MODEL = read("../modules/exams/models/ExamSyllabus.ts");
const SERVICE = read("../modules/exams/services/ExamSyllabusService.ts");
const READ_SERVICE = read("../modules/exams/services/ExamSyllabusReadService.ts");
const RESOLVER = read("../modules/exams/resolvers/examSyllabus.ts");
const EMITTERS = read("../modules/notifications/services/emitters.ts");

const oid = () => new mongoose.Types.ObjectId();
const EXAM = oid();

// ---------------------------------------------------------------------------
// Mocks — only what the level reads touch
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

const mockGroups = jest.fn(() => [] as unknown[]);
const mockMemberships = jest.fn(() => [] as unknown[]);
jest.mock("../modules/routine/models/SubjectGroup", () => ({
  SubjectGroup: { find: () => ({ select: () => ({ lean: async () => mockGroups() }) }) },
}));
jest.mock("../modules/routine/models/SubjectGroupMembership", () => ({
  SubjectGroupMembership: {
    find: () => ({ select: () => ({ lean: async () => mockMemberships() }) }),
  },
}));
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
}));
jest.mock("../modules/exams/models/ExamClassNote", () => ({
  ExamClassNote: {
    find: () => ({ lean: async () => [] }),
    findOne: () => ({ lean: async () => null }),
  },
}));
jest.mock("../modules/foundation/models/Class", () => ({
  Class: {
    findById: () => ({ select: () => ({ lean: async () => ({ nameBn: "শ্রেণি ৩", level: 3 }) }) }),
    find: () => ({ select: () => ({ lean: async () => [] }) }),
  },
}));
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { findById: () => ({ select: () => ({ lean: async () => null }) }) },
}));
jest.mock("../modules/teaching-notes/services/TeachingNoteService", () => ({
  myTeachingNoteScope: async () => null,
}));

import { validateSyllabusAnchor } from "../modules/exams/models/ExamSyllabus";
import {
  examSyllabusLevels,
  syllabusLevelDetail,
} from "../modules/exams/services/ExamSyllabusReadService";

function ctxFor(role: "PRINCIPAL" | "OFFICE" | "TEACHER" | "GUARDIAN", userId = oid().toString()) {
  return {
    req: {} as AppContext["req"],
    res: {} as AppContext["res"],
    auth: { userId, role, additionalTemplates: [], grantedPermissions: [], revokedPermissions: [] },
  } as AppContext;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGroups.mockReturnValue([]);
  mockMemberships.mockReturnValue([]);
  mockSyllabusFind.mockReturnValue([]);
  mockSyllabusFindOne.mockReturnValue(null);
});

// ---------------------------------------------------------------------------

describe("the class-XOR-level anchor", () => {
  test("a class row is accepted", () => {
    expect(validateSyllabusAnchor({ classId: oid() })).toBeNull();
  });

  test("a level row is accepted", () => {
    expect(validateSyllabusAnchor({ subjectTrack: "arabic", subjectLevel: "Book 2" })).toBeNull();
  });

  test("a row anchored to BOTH is refused — it would appear twice and the copies would drift", () => {
    const err = validateSyllabusAnchor({
      classId: oid(),
      subjectTrack: "arabic",
      subjectLevel: "Book 2",
    });
    expect(err).not.toBeNull();
    expect(err).toContain("দুটোর সাথে নয়");
  });

  test("a row anchored to NEITHER is refused — it would be invisible to every reader", () => {
    expect(validateSyllabusAnchor({})).not.toBeNull();
  });

  test("a level without its track is refused", () => {
    // Without the track, "Book 2" alone cannot say whether it is a Quran paper or
    // an Arabic one, and both tracks are free to use the same level names.
    expect(validateSyllabusAnchor({ subjectLevel: "Book 2" })).not.toBeNull();
  });

  test("saveSyllabus runs the check BEFORE writing anything", () => {
    expect(SERVICE).toMatch(/validateSyllabusAnchor\(input\)/);
    const at = SERVICE.indexOf("validateSyllabusAnchor(input)");
    const create = SERVICE.indexOf("ExamSyllabus.create(");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(create);
  });
});

describe("the split unique indexes", () => {
  test("both are PARTIAL, keyed on $exists rather than on null", () => {
    // A stored `classId: null` would make every level row look like a class row to
    // the old single index, which would then allow exactly ONE Arabic row per
    // exam. Four levels need four rows.
    expect(MODEL).toMatch(/partialFilterExpression: \{ classId: \{ \$exists: true \} \}/);
    expect(MODEL).toMatch(/partialFilterExpression: \{ subjectLevel: \{ \$exists: true \} \}/);
  });

  test("the level index is keyed on (exam, track, level) and NOT on the subject", () => {
    // A level belongs to exactly one track, so track+level already names one
    // paper; including the subject would let QURAN@"Book 2" and ARABIC@"Book 2"
    // both exist for the same children.
    expect(MODEL).toMatch(/\{ examId: 1, subjectTrack: 1, subjectLevel: 1 \}/);
  });

  test("classId carries NO `default: null`, or the partial filter would match everything", () => {
    const line = MODEL.split("\n").find((l) => l.includes('classId: { type: Schema.Types.ObjectId'));
    expect(line).toBeDefined();
    expect(line).not.toContain("default: null");
  });

  test("a migration exists, because Mongoose CANNOT make this change on its own", () => {
    // The class index keeps its key pattern and therefore its auto-generated name;
    // only the options changed. `createIndex` answers IndexOptionsConflict, the
    // error is emitted on the model rather than thrown at the write, and the deploy
    // looks clean while the OLD non-partial index still rejects every level row
    // after the first. Without the drop, the split buys nothing.
    const script = read("../../scripts/migrate-syllabus-level-index.ts");
    expect(script).toContain("examId_1_classId_1_subject_1");
    expect(script).toMatch(/ExamSyllabus\.syncIndexes\(\)/);
    // And it must verify the outcome rather than trust syncIndexes' silence.
    expect(script).toMatch(/are NOT both present/);
  });
});

describe("the approver set", () => {
  test("every gate goes through the ONE dispatch, so they cannot diverge", () => {
    // submit, reassign, approve and the §7.2 bypass each used to ask the class
    // question its own way.
    expect(SERVICE).toMatch(/export async function holdersForRow\(row: SyllabusAnchor\)/);
    const uses = SERVICE.match(/holdersForRow\(doc\)/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(3);
  });

  test("a level row is answered by the GROUP slots, not by the class lookup", () => {
    expect(SERVICE).toMatch(/routineHoldersForLevel\(row\.subjectTrack \?\? "", row\.subjectLevel\)/);
  });

  test("routineHoldersForLevel filters slots to the level's OWN groups", () => {
    // routineHoldersFor matches EVERY `subjectgroup` slot regardless of group —
    // asking it about আরবি would offer every Quran and Arabic teacher in school.
    const fn = SERVICE.slice(SERVICE.indexOf("export async function routineHoldersForLevel("));
    expect(fn).toMatch(/groupId: \{ \$in: groups\.map\(\(g\) => g\._id\) \}/);
    expect(fn).toMatch(/groupType: "subjectgroup"/);
  });

  test("the picker resolver asks the same question as the gate", () => {
    expect(RESOLVER).toMatch(/holdersForRow\(\{/);
    expect(RESOLVER).toMatch(/track: t\.arg\.string\(\{ required: false \}\)/);
    expect(RESOLVER).toMatch(/level: t\.arg\.string\(\{ required: false \}\)/);
  });
});

describe("examSyllabusLevels — the level board", () => {
  const withGroups = () => {
    const boys = oid();
    const girls = oid();
    const empty = oid();
    mockGroups.mockReturnValue([
      { _id: boys, track: "arabic", level: "Book 2", nameBn: "বুক ২ (বালক)" },
      { _id: girls, track: "arabic", level: "Book 2", nameBn: "বুক ২ (বালিকা)" },
      { _id: empty, track: "quran", level: "Hifz 1", nameBn: "হিফজ ১ (mixed)" },
    ]);
    mockMemberships.mockReturnValue([
      { groupId: boys },
      { groupId: boys },
      { groupId: girls },
    ]);
  };

  test("both gender groups of a level share ONE entry, and both are named", async () => {
    // They sit the same paper (owner ruling): the gender split is a teaching
    // arrangement, exactly as sections are under a class.
    withGroups();
    const rows = await examSyllabusLevels(ctxFor("PRINCIPAL"), EXAM.toString());
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("বুক ২ (বালক) + বুক ২ (বালিকা)");
    expect(rows[0].memberCount).toBe(3);
  });

  test("a level with no children is skipped", async () => {
    // Prod carries an empty "হিফজ ১ (mixed)" beside the real boys'/girls' groups,
    // and a leftover ZZTEST group. Nobody should be asked to write those papers.
    withGroups();
    const rows = await examSyllabusLevels(ctxFor("PRINCIPAL"), EXAM.toString());
    expect(rows.map((r) => r.level)).not.toContain("Hifz 1");
  });

  test("a level with children but no syllabus yet shows as a GAP, not as nothing", async () => {
    withGroups();
    const rows = await examSyllabusLevels(ctxFor("PRINCIPAL"), EXAM.toString());
    expect(rows[0].row).toBeNull();
    expect(rows[0].subject).toBe("ARABIC");
  });

  test("the query is by subjectLevel existing — it must not pick up class rows", async () => {
    withGroups();
    await examSyllabusLevels(ctxFor("PRINCIPAL"), EXAM.toString());
    expect(mockSyllabusFind.mock.calls[0][0]).toEqual({
      examId: EXAM.toString(),
      subjectLevel: { $exists: true },
    });
  });

  test("a TEACHER is refused — it shows unpublished rows school-wide", async () => {
    await expect(
      examSyllabusLevels(ctxFor("TEACHER"), EXAM.toString()),
    ).rejects.toThrow();
  });

  test("it is exam:manage on the wire", () => {
    expect(RESOLVER).toMatch(
      /examSyllabusLevels[\s\S]{0,900}?authScopes: \{ hasPermission: "exam:manage" \}/,
    );
  });
});

describe("syllabusLevelDetail", () => {
  const published = {
    _id: oid(),
    examId: EXAM,
    subjectTrack: "arabic",
    subjectLevel: "Book 2",
    subject: "ARABIC",
    bodyMd: "পাঠ্যবই",
    marks: [{ seq: 1, label: "ক", count: 10, marksEach: 10, total: 100 }],
    questionTypes: ["mcq"],
    status: "PUBLISHED",
    publishedAt: new Date(),
    teacherBypass: false,
  };

  test("a GUARDIAN is refused outright", async () => {
    // A parent reaches their child's level through guardianChildSyllabus, which
    // resolves it from the child's own membership. Letting them name a level here
    // would let any parent read any level's paper.
    mockSyllabusFindOne.mockReturnValue(published);
    await expect(
      syllabusLevelDetail(ctxFor("GUARDIAN"), EXAM.toString(), "arabic", "Book 2"),
    ).rejects.toThrow();
  });

  test("an unpublished row is refused to a teacher, as on the class read", async () => {
    mockSyllabusFindOne.mockReturnValue({ ...published, status: "DRAFT", publishedAt: null });
    await expect(
      syllabusLevelDetail(ctxFor("TEACHER"), EXAM.toString(), "arabic", "Book 2"),
    ).rejects.toThrow();
  });

  test("Office reads an unpublished row — the board is the writing surface", async () => {
    mockSyllabusFindOne.mockReturnValue({ ...published, status: "DRAFT", publishedAt: null });
    const row = await syllabusLevelDetail(ctxFor("OFFICE"), EXAM.toString(), "arabic", "Book 2");
    expect(row).not.toBeNull();
    expect(row!.classId).toBeNull();
  });

  test("the row carries a level label, so two levels are never two identical cards", async () => {
    mockSyllabusFindOne.mockReturnValue(published);
    mockGroups.mockReturnValue([{ nameBn: "বুক ২ (বালক)" }, { nameBn: "বুক ২ (বালিকা)" }]);
    const row = await syllabusLevelDetail(ctxFor("OFFICE"), EXAM.toString(), "arabic", "Book 2");
    expect(row!.levelLabel).toBe("বুক ২ (বালক) + বুক ২ (বালিকা)");
  });

  test("a missing row is null, not an error", async () => {
    mockSyllabusFindOne.mockReturnValue(null);
    await expect(
      syllabusLevelDetail(ctxFor("OFFICE"), EXAM.toString(), "arabic", "Book 4"),
    ).resolves.toBeNull();
  });
});

describe("who hears about a level syllabus", () => {
  test("publish notifies the GROUP MEMBERS, never a class roster", () => {
    // Deriving recipients from a class would notify the wrong families and miss
    // the right ones — the children of one level are scattered across four or
    // five classes.
    expect(SERVICE).toMatch(/levelAudience\(doc\.subjectTrack \?\? "", doc\.subjectLevel\)/);
    expect(SERVICE).toMatch(/\.\.\.\(level \? \{ studentIds: level\.studentIds \} : \{\}\)/);
    expect(EMITTERS).toMatch(/ev\.studentIds\s*\n?\s*\? ev\.studentIds\.map/);
  });

  test("the Principal is told which GROUPS the paper is for, not an invented class name", () => {
    const approve = SERVICE.slice(SERVICE.indexOf("emitSyllabusAwaitingPublish({") - 900);
    expect(approve).toMatch(/className: \(await levelAudience\(/);
  });

  test("a notification with no class omits the key rather than sending an empty string", () => {
    // notificationNav already falls back to the syllabus list when the
    // (exam × class × subject) triple is incomplete; an empty string would
    // navigate to a dead screen instead.
    const count = (EMITTERS.match(/\.\.\.\(ev\.classId \? \{ classId: ev\.classId\.toString\(\) \} : \{\}\)/g) ?? [])
      .length;
    expect(count).toBe(2);
  });
});

describe("the class board stops claiming these subjects", () => {
  test("from class one up, QURAN and ARABIC are held off the class board", () => {
    expect(READ_SERVICE).toMatch(/const levelTaught = \(cls\.level \?\? 0\) >= 1;/);
    expect(READ_SERVICE).toMatch(/code === "QURAN" \|\| code === "ARABIC"/);
  });

  test("below class one they stay class-wise — নার্সারি and কেজি are taught by class", () => {
    // The gate is `>= 1`, so level -1 (নার্সারি) and 0 (কেজি) keep both subjects
    // on their own boards, where they have always been.
    const guard = READ_SERVICE.slice(READ_SERVICE.indexOf("const levelTaught"));
    expect(guard.slice(0, 200)).toContain(">= 1");
  });

  test("a guardian's child gets their OWN level rows, resolved from membership", () => {
    expect(READ_SERVICE).toMatch(/publishedLevelRowsForStudent\(examId, studentId\)/);
    const fn = READ_SERVICE.slice(READ_SERVICE.indexOf("async function publishedLevelRowsForStudent"));
    expect(fn).toMatch(/publishedAt: \{ \$ne: null \}/);
  });
});
