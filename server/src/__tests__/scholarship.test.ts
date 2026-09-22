/**
 * Scholarship practice papers — SC-0/SC-1/SC-2 (docs/prd-scholarship-practice.md,
 * D-#656..#665).
 *
 * Declaration — validateItems: the Σ guard (D-#656), one topic per item that must
 *               belong to THAT item's subject (D-#659), an item's subject must be one
 *               the paper covers (D-#664), half-mark steps, duplicate item numbers.
 * Combined     — a Science + BGS paper is ONE paper with subjects[] and a per-item
 *               subject (D-#664); the sequence key is stable however they are ordered.
 * Authz        — a TEACHER holds scholarship:manage as a BASE permission, so the
 *               ROUTINE is the scope, not the permission (D-#656): she passes only on a
 *               class × subject the routine names her on; Principal/Office always pass.
 * Scores       — a cell may not exceed its item's declared marks; an unknown item is
 *               refused; ABSENT stores no marks at all rather than zeros (D-#660); a
 *               student off this section's roster is refused; DECLARED → SCORED.
 *
 * DB-free (the repo convention): models, the routine lookup and audit are mocked; the
 * pure validators are exercised directly.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the module under test)
// ---------------------------------------------------------------------------

const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

const mockTopicFind = jest.fn();
jest.mock("../modules/scholarship/models/ScholarshipTopic", () => ({
  ScholarshipTopic: { find: (q: unknown) => mockTopicFind(q) },
}));

const mockPaperCreate = jest.fn();
const mockPaperFindById = jest.fn();
const mockPaperUpdateOne = jest.fn();
jest.mock("../modules/scholarship/models/ScholarshipPaper", () => ({
  ScholarshipPaper: {
    create: (d: unknown) => mockPaperCreate(d),
    findById: (id: unknown) => mockPaperFindById(id),
    updateOne: (...a: unknown[]) => mockPaperUpdateOne(...a),
  },
}));

const mockScoreUpsert = jest.fn();
jest.mock("../modules/scholarship/models/ScholarshipScore", () => ({
  ScholarshipScore: { findOneAndUpdate: (...a: unknown[]) => mockScoreUpsert(...a) },
}));

const mockSeqUpsert = jest.fn();
jest.mock("../modules/scholarship/models/ScholarshipSequence", () => ({
  ScholarshipSequence: { findOneAndUpdate: (...a: unknown[]) => mockSeqUpsert(...a) },
}));

const mockSectionFindById = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { findById: (id: unknown) => mockSectionFindById(id) },
}));

const mockClassFindById = jest.fn();
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { findById: (id: unknown) => mockClassFindById(id) },
}));

const mockStudentFind = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: (q: unknown) => mockStudentFind(q) },
}));

const mockResolveTeacher = jest.fn();
jest.mock("../modules/trackers/subjectTeacher", () => ({
  resolveSubjectTeacher: (...a: unknown[]) => mockResolveTeacher(...a),
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (...a: unknown[]) => mockWriteAudit(...a),
}));

import {
  assertMayManage,
  declarePaper,
  enterScores,
  generatePaperId,
  subjectKeyOf,
  sumMarks,
  validateItems,
  marksNote,
  type DeclareItemInput,
} from "../modules/scholarship/services/ScholarshipService";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENG_TOPICS = ["TOP-SCH-ENG-C5-VOCAB", "TOP-SCH-ENG-C5-ARTICLE"];

/** A 100-mark English paper trimmed to three items that total 100. */
const engItems = (): DeclareItemInput[] => [
  { itemNo: 1, label: "শব্দার্থ মিলকরণ", subject: "ENG", topicCode: ENG_TOPICS[0], itemType: "matching", marks: 5 },
  { itemNo: 2, label: "Articles", subject: "ENG", topicCode: ENG_TOPICS[1], itemType: "fill_blank", marks: 6, chapters: [1, 2] },
  { itemNo: 3, label: "রচনা", subject: "ENG", topicCode: ENG_TOPICS[0], itemType: "descriptive", marks: 89 },
];

/** Topics resolve for the subject they are asked for. */
function topicsResolve(rows: { code: string; subject: string }[]): void {
  mockTopicFind.mockImplementation(() => leanChain(rows));
}

beforeEach(() => {
  jest.clearAllMocks();
  topicsResolve([
    { code: ENG_TOPICS[0], subject: "ENG" },
    { code: ENG_TOPICS[1], subject: "ENG" },
  ]);
});

// ---------------------------------------------------------------------------
// sumMarks / subject key
// ---------------------------------------------------------------------------

describe("mark arithmetic", () => {
  it("sums ten half marks to exactly 5 — no floating-point drift", () => {
    // The English paper's item 10 is 0.5 × 10. A naive fold gives 4.999999999999999,
    // which would fail the Σ guard on a paper that is actually correct.
    expect(sumMarks(Array(10).fill(0.5))).toBe(5);
    expect(sumMarks([0.5, 0.5, 0.5])).toBe(1.5);
  });

  it("keys a combined paper the same however the subjects were ordered", () => {
    expect(subjectKeyOf(["SCI", "BGS"])).toBe("BGS+SCI");
    expect(subjectKeyOf(["BGS", "SCI"])).toBe("BGS+SCI");
    expect(subjectKeyOf(["ENG"])).toBe("ENG");
  });

  it("builds a padded, year-continuous paperId off the sequence", async () => {
    mockSeqUpsert.mockResolvedValue({ seq: 7 });
    await expect(generatePaperId(oid(), 5, ["ENG"])).resolves.toBe("SP-C5-ENG-0007");
    mockSeqUpsert.mockResolvedValue({ seq: 1 });
    await expect(generatePaperId(oid(), 5, ["SCI", "BGS"])).resolves.toBe("SP-C5-BGS+SCI-0001");
  });
});

// ---------------------------------------------------------------------------
// validateItems — the hard guards, and the Σ NOTE that is no longer one of them
// ---------------------------------------------------------------------------

describe("validateItems", () => {
  it("accepts a paper whose items total the full marks", async () => {
    await expect(validateItems(["ENG"], 100, engItems(), 5)).resolves.toBeNull();
  });

  it("ACCEPTS a paper whose items do not total the full marks (D-#675)", async () => {
    // D-#656 refused this. The refusal made the owner's real case impossible — a paper
    // listing every alternative is 24 items for 14 printed questions and sums to 168
    // while the student still sits 100 — and it protected no calculation: a topic
    // percentage divides by the marks of the items a student was MARKED on, and the
    // class average divides by totalMarks. Neither reads Σ(items).
    const items = engItems();
    items[2].marks = 80; // 5 + 6 + 80 = 91, not 100
    await expect(validateItems(["ENG"], 100, items, 5)).resolves.toBeNull();
  });

  it("still REPORTS the mismatch through marksNote, naming the real sum", async () => {
    // Gone as a refusal, kept as a signal: on a paper meant to be one part per question
    // a mismatch is a typo, and the teacher should see it while typing.
    const items = engItems();
    items[2].marks = 80;
    const note = marksNote(100, items);
    expect(note).toContain("91");
    expect(note).toContain("100");
    expect(marksNote(91, items)).toBeNull();
  });

  it("accepts an item with NO topic, and still refuses one whose named topic is unknown", async () => {
    // An untagged item misses the topic axis and nothing else (D-#675); refusing the
    // paper over it only ever cost the teacher the record.
    const items = engItems();
    items[0].topicCode = "";
    await expect(validateItems(["ENG"], 100, items, 5)).resolves.toBeNull();
  });

  it("accepts a blank item label and a question number with a part letter", async () => {
    const items = engItems();
    items[0].label = "";
    items[0].questionNo = 1;
    items[0].part = "a";
    items[1].questionNo = 1;
    items[1].part = "b";
    await expect(validateItems(["ENG"], 100, items, 5)).resolves.toBeNull();
  });

  it("refuses a part letter outside a-d", async () => {
    const items = engItems();
    items[0].part = "z";
    await expect(validateItems(["ENG"], 100, items, 5)).resolves.toContain("a, b, c");
  });

  it("refuses a duplicated item number", async () => {
    const items = engItems();
    items[1].itemNo = 1;
    await expect(validateItems(["ENG"], 100, items, 5)).resolves.toContain("একাধিকবার");
  });

  it("refuses marks finer than a half", async () => {
    const items = engItems();
    items[0].marks = 5.25;
    items[2].marks = 88.75; // still totals 100
    await expect(validateItems(["ENG"], 100, items, 5)).resolves.toContain("০.৫");
  });

  it("accepts an item that covers several chapters, and one that covers none", async () => {
    // The owner's "may cover one or more chapter" — chapters is a list, and empty is
    // legal because a grammar skill spans the whole book (D-#659).
    const items = engItems();
    expect(items[1].chapters).toEqual([1, 2]);
    expect(items[0].chapters).toBeUndefined();
    await expect(validateItems(["ENG"], 100, items, 5)).resolves.toBeNull();
  });

  it("refuses a topic that is not in the catalogue at all", async () => {
    topicsResolve([{ code: ENG_TOPICS[0], subject: "ENG" }]);
    const msg = await validateItems(["ENG"], 100, engItems(), 5);
    expect(msg).toContain(ENG_TOPICS[1]);
  });

  it("refuses a topic that exists but belongs to ANOTHER subject", async () => {
    // A code that resolves for BGS must not satisfy an ENG item: it would silently
    // drop those marks into the wrong subject's roll-up, where nobody is looking.
    topicsResolve([
      { code: ENG_TOPICS[0], subject: "ENG" },
      { code: ENG_TOPICS[1], subject: "BGS" },
    ]);
    const msg = await validateItems(["ENG"], 100, engItems(), 5);
    expect(msg).toContain("ENG");
  });

  it("refuses an empty item list and an empty subject list", async () => {
    await expect(validateItems(["ENG"], 100, [], 5)).resolves.toContain("আইটেম");
    await expect(validateItems([], 100, engItems(), 5)).resolves.toContain("বিষয়");
  });

  it("refuses the same subject listed twice", async () => {
    await expect(validateItems(["ENG", "ENG"], 100, engItems(), 5)).resolves.toContain("দুইবার");
  });
});

// ---------------------------------------------------------------------------
// The combined Science + BGS paper (D-#664)
// ---------------------------------------------------------------------------

describe("a paper that spans two subjects", () => {
  const combined = (): DeclareItemInput[] => [
    { itemNo: 1, label: "বহুনির্বাচনি", subject: "SCI", topicCode: "TOP-SCH-SCI-C5-WATER", itemType: "mcq", marks: 20 },
    { itemNo: 2, label: "বিস্তৃত উত্তর", subject: "SCI", topicCode: "TOP-SCH-SCI-C5-WATER", itemType: "descriptive", marks: 30 },
    { itemNo: 3, label: "বহুনির্বাচনি", subject: "BGS", topicCode: "TOP-SCH-BGS-C5-MAP", itemType: "mcq", marks: 20 },
    { itemNo: 4, label: "বিস্তৃত উত্তর", subject: "BGS", topicCode: "TOP-SCH-BGS-C5-MAP", itemType: "descriptive", marks: 30 },
  ];

  beforeEach(() => {
    topicsResolve([
      { code: "TOP-SCH-SCI-C5-WATER", subject: "SCI" },
      { code: "TOP-SCH-BGS-C5-MAP", subject: "BGS" },
    ]);
  });

  it("accepts the NAPE 50+50 shape as ONE paper of 100", async () => {
    await expect(validateItems(["SCI", "BGS"], 100, combined(), 5)).resolves.toBeNull();
  });

  it("refuses an item whose subject the paper does not cover", async () => {
    const items = combined();
    items[3].subject = "MATH";
    const msg = await validateItems(["SCI", "BGS"], 100, items, 5);
    expect(msg).toContain("MATH");
  });

  it("does NOT enforce the 50/50 split — a Science-only drill stays legal", async () => {
    // The halves are a NAPE convention, not an invariant. Only the global Σ is a rule,
    // so a short single-subject practice paper must pass.
    const items = combined().slice(0, 2).map((i) => ({ ...i }));
    items[0].marks = 8;
    items[1].marks = 12;
    await expect(validateItems(["SCI"], 20, items, 5)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Authorization — the routine is the scope (D-#656)
// ---------------------------------------------------------------------------

describe("assertMayManage", () => {
  const sectionId = String(oid());
  const teacher = { userId: String(oid()), role: "TEACHER" };

  it("lets the desk through without consulting the routine", async () => {
    await expect(assertMayManage({ userId: String(oid()), role: "PRINCIPAL" }, sectionId, ["ENG"], new Date())).resolves.toBeUndefined();
    await expect(assertMayManage({ userId: String(oid()), role: "OFFICE" }, sectionId, ["ENG"], new Date())).resolves.toBeUndefined();
    expect(mockResolveTeacher).not.toHaveBeenCalled();
  });

  it("lets through the teacher the routine names on that class and subject", async () => {
    mockResolveTeacher.mockResolvedValue(teacher.userId);
    await expect(assertMayManage(teacher, sectionId, ["ENG"], new Date())).resolves.toBeUndefined();
  });

  it("refuses a teacher the routine names on a DIFFERENT cell", async () => {
    // The permission is held by every teacher; without this check it would be a write
    // on every class's papers (the QR-9 near-miss).
    mockResolveTeacher.mockResolvedValue(String(oid()));
    await expect(assertMayManage(teacher, sectionId, ["ENG"], new Date())).rejects.toThrow("রুটিন");
  });

  it("refuses when the routine names nobody at all", async () => {
    mockResolveTeacher.mockResolvedValue(null);
    await expect(assertMayManage(teacher, sectionId, ["ENG"], new Date())).rejects.toThrow("রুটিন");
  });

  it("lets a combined paper through for the teacher of EITHER half", async () => {
    mockResolveTeacher.mockImplementation(async (_s: string, subject: string) =>
      subject === "BGS" ? teacher.userId : String(oid()),
    );
    await expect(assertMayManage(teacher, sectionId, ["SCI", "BGS"], new Date())).resolves.toBeUndefined();
  });

  it("refuses a guardian outright", async () => {
    await expect(assertMayManage({ userId: String(oid()), role: "GUARDIAN" }, sectionId, ["ENG"], new Date())).rejects.toThrow("অনুমতি");
  });
});

// ---------------------------------------------------------------------------
// declarePaper
// ---------------------------------------------------------------------------

describe("declarePaper", () => {
  const sectionId = String(oid());
  const classId = oid();
  const yearId = oid();
  const principal = { userId: String(oid()), role: "PRINCIPAL" };

  beforeEach(() => {
    mockSectionFindById.mockReturnValue(leanChain({ classId }));
    mockClassFindById.mockReturnValue(leanChain({ level: 5, academicYearId: yearId }));
    mockSeqUpsert.mockResolvedValue({ seq: 1 });
    mockPaperCreate.mockImplementation(async (d: Record<string, unknown>) => ({ ...d, _id: oid() }));
  });

  it("derives class, level and year from the section — never from the caller", async () => {
    await declarePaper(
      { sectionId, subjects: ["ENG"], name: "Unit 1 · Model 1", totalMarks: 100, items: engItems() },
      principal,
    );
    const doc = mockPaperCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(doc.classLevel).toBe(5);
    expect(doc.classId).toEqual(classId);
    expect(doc.academicYearId).toEqual(yearId);
    expect(doc.paperId).toBe("SP-C5-ENG-0001");
    expect(doc.status).toBe("DECLARED");
  });

  it("STORES a paper whose marks do not add up, and one with no name (D-#675)", async () => {
    // Both refusals are gone. The Σ one made a paper listing every alternative
    // impossible to record at all; the name one cost the record over a field the paper
    // id can supply. A stored paper that is slightly wrong beats no paper.
    const items = engItems();
    items[0].marks = 4; // 99, not 100
    await expect(
      declarePaper({ sectionId, subjects: ["ENG"], totalMarks: 100, items }, principal),
    ).resolves.toBeDefined();
    expect(mockPaperCreate).toHaveBeenCalledTimes(1);
    // The blank name is filled from the generated paper id, never stored empty.
    const created = mockPaperCreate.mock.calls[0][0] as { name: string; paperId: string };
    expect(created.name).toBe(created.paperId);
    expect(created.name).not.toBe("");
  });

  it("audits the declaration with the item count and total", async () => {
    await declarePaper(
      { sectionId, subjects: ["ENG"], name: "Unit 1", totalMarks: 100, items: engItems() },
      principal,
    );
    const audit = mockWriteAudit.mock.calls[0][0] as { eventKind: string; meta: Record<string, unknown> };
    expect(audit.eventKind).toBe("SCHOLARSHIP_PAPER_DECLARED");
    expect(audit.meta.itemCount).toBe(3);
    expect(audit.meta.totalMarks).toBe(100);
  });

  it("refuses an unknown section", async () => {
    mockSectionFindById.mockReturnValue(leanChain(null));
    await expect(
      declarePaper({ sectionId, subjects: ["ENG"], name: "x", totalMarks: 100, items: engItems() }, principal),
    ).rejects.toThrow("শাখা");
  });
});

// ---------------------------------------------------------------------------
// enterScores
// ---------------------------------------------------------------------------

describe("enterScores", () => {
  const paperOid = oid();
  const sectionId = oid();
  const studentId = String(oid());
  const principal = { userId: String(oid()), role: "PRINCIPAL" };

  const paper = (status = "DECLARED") => ({
    _id: paperOid,
    paperId: "SP-C5-ENG-0001",
    sectionId,
    subjects: ["ENG"],
    status,
    paperDate: new Date("2026-09-14"),
    items: [
      { itemNo: 1, marks: 5 },
      { itemNo: 2, marks: 18 },
    ],
  });

  beforeEach(() => {
    mockPaperFindById.mockReturnValue(leanChain(paper()));
    mockStudentFind.mockReturnValue(leanChain([{ _id: new mongoose.Types.ObjectId(studentId) }]));
    mockScoreUpsert.mockResolvedValue({});
    mockPaperUpdateOne.mockResolvedValue({});
  });

  it("writes one row per student and flips the paper DECLARED → SCORED", async () => {
    const n = await enterScores(
      String(paperOid),
      [{ studentId, status: "PRESENT", itemMarks: [{ itemNo: 1, marks: 4 }, { itemNo: 2, marks: 12 }] }],
      principal,
    );
    expect(n).toBe(1);
    expect(mockScoreUpsert).toHaveBeenCalledTimes(1);
    expect(mockPaperUpdateOne).toHaveBeenCalledWith({ _id: paperOid }, { $set: { status: "SCORED" } });
  });

  it("refuses a cell above its item's declared marks, naming both numbers", async () => {
    await expect(
      enterScores(String(paperOid), [{ studentId, status: "PRESENT", itemMarks: [{ itemNo: 1, marks: 6 }] }], principal),
    ).rejects.toThrow("সর্বোচ্চ 5");
    expect(mockScoreUpsert).not.toHaveBeenCalled();
  });

  it("refuses an item number the paper does not have", async () => {
    await expect(
      enterScores(String(paperOid), [{ studentId, status: "PRESENT", itemMarks: [{ itemNo: 9, marks: 1 }] }], principal),
    ).rejects.toThrow("আইটেম 9");
  });

  it("refuses the same item scored twice in one row", async () => {
    await expect(
      enterScores(
        String(paperOid),
        [{ studentId, status: "PRESENT", itemMarks: [{ itemNo: 1, marks: 2 }, { itemNo: 1, marks: 3 }] }],
        principal,
      ),
    ).rejects.toThrow("একাধিকবার");
  });

  it("stores NO marks for an ABSENT student, even when marks were sent", async () => {
    // Not zeros: a zero means "sat it and scored nothing", which is a different fact,
    // and zeros would drag an absent child into every class mean (D-#660).
    await enterScores(
      String(paperOid),
      [{ studentId, status: "ABSENT", itemMarks: [{ itemNo: 1, marks: 5 }] }],
      principal,
    );
    const update = mockScoreUpsert.mock.calls[0][1] as { $set: { itemMarks: unknown[]; status: string } };
    expect(update.$set.status).toBe("ABSENT");
    expect(update.$set.itemMarks).toEqual([]);
  });

  it("refuses a student who is not on this paper's section roster", async () => {
    mockStudentFind.mockReturnValue(leanChain([]));
    await expect(
      enterScores(String(paperOid), [{ studentId, status: "PRESENT", itemMarks: [] }], principal),
    ).rejects.toThrow("তালিকায় নেই");
  });

  it("gates on the SITTING roster, not the section's (D-#697)", async () => {
    // Hiding an excluded child from the grid is presentation. A write that arrives for
    // her anyway — a stale screen, a replayed mutation — has to be refused, or her marks
    // land somewhere no read will ever look at them again.
    mockStudentFind.mockReturnValue(leanChain([]));
    await expect(
      enterScores(String(paperOid), [{ studentId, status: "PRESENT", itemMarks: [] }], principal),
    ).rejects.toThrow("তালিকায় নেই");
    expect(mockStudentFind.mock.calls[0][0]).toMatchObject({
      scholarshipExcluded: { $ne: true },
    });
  });

  it("does not demote a paper that is already SCORED", async () => {
    mockPaperFindById.mockReturnValue(leanChain(paper("SCORED")));
    await enterScores(String(paperOid), [{ studentId, status: "ABSENT" }], principal);
    expect(mockPaperUpdateOne).not.toHaveBeenCalled();
  });

  it("refuses an unknown paper", async () => {
    mockPaperFindById.mockReturnValue(leanChain(null));
    await expect(enterScores(String(paperOid), [{ studentId, status: "ABSENT" }], principal)).rejects.toThrow("প্রশ্নপত্র");
  });
});
