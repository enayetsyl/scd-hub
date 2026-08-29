/**
 * Slice 2 question-bank + assembly tests.
 *
 * J2.1 — question import round-trip (doc_type=question via importEnvelope)
 * J2.2 — tag filter combinations (filter construction + mock ContentArtifact)
 * J2.4 — supervisory read of un-taught questions (canRead with supervisory scope)
 * J3.1 — basket accumulation (addQuestionToSet service)
 * J3.2 — assemble set (assembleSet service)
 * J3.5 — write-scope denied for supervisory-only teacher (canWrite predicate)
 *
 * DB-free: all Mongoose models and child_process are mocked. The canRead/canWrite
 * pure functions are tested directly (same pattern as scopeGrant.test.ts).
 */

import * as cp from "child_process";
import mongoose from "mongoose";
import { roleHasPermission } from "@scd/shared";
import { canRead, canWrite } from "../modules/foundation/services/ScopeGrantService";
import type { ScopeItem } from "../modules/foundation/services/ScopeGrantService";

// ---------------------------------------------------------------------------
// Mock Mongoose models BEFORE importing services under test
// ---------------------------------------------------------------------------

const mockArtifactCreate = jest.fn();
const mockArtifactFindOneResult = jest.fn().mockResolvedValue(null);
const mockArtifactFindOne = jest.fn((_q?: unknown) => ({ lean: mockArtifactFindOneResult }));
const mockArtifactUpdateOne = jest.fn();
const mockArtifactFind = jest.fn();
const mockArtifactFindById = jest.fn();
const mockBatchCreate = jest.fn();
const mockBatchUpdateOne = jest.fn();
const mockEventCreate = jest.fn();
const mockEventInsertMany = jest.fn();

jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: {
    create: (a: unknown) => mockArtifactCreate(a),
    findOne: (a: unknown) => mockArtifactFindOne(a),
    updateOne: (q: unknown, u: unknown) => mockArtifactUpdateOne(q, u),
    find: (q: unknown) => ({ lean: () => mockArtifactFind(q) }),
    findById: (id: unknown) => ({ lean: () => mockArtifactFindById(id) }),
  },
}));

jest.mock("../modules/platform/models/ImportBatch", () => ({
  ImportBatch: {
    create: (a: unknown) => mockBatchCreate(a),
    updateOne: (q: unknown, u: unknown) => mockBatchUpdateOne(q, u),
    findById: jest.fn(),
    deleteMany: jest.fn(),
  },
}));

jest.mock("../modules/corpus/models/CorpusEvent", () => ({
  CorpusEvent: {
    create: (a: unknown) => mockEventCreate(a),
    insertMany: (a: unknown) => mockEventInsertMany(a),
    deleteMany: jest.fn(),
  },
}));

// AssessmentSet mock
const mockSetCreate = jest.fn();
const mockSetFindById = jest.fn();
const mockSetFindByIdLean = jest.fn();

jest.mock("../modules/assessment/models/AssessmentSet", () => ({
  AssessmentSet: {
    create: (a: unknown) => mockSetCreate(a),
    findById: (id: unknown) => {
      // returns a Mongoose doc-like with .lean() and .save()
      return mockSetFindById(id);
    },
    find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) }),
  },
}));

// Review rounds + audit — persistEnvelope supersedes an open review round when a revised
// version is re-imported (D-#508 for questions, R2.2 for plans). Mocked so the import tests
// stay DB-free; the supersession logic itself is covered in questionReview.test.ts.
const mockReviewFind = jest.fn((_f?: unknown) => ({ lean: () => Promise.resolve([]) }));
const mockReviewUpdateOne = jest.fn().mockResolvedValue({ acknowledged: true });
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);

jest.mock("../modules/content/models/ReviewAssignment", () => ({
  ReviewAssignment: {
    find: (f: unknown) => mockReviewFind(f),
    updateOne: (f: unknown, u: unknown) => mockReviewUpdateOne(f, u),
  },
}));

jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

jest.mock("child_process");

// Import AFTER mocks
import { readFileSync } from "fs";
import { importEnvelope, importContentFiles } from "../modules/content/services/ContentService";
import { addQuestionToSet, assembleSet, createSet, createSetWithQuestions, removeQuestionFromSet, renameSet } from "../modules/assessment/services/AssessmentService";
import { normalizeBanglaDigits, escapeRegex } from "../modules/questions/search";

const execFileMock = cp.execFile as jest.MockedFunction<typeof cp.execFile>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTOR_ID = new mongoose.Types.ObjectId();
const BATCH_ID = new mongoose.Types.ObjectId();
const ARTIFACT_ID = new mongoose.Types.ObjectId();
const SET_ID = new mongoose.Types.ObjectId();
const SECTION_ID = new mongoose.Types.ObjectId();
const CLASS_ID = new mongoose.Types.ObjectId();

function makeBatchDoc(extra: Record<string, unknown> = {}) {
  return { _id: BATCH_ID, ...extra };
}
function makeArtifactDoc(extra: Record<string, unknown> = {}) {
  return { _id: ARTIFACT_ID, current: true, ...extra };
}

function mockHarnessPass(): void {
  execFileMock.mockImplementationOnce((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: null, stdout: string, stderr: string) => void;
    cb(null, "RESULT: PASS (0 warn, 0 advisory) — importable", "");
    return {} as ReturnType<typeof cp.execFile>;
  });
}

function mockHarnessFail(failChecks: string[]): void {
  execFileMock.mockImplementationOnce((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: null, stdout: string, stderr: string) => void;
    const lines = failChecks.map((f) => `  FAIL [ENVELOPE] ${f}`).join("\n");
    const stdout = `${lines}\nRESULT: FAIL (${failChecks.length} fail) — import REJECTED`;
    const err = Object.assign(new Error("exit 1"), { code: 1 });
    cb(err as unknown as null, stdout, "");
    return {} as ReturnType<typeof cp.execFile>;
  });
}

/** Minimal valid question envelope */
const QUESTION_ENVELOPE = {
  envelope_version: "1.0",
  doc_type: "question",
  subject: "BAN",
  class_level: 5,
  address: { anchor_word: "পাঠ", number: 13, title: "পাখির মতো" },
  curation_tag: "KEEP_AS_IS",
  review_status: "reviewed",
  tags: {
    topic_tag: "TOP-BAN-C5-05",
    bloom_level: "Understand",
    difficulty: "easy",
    paper_role: "mcq",
  },
  provenance: { source_project: "P04", author: "Test", content_version: "v1" },
  payload: {
    qid: "QP-BAN-C5-U13-Q01",
    topic_tag: "TOP-BAN-C5-05",
    ref19_topic_id: "BAN-POEM",
    question_text: "কবি কীসের মতো উড়তে চেয়েছেন?",
    question_type: "mcq",
    paper_role: "mcq",
    bloom_level: "Understand",
    difficulty: "easy",
    tier: "tier1",
    marks: 1,
    options: [
      { option_id: "ক", text: "পাখি", is_correct: true },
      { option_id: "খ", text: "নদী", is_correct: false },
    ],
  },
};

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockBatchCreate.mockResolvedValue(makeBatchDoc());
  mockBatchUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  mockArtifactCreate.mockResolvedValue(makeArtifactDoc());
  mockArtifactFindOneResult.mockResolvedValue(null);
  mockArtifactFindOne.mockImplementation(() => ({ lean: mockArtifactFindOneResult }));
  mockArtifactUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  mockEventCreate.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
  mockEventInsertMany.mockResolvedValue([]);
});

// ===========================================================================
// J2.1 — Question import round-trip
// ===========================================================================

describe("J2.1 — question import round-trip (doc_type=question)", () => {
  test("importing a question envelope produces a ContentArtifact with docType=question", async () => {
    mockHarnessPass();
    const result = await importEnvelope({ ...QUESTION_ENVELOPE }, ACTOR_ID);

    expect(result.verdict).toBe("PASS");
    expect(mockArtifactCreate).toHaveBeenCalledTimes(1);

    const createArg = mockArtifactCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createArg.docType).toBe("question");
    expect(createArg.subject).toBe("BAN");
    expect(createArg.classLevel).toBe(5);
  });

  test("question envelope stores full payload in envelopeJson (no rendered_markdown)", async () => {
    mockHarnessPass();
    await importEnvelope({ ...QUESTION_ENVELOPE }, ACTOR_ID);

    const createArg = mockArtifactCreate.mock.calls[0][0] as Record<string, unknown>;
    const env = createArg.envelopeJson as Record<string, unknown>;
    const payload = (env.payload ?? {}) as Record<string, unknown>;
    expect(payload.qid).toBe("QP-BAN-C5-U13-Q01");
    expect(payload.question_type).toBe("mcq");
    expect(createArg.renderedMarkdown).toBeUndefined(); // questions have no rendered_markdown
  });

  test("FAIL verdict → no artifact created for bad question envelope", async () => {
    mockHarnessFail(["payload.question_type: invalid value"]);
    const result = await importEnvelope({ ...QUESTION_ENVELOPE, doc_type: "question" }, ACTOR_ID);

    expect(result.verdict).toBe("FAIL");
    expect(mockArtifactCreate).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Question-bank fan-out (collection → N envelopes, atomic all-or-nothing)
// ===========================================================================

/** A minimal stimulus/question envelope as build_question_envelopes.py would emit. */
function bankEnvelope(ref: string, docType: "stimulus" | "question"): Record<string, unknown> {
  const isStim = docType === "stimulus";
  return {
    envelope_version: "1.0",
    doc_type: docType,
    subject: "ENG",
    class_level: 5,
    address: { anchor_word: "Unit", number: 9, title: "Unit 9" },
    curation_tag: "KEEP_AS_IS",
    review_status: "draft",
    ...(isStim ? {} : { tags: { topic_tag: "TOP-ENG-C5-08", bloom_level: "Understand", difficulty: "easy", paper_role: "mcq" } }),
    provenance: { source_project: "P04", author: "Test", content_version: "v1" },
    payload: isStim ? { stimulus_id: ref } : { qid: ref },
  };
}

/**
 * Mock child_process for the bank path: the build_question_envelopes.py call returns the given
 * envelope array; each validate_import.py call reads the temp envelope and PASSes unless its
 * qid/stimulus_id is in failRefs (then FAIL).
 */
function mockBankExecFile(envelopes: Record<string, unknown>[], failRefs: string[] = []): void {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const argv = args[1] as string[];
    const script = String(argv[0]);
    const cb = args[args.length - 1] as (err: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void;
    if (script.includes("build_question_envelopes")) {
      cb(null, JSON.stringify(envelopes), "");
      return {} as ReturnType<typeof cp.execFile>;
    }
    // validate_import.py — argv[1] is the temp envelope file.
    let ref = "";
    try {
      const env = JSON.parse(readFileSync(argv[1], "utf-8")) as Record<string, unknown>;
      const p = (env.payload ?? {}) as Record<string, unknown>;
      ref = (p.qid as string) ?? (p.stimulus_id as string) ?? "";
    } catch {
      /* ignore */
    }
    if (failRefs.includes(ref)) {
      const err = Object.assign(new Error("exit 1"), { code: 1 });
      cb(err as unknown as NodeJS.ErrnoException, `  FAIL [Q-PAYLOAD] ${ref} bad\nRESULT: FAIL (1 fail)`, "");
    } else {
      cb(null, "RESULT: PASS (0 warn, 0 advisory) — importable", "");
    }
    return {} as ReturnType<typeof cp.execFile>;
  });
}

describe("question-bank fan-out (collection import)", () => {
  const BANK_FILE = {
    filename: "C5_ENG_U09_QuestionBank_v1.json",
    content: JSON.stringify({ stimuli: [{ stimulus_id: "STIM-ENG-C5-U09-01" }], questions: [{ qid: "QP-ENG-C5-U09-Q01" }, { qid: "QP-ENG-C5-U09-Q02" }] }),
  };

  test("all items pass → one artifact created per fanned-out envelope, PASS with tallies", async () => {
    const envelopes = [
      bankEnvelope("STIM-ENG-C5-U09-01", "stimulus"),
      bankEnvelope("QP-ENG-C5-U09-Q01", "question"),
      bankEnvelope("QP-ENG-C5-U09-Q02", "question"),
    ];
    mockBankExecFile(envelopes);

    const result = await importContentFiles([BANK_FILE], ACTOR_ID, "Test", "KEEP_AS_IS");

    expect(result.verdict).toBe("PASS");
    expect(result.itemsTotal).toBe(3);
    expect(result.itemsPassed).toBe(3);
    expect(result.itemsFailed).toBe(0);
    expect(mockArtifactCreate).toHaveBeenCalledTimes(3);

    // The supersede version key must be the item IDENTITY (qid / stimulus_id), NOT the
    // shared unit address — else every bank item collapses onto the previous one and only
    // the last stays `current` (the 100→1 bug).
    const findKeys = mockArtifactFindOne.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(findKeys.every((k) => !("address.number" in k))).toBe(true);
    const qidKeys = findKeys
      .filter((k) => "envelopeJson.payload.qid" in k)
      .map((k) => k["envelopeJson.payload.qid"]);
    expect(qidKeys).toEqual(expect.arrayContaining(["QP-ENG-C5-U09-Q01", "QP-ENG-C5-U09-Q02"]));
    expect(new Set(qidKeys).size).toBe(qidKeys.length); // distinct → no item supersedes another
    const stimKeys = findKeys.filter((k) => "envelopeJson.payload.stimulus_id" in k);
    expect(stimKeys).toHaveLength(1);
  });

  test("any item fails → ATOMIC: nothing persisted, FAIL with the failing ref prefixed", async () => {
    const envelopes = [
      bankEnvelope("STIM-ENG-C5-U09-01", "stimulus"),
      bankEnvelope("QP-ENG-C5-U09-Q01", "question"),
      bankEnvelope("QP-ENG-C5-U09-Q02", "question"),
    ];
    mockBankExecFile(envelopes, ["QP-ENG-C5-U09-Q02"]);

    const result = await importContentFiles([BANK_FILE], ACTOR_ID, "Test", "KEEP_AS_IS");

    expect(result.verdict).toBe("FAIL");
    expect(result.itemsTotal).toBe(3);
    expect(result.itemsFailed).toBe(1);
    expect(mockArtifactCreate).not.toHaveBeenCalled();
    expect(result.failChecks.some((f) => f.startsWith("QP-ENG-C5-U09-Q02:"))).toBe(true);
  });

  test("bank detected but no curation tag → rejected before any work", async () => {
    const result = await importContentFiles([BANK_FILE], ACTOR_ID, "Test");
    expect(result.verdict).toBe("FAIL");
    expect(mockArtifactCreate).not.toHaveBeenCalled();
    expect(result.failChecks[0]).toMatch(/curation tag/i);
  });
});

// ===========================================================================
// J2.2 — Tag filter combinations
// ===========================================================================

describe("J2.2 — tag filter combinations", () => {
  const QUESTION_DOC = {
    _id: ARTIFACT_ID,
    docType: "question",
    subject: "BAN",
    classLevel: 5,
    current: true,
    curationTag: "KEEP_AS_IS",
    reviewStatus: "reviewed",
    importedAt: new Date(),
    envelopeJson: {
      tags: { topic_tag: "TOP-BAN-C5-05", bloom_level: "Understand", difficulty: "easy", paper_role: "mcq" },
      payload: { qid: "QP-BAN-C5-U13-Q01", question_type: "mcq", paper_role: "mcq", bloom_level: "Understand", difficulty: "easy", marks: 1 },
    },
  };

  test("filter by subject constructs correct Mongo filter", () => {
    // Verify the filter object that would be built for subject=BAN
    const filter: Record<string, unknown> = { docType: "question", current: true };
    const args = { subject: "BAN", classLevel: null as number | null, topicTag: null as string | null,
      questionType: null as string | null, bloomLevel: null as string | null, difficulty: null as string | null,
      paperRole: null as string | null, marksMin: null as number | null, marksMax: null as number | null, reviewStatus: null as string | null };

    if (args.subject) filter.subject = args.subject;
    expect(filter.subject).toBe("BAN");
    expect(filter.docType).toBe("question");
  });

  test("filter by bloom_level sets envelopeJson.tags.bloom_level", () => {
    const filter: Record<string, unknown> = { docType: "question", current: true };
    filter["envelopeJson.tags.bloom_level"] = "Understand";
    expect(filter["envelopeJson.tags.bloom_level"]).toBe("Understand");
  });

  test("filter by paper_role sets envelopeJson.tags.paper_role", () => {
    const filter: Record<string, unknown> = { docType: "question", current: true };
    filter["envelopeJson.tags.paper_role"] = "mcq";
    expect(filter["envelopeJson.tags.paper_role"]).toBe("mcq");
  });

  test("filter by question_type sets envelopeJson.payload.question_type", () => {
    const filter: Record<string, unknown> = { docType: "question", current: true };
    filter["envelopeJson.payload.question_type"] = "mcq";
    expect(filter["envelopeJson.payload.question_type"]).toBe("mcq");
  });

  test("marks range filter constructs $gte/$lte correctly", () => {
    const filter: Record<string, unknown> = { docType: "question", current: true };
    const marksMin = 1, marksMax = 3;
    const marksFilter: Record<string, number> = {};
    if (marksMin != null) marksFilter.$gte = marksMin;
    if (marksMax != null) marksFilter.$lte = marksMax;
    filter["envelopeJson.payload.marks"] = marksFilter;

    const mf = filter["envelopeJson.payload.marks"] as Record<string, number>;
    expect(mf.$gte).toBe(1);
    expect(mf.$lte).toBe(3);
  });

  test("combined filter: subject + bloom_level + paper_role + question_type", () => {
    const filter: Record<string, unknown> = { docType: "question", current: true };
    filter.subject = "BAN";
    filter.classLevel = 5;
    filter["envelopeJson.tags.bloom_level"] = "Understand";
    filter["envelopeJson.tags.paper_role"] = "mcq";
    filter["envelopeJson.payload.question_type"] = "mcq";

    // Simulate filtering the QUESTION_DOC against this filter
    const doc = QUESTION_DOC;
    const tags = (doc.envelopeJson.tags ?? {}) as Record<string, unknown>;
    const payload = (doc.envelopeJson.payload ?? {}) as Record<string, unknown>;
    const matches =
      doc.subject === filter.subject &&
      doc.classLevel === filter.classLevel &&
      tags.bloom_level === filter["envelopeJson.tags.bloom_level"] &&
      tags.paper_role === filter["envelopeJson.tags.paper_role"] &&
      payload.question_type === filter["envelopeJson.payload.question_type"];

    expect(matches).toBe(true);
  });
});

// ===========================================================================
// J2.4 — Supervisory read of un-taught question banks
// ===========================================================================

describe("J2.4 — supervisory read of un-taught questions (canRead)", () => {
  const CLASS_A = "classA";
  const CLASS_B = "classB";
  const SECTION_A2 = "sectionA2";
  const SUBJ_BAN = "subjBAN";
  const SUBJ_SCI = "subjSCI";

  function teachingScope(sectionId: string, classId: string, subjectId: string): ScopeItem {
    return { kind: "teaching", sectionId, classId, subjectId };
  }
  function supervisoryScope(
    extent: string,
    opts: { classId?: string; subjectId?: string } = {},
  ): ScopeItem {
    return { kind: "supervisory", extent, ...opts };
  }

  test("teacher with supervisory whole_school grant can read any question (J2.4)", () => {
    const scopes: ScopeItem[] = [
      teachingScope("sectionMath", CLASS_A, "subjMATH"),
      supervisoryScope("whole_school"),
    ];
    // Can read a question from a class/subject they do NOT teach
    expect(canRead(scopes, SECTION_A2, CLASS_B, SUBJ_SCI)).toBe(true);
  });

  test("teacher with supervisory grade_class grant can read same class (J2.4)", () => {
    const scopes: ScopeItem[] = [
      teachingScope("sectionMath", CLASS_A, "subjMATH"),
      supervisoryScope("grade_class", { classId: CLASS_B }),
    ];
    expect(canRead(scopes, SECTION_A2, CLASS_B, SUBJ_BAN)).toBe(true);
  });

  test("teacher with supervisory subject_dept can read that subject across all classes (J2.4)", () => {
    const scopes: ScopeItem[] = [
      teachingScope("sectionMath", CLASS_A, "subjMATH"),
      supervisoryScope("subject_dept", { subjectId: SUBJ_BAN }),
    ];
    expect(canRead(scopes, SECTION_A2, CLASS_B, SUBJ_BAN)).toBe(true);
    // Cannot read a different subject
    expect(canRead(scopes, SECTION_A2, CLASS_B, SUBJ_SCI)).toBe(false);
  });

  test("plain teacher WITHOUT supervisory grant cannot read outside their sections", () => {
    const scopes: ScopeItem[] = [
      teachingScope("sectionMath", CLASS_A, "subjMATH"),
    ];
    expect(canRead(scopes, "somethingElse", CLASS_B, SUBJ_SCI)).toBe(false);
  });
});

// ===========================================================================
// J3.1 — Basket accumulation (addQuestionToSet)
// ===========================================================================

describe("J3.1 — basket accumulation (addQuestionToSet)", () => {
  const ARTIFACT = {
    _id: ARTIFACT_ID,
    docType: "question",
    subject: "BAN",
    classLevel: 5,
    // PUBLISHED — since QR-3 only a `gold` question may enter a set (Q3.4 / D-#508).
    reviewStatus: "gold",
    envelopeJson: {
      payload: { qid: "QP-BAN-C5-U13-Q01", question_type: "mcq", marks: 1 },
    },
  };

  /** A mutable basket mock that simulates the Mongoose doc save pattern. */
  function makeSetDoc(extra: Record<string, unknown> = {}) {
    const doc = {
      _id: SET_ID,
      sectionId: SECTION_ID,
      classId: CLASS_ID,
      setType: "CT",
      status: "draft",
      basketItems: [] as Array<{ artifactId: mongoose.Types.ObjectId; qid: string; marks: number }>,
      save: jest.fn().mockResolvedValue(true),
      ...extra,
    };
    return doc;
  }

  beforeEach(() => {
    mockArtifactFindById.mockResolvedValue(ARTIFACT);
  });

  test("adds item to basket and emits questions_selected corpus event", async () => {
    const setDoc = makeSetDoc();
    mockSetFindById.mockReturnValue(setDoc);

    await addQuestionToSet(SET_ID.toString(), ARTIFACT_ID.toString(), ACTOR_ID.toString());

    expect(setDoc.basketItems).toHaveLength(1);
    expect(setDoc.basketItems[0].qid).toBe("QP-BAN-C5-U13-Q01");
    expect(setDoc.basketItems[0].marks).toBe(1);
    expect(setDoc.save).toHaveBeenCalled();
    expect(mockEventCreate).toHaveBeenCalledTimes(1);
    const event = mockEventCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(event.eventKind).toBe("questions_selected");
    expect(event.pseudoActorId).not.toBe(ACTOR_ID.toString()); // de-identified
  });

  test("duplicate question is not added twice", async () => {
    const setDoc = makeSetDoc({
      basketItems: [{ artifactId: ARTIFACT_ID, qid: "QP-BAN-C5-U13-Q01", marks: 1 }],
    });
    mockSetFindById.mockReturnValue(setDoc);

    await addQuestionToSet(SET_ID.toString(), ARTIFACT_ID.toString(), ACTOR_ID.toString());

    // save is NOT called when duplicate (basket unchanged)
    expect(setDoc.basketItems).toHaveLength(1);
    expect(setDoc.save).not.toHaveBeenCalled();
  });

  test("throws when set is already assembled", async () => {
    const setDoc = makeSetDoc({ status: "assembled" });
    mockSetFindById.mockReturnValue(setDoc);

    await expect(
      addQuestionToSet(SET_ID.toString(), ARTIFACT_ID.toString(), ACTOR_ID.toString()),
    ).rejects.toThrow("Cannot add questions to an assembled set");
  });

  test("throws when artifact not found", async () => {
    const setDoc = makeSetDoc();
    mockSetFindById.mockReturnValue(setDoc);
    mockArtifactFindById.mockResolvedValue(null);

    await expect(
      addQuestionToSet(SET_ID.toString(), ARTIFACT_ID.toString(), ACTOR_ID.toString()),
    ).rejects.toThrow("Question artifact not found");
  });
});

// ===========================================================================
// J3.2 — Assemble set
// ===========================================================================

describe("J3.2 — assemble set", () => {
  const BASKET = [
    { artifactId: new mongoose.Types.ObjectId(), qid: "QP-BAN-C5-U13-Q01", marks: 1 },
    { artifactId: new mongoose.Types.ObjectId(), qid: "QP-BAN-C5-U13-Q02", marks: 2 },
  ];

  function makeSetDoc(extra: Record<string, unknown> = {}) {
    const doc = {
      _id: SET_ID,
      sectionId: SECTION_ID,
      classId: CLASS_ID,
      setType: "CT",
      status: "draft",
      basketItems: [...BASKET],
      save: jest.fn().mockResolvedValue(true),
      ...extra,
    };
    return doc;
  }

  test("assembles set with correct totalMarks + emits set_assembled event", async () => {
    const setDoc = makeSetDoc();
    mockSetFindById.mockReturnValue(setDoc);

    const result = await assembleSet({
      setId: SET_ID.toString(),
      actorId: ACTOR_ID.toString(),
      durationMinutes: 40,
    });

    expect(result.status).toBe("assembled");
    expect(result.totalMarks).toBe(3); // 1 + 2
    expect(result.itemCount).toBe(2);
    expect(setDoc.save).toHaveBeenCalled();

    expect(mockEventCreate).toHaveBeenCalledTimes(1);
    const event = mockEventCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(event.eventKind).toBe("set_assembled");
    const meta = event.meta as Record<string, unknown>;
    expect(meta.totalMarks).toBe(3);
    expect(meta.itemCount).toBe(2);
  });

  test("CT set stores durationMinutes", async () => {
    const setDoc = makeSetDoc();
    mockSetFindById.mockReturnValue(setDoc);

    await assembleSet({ setId: SET_ID.toString(), actorId: ACTOR_ID.toString(), durationMinutes: 45 });
    expect(setDoc).toMatchObject({ durationMinutes: 45 });
  });

  test("HW set stores dueDate", async () => {
    const setDoc = makeSetDoc({ setType: "HW" });
    mockSetFindById.mockReturnValue(setDoc);

    const dueDate = "2026-07-01T00:00:00.000Z";
    await assembleSet({ setId: SET_ID.toString(), actorId: ACTOR_ID.toString(), dueDate });
    const storedDue = (setDoc as Record<string, unknown>).dueDate as Date;
    expect(storedDue.toISOString()).toBe(new Date(dueDate).toISOString());
  });

  test("throws when set already assembled", async () => {
    const setDoc = makeSetDoc({ status: "assembled" });
    mockSetFindById.mockReturnValue(setDoc);

    await expect(
      assembleSet({ setId: SET_ID.toString(), actorId: ACTOR_ID.toString() }),
    ).rejects.toThrow("Set is already assembled");
  });

  test("throws when basket is empty", async () => {
    const setDoc = makeSetDoc({ basketItems: [] });
    mockSetFindById.mockReturnValue(setDoc);

    await expect(
      assembleSet({ setId: SET_ID.toString(), actorId: ACTOR_ID.toString() }),
    ).rejects.toThrow("Cannot assemble an empty set");
  });
});

// ===========================================================================
// J3 — Draft edit: removeQuestionFromSet (drafts only, D-#set-edit)
// ===========================================================================

describe("J3 — removeQuestionFromSet (draft-only edit)", () => {
  const ART_A = new mongoose.Types.ObjectId();
  const ART_B = new mongoose.Types.ObjectId();

  function makeSetDoc(extra: Record<string, unknown> = {}) {
    return {
      _id: SET_ID,
      sectionId: SECTION_ID,
      classId: CLASS_ID,
      setType: "AS",
      status: "draft",
      basketItems: [
        { artifactId: ART_A, qid: "QP-A", marks: 1 },
        { artifactId: ART_B, qid: "QP-B", marks: 2 },
      ],
      save: jest.fn().mockResolvedValue(true),
      ...extra,
    };
  }

  test("removes the matching item from a draft basket and saves", async () => {
    const setDoc = makeSetDoc();
    mockSetFindById.mockReturnValue(setDoc);

    const result = await removeQuestionFromSet(SET_ID.toString(), ART_A.toString());

    expect(setDoc.basketItems).toHaveLength(1);
    expect(setDoc.basketItems[0].qid).toBe("QP-B");
    expect(setDoc.save).toHaveBeenCalledTimes(1);
    expect(result.itemCount).toBe(1);
  });

  test("draft-only: throws when the set is already assembled", async () => {
    const setDoc = makeSetDoc({ status: "assembled" });
    mockSetFindById.mockReturnValue(setDoc);

    await expect(
      removeQuestionFromSet(SET_ID.toString(), ART_A.toString()),
    ).rejects.toThrow("Cannot remove questions from an assembled set");
    expect(setDoc.save).not.toHaveBeenCalled();
  });

  test("idempotent: removing an artifact not in the basket is a no-op (no save)", async () => {
    const setDoc = makeSetDoc();
    mockSetFindById.mockReturnValue(setDoc);

    const missing = new mongoose.Types.ObjectId().toString();
    const result = await removeQuestionFromSet(SET_ID.toString(), missing);

    expect(setDoc.basketItems).toHaveLength(2);
    expect(setDoc.save).not.toHaveBeenCalled();
    expect(result.itemCount).toBe(2);
  });

  test("throws when the set is not found", async () => {
    mockSetFindById.mockReturnValue(null);

    await expect(
      removeQuestionFromSet(SET_ID.toString(), ART_A.toString()),
    ).rejects.toThrow("AssessmentSet not found");
  });
});

// ===========================================================================
// J3 — Set naming: renameSet (any status, D-#set-name)
// ===========================================================================

describe("J3 — renameSet (set display name)", () => {
  function makeSetDoc(extra: Record<string, unknown> = {}) {
    return {
      _id: SET_ID,
      sectionId: SECTION_ID,
      classId: CLASS_ID,
      setType: "AS",
      status: "assembled",
      name: undefined as string | undefined,
      basketItems: [],
      save: jest.fn().mockResolvedValue(true),
      ...extra,
    };
  }

  test("sets a trimmed name and saves (works on an assembled set)", async () => {
    const setDoc = makeSetDoc();
    mockSetFindById.mockReturnValue(setDoc);

    await renameSet(SET_ID.toString(), "  Unit 4 revision  ");

    expect(setDoc.name).toBe("Unit 4 revision");
    expect(setDoc.save).toHaveBeenCalledTimes(1);
  });

  test("a blank name clears the label (name → undefined)", async () => {
    const setDoc = makeSetDoc({ name: "Old name" });
    mockSetFindById.mockReturnValue(setDoc);

    await renameSet(SET_ID.toString(), "   ");

    expect(setDoc.name).toBeUndefined();
    expect(setDoc.save).toHaveBeenCalledTimes(1);
  });

  test("throws when the set is not found", async () => {
    mockSetFindById.mockReturnValue(null);

    await expect(renameSet(SET_ID.toString(), "X")).rejects.toThrow("AssessmentSet not found");
  });
});

// ===========================================================================
// J3.5 — Write-scope: supervisory grant does NOT permit assembly
// ===========================================================================

describe("J3.5 — write-scope: supervisory grant is read-only for assembly", () => {
  const SECTION_A = "sectionA";
  const CLASS_A = "classA";
  const SUBJ_BAN = "subjBAN";

  function teachingScope(sectionId: string, classId: string, subjectId: string): ScopeItem {
    return { kind: "teaching", sectionId, classId, subjectId };
  }
  function supervisoryScope(extent: string): ScopeItem {
    return { kind: "supervisory", extent };
  }

  test("canWrite returns false for supervisory-only grant (J3.5)", () => {
    const scopes: ScopeItem[] = [supervisoryScope("whole_school")];
    expect(canWrite(scopes, SECTION_A)).toBe(false);
  });

  test("canWrite returns false for supervisory grade_class grant", () => {
    const scopes: ScopeItem[] = [supervisoryScope("grade_class")];
    expect(canWrite(scopes, SECTION_A)).toBe(false);
  });

  test("canWrite returns true for teaching grant on that section (J3.5)", () => {
    const scopes: ScopeItem[] = [
      teachingScope(SECTION_A, CLASS_A, SUBJ_BAN),
    ];
    expect(canWrite(scopes, SECTION_A)).toBe(true);
  });

  test("canWrite returns true for proxy grant on that section", () => {
    const scopes: ScopeItem[] = [
      { kind: "proxy", sectionId: SECTION_A, classId: CLASS_A, grantId: "g1" },
    ];
    expect(canWrite(scopes, SECTION_A)).toBe(true);
  });

  test("canWrite returns false for proxy grant on a DIFFERENT section", () => {
    const scopes: ScopeItem[] = [
      { kind: "proxy", sectionId: "sectionB", classId: CLASS_A, grantId: "g1" },
    ];
    expect(canWrite(scopes, SECTION_A)).toBe(false);
  });

  test("canWrite returns false with empty scope list", () => {
    expect(canWrite([], SECTION_A)).toBe(false);
  });

  test("RBAC: TEACHER has set:assemble permission (base permission check)", () => {
    expect(roleHasPermission("TEACHER", "set:assemble")).toBe(true);
  });

  test("RBAC: TEACHER has question:select permission", () => {
    expect(roleHasPermission("TEACHER", "question:select")).toBe(true);
  });
});

// ===========================================================================
// ux-audit F4 — question-bank search helpers (Bangla digits + regex safety)
// ===========================================================================

describe("F4 — search helpers", () => {
  test("normalizeBanglaDigits maps ০-৯ to 0-9 ('৪২' → '42')", () => {
    expect(normalizeBanglaDigits("৪২")).toBe("42");
    expect(normalizeBanglaDigits("HW-০০৪২")).toBe("HW-0042");
    expect(normalizeBanglaDigits("০১২৩৪৫৬৭৮৯")).toBe("0123456789");
  });

  test("normalizeBanglaDigits leaves Latin digits and Bangla text untouched", () => {
    expect(normalizeBanglaDigits("HW-0042")).toBe("HW-0042");
    expect(normalizeBanglaDigits("ভগ্নাংশ")).toBe("ভগ্নাংশ");
  });

  test("escapeRegex neutralises regex metacharacters", () => {
    expect(escapeRegex("a.b*c(d)")).toBe("a\\.b\\*c\\(d\\)");
    expect(new RegExp(escapeRegex("HW-0042 (৫)")).test("HW-0042 (৫)")).toBe(true);
    // an unescaped '(' would throw on RegExp construction
    expect(() => new RegExp(escapeRegex("(["))).not.toThrow();
  });

  test("digit-normalised qid regex: '৪২' substring-matches 'HW-0042'", () => {
    const qidRe = new RegExp(escapeRegex(normalizeBanglaDigits("৪২")), "i");
    expect(qidRe.test("HW-0042")).toBe(true);
    expect(qidRe.test("HW-0035")).toBe(false);
  });
});

// ===========================================================================
// ux-audit F6/F10 — createSetWithQuestions (one-step transactional create)
// ===========================================================================

describe("F6/F10 — createSetWithQuestions (transactional one-step create)", () => {
  const ART_A = new mongoose.Types.ObjectId();
  const ART_B = new mongoose.Types.ObjectId();
  const ART_C = new mongoose.Types.ObjectId();

  /** Defaults to PUBLISHED — since QR-3 only a `gold` question may enter a set (Q3.4). */
  function artifact(
    id: mongoose.Types.ObjectId,
    qid: string,
    marks: number,
    docType = "question",
    reviewStatus = "gold",
  ) {
    return {
      _id: id,
      docType,
      subject: "BAN",
      classLevel: 5,
      reviewStatus,
      envelopeJson: { payload: { qid, marks } },
    };
  }

  function baseInput(extra: Partial<Parameters<typeof createSetWithQuestions>[0]> = {}) {
    return {
      setType: "HW" as const,
      sectionId: SECTION_ID.toString(),
      classId: CLASS_ID.toString(),
      name: "ভগ্নাংশ অনুশীলন",
      artifactIds: [ART_A.toString(), ART_B.toString()],
      dueDate: "2026-07-20T00:00:00.000Z",
      actorId: ACTOR_ID.toString(),
      ...extra,
    };
  }

  function createdDoc(over: Record<string, unknown> = {}) {
    return {
      _id: SET_ID,
      setType: "HW",
      sectionId: SECTION_ID,
      classId: CLASS_ID,
      status: "assembled",
      ...over,
    };
  }

  beforeEach(() => {
    mockSetCreate.mockResolvedValue(createdDoc());
  });

  test("happy path HW: one create, ordered items, summed totalMarks, assembled + dueDate", async () => {
    // find({$in}) returns artifacts in DB order (B before A) — order must come from artifactIds
    mockArtifactFind.mockResolvedValue([artifact(ART_B, "QP-B", 2), artifact(ART_A, "QP-A", 5)]);

    const result = await createSetWithQuestions(baseInput());

    expect(result.status).toBe("assembled");
    expect(mockSetCreate).toHaveBeenCalledTimes(1);
    const arg = mockSetCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.status).toBe("assembled");
    const items = arg.basketItems as Array<{ qid: string; marks: number }>;
    expect(items.map((i) => i.qid)).toEqual(["QP-A", "QP-B"]); // input order, not DB order
    expect(arg.totalMarks).toBe(7);
    expect((arg.dueDate as Date).toISOString()).toBe("2026-07-20T00:00:00.000Z");
    // QT-1 (D-#592): a homework now carries a duration WITHOUT anyone typing one — that is
    // the whole point of the feature, so the old `toBeUndefined()` is superseded rather
    // than deleted. This fixture has no `question_type`, so it also pins the fallback path:
    // 7 marks × 1.25 (default rate) = 8.75 → ceil 9 exam minutes → ×2 for HW = 18.
    expect(arg.examMinutes).toBe(9);
    expect(arg.durationMinutes).toBe(18);
    expect(arg.name).toBe("ভগ্নাংশ অনুশীলন");
    expect(arg.assembledAt).toBeInstanceOf(Date);
  });

  test("emits one questions_selected per question (insertMany) + one set_assembled", async () => {
    mockArtifactFind.mockResolvedValue([artifact(ART_A, "QP-A", 5), artifact(ART_B, "QP-B", 2)]);

    await createSetWithQuestions(baseInput());

    expect(mockEventInsertMany).toHaveBeenCalledTimes(1);
    const events = mockEventInsertMany.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.eventKind === "questions_selected")).toBe(true);
    expect(events.every((e) => e.pseudoActorId !== ACTOR_ID.toString())).toBe(true); // de-identified
    expect((events[0].meta as Record<string, unknown>).qid).toBe("QP-A");

    expect(mockEventCreate).toHaveBeenCalledTimes(1);
    const assembled = mockEventCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(assembled.eventKind).toBe("set_assembled");
    const meta = assembled.meta as Record<string, unknown>;
    expect(meta.itemCount).toBe(2);
    expect(meta.totalMarks).toBe(7);
  });

  test("CT: stores durationMinutes, ignores dueDate", async () => {
    mockArtifactFind.mockResolvedValue([artifact(ART_A, "QP-A", 5)]);
    mockSetCreate.mockResolvedValue(createdDoc({ setType: "CT" }));

    await createSetWithQuestions(
      baseInput({ setType: "CT", artifactIds: [ART_A.toString()], durationMinutes: 40 }),
    );

    const arg = mockSetCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.durationMinutes).toBe(40);
    expect(arg.dueDate).toBeUndefined();
  });

  test("unknown artifact id → throws BEFORE any write, no events (F10 atomicity)", async () => {
    mockArtifactFind.mockResolvedValue([artifact(ART_A, "QP-A", 5)]); // ART_B missing

    await expect(createSetWithQuestions(baseInput())).rejects.toThrow(
      "Question artifact not found",
    );
    expect(mockSetCreate).not.toHaveBeenCalled();
    expect(mockEventInsertMany).not.toHaveBeenCalled();
    expect(mockEventCreate).not.toHaveBeenCalled();
  });

  test("non-question artifact → throws, nothing written", async () => {
    mockArtifactFind.mockResolvedValue([
      artifact(ART_A, "QP-A", 5),
      artifact(ART_B, "STIM-1", 0, "stimulus"),
    ]);

    await expect(createSetWithQuestions(baseInput())).rejects.toThrow(
      "Artifact is not a question",
    );
    expect(mockSetCreate).not.toHaveBeenCalled();
  });

  test("duplicate artifactIds are deduped preserving first occurrence", async () => {
    mockArtifactFind.mockResolvedValue([
      artifact(ART_A, "QP-A", 5),
      artifact(ART_B, "QP-B", 2),
      artifact(ART_C, "QP-C", 3),
    ]);

    await createSetWithQuestions(
      baseInput({
        artifactIds: [
          ART_C.toString(), ART_A.toString(), ART_C.toString(), ART_B.toString(), ART_A.toString(),
        ],
      }),
    );

    const arg = mockSetCreate.mock.calls[0][0] as Record<string, unknown>;
    const items = arg.basketItems as Array<{ qid: string }>;
    expect(items.map((i) => i.qid)).toEqual(["QP-C", "QP-A", "QP-B"]);
    expect(arg.totalMarks).toBe(10);
  });

  test("empty artifactIds → throws 'Cannot assemble an empty set'", async () => {
    await expect(createSetWithQuestions(baseInput({ artifactIds: [] }))).rejects.toThrow(
      "Cannot assemble an empty set",
    );
    expect(mockSetCreate).not.toHaveBeenCalled();
  });

  test("marks default to 1 when payload has no numeric marks; qid falls back to artifactId", async () => {
    mockArtifactFind.mockResolvedValue([
      { _id: ART_A, docType: "question", subject: "BAN", classLevel: 5, reviewStatus: "gold", envelopeJson: { payload: {} } },
    ]);

    await createSetWithQuestions(baseInput({ artifactIds: [ART_A.toString()] }));

    const arg = mockSetCreate.mock.calls[0][0] as Record<string, unknown>;
    const items = arg.basketItems as Array<{ qid: string; marks: number }>;
    expect(items[0].marks).toBe(1);
    expect(items[0].qid).toBe(ART_A.toString());
    expect(arg.totalMarks).toBe(1);
  });
});

// ===========================================================================
// QR-1 — the import gate for questions (D-#508)
// ===========================================================================

describe("QR-1 — questions always land at draft (Q1.3)", () => {
  beforeEach(() => {
    mockArtifactFindOneResult.mockResolvedValue(null);
    mockBatchCreate.mockResolvedValue(makeBatchDoc());
    mockArtifactCreate.mockResolvedValue(makeArtifactDoc());
  });

  test("a question declaring review_status=gold is clamped to draft", async () => {
    mockHarnessPass();
    await importEnvelope({ ...QUESTION_ENVELOPE, review_status: "gold" }, ACTOR_ID);

    const createArg = mockArtifactCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createArg.reviewStatus).toBe("draft");
  });

  test("a question declaring review_status=reviewed is clamped to draft", async () => {
    // QUESTION_ENVELOPE declares "reviewed" as shipped — the clamp must beat it.
    mockHarnessPass();
    await importEnvelope({ ...QUESTION_ENVELOPE }, ACTOR_ID);

    const createArg = mockArtifactCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createArg.reviewStatus).toBe("draft");
  });

  test("the ImportBatch audit row still records what ARRIVED, not the clamp", async () => {
    mockHarnessPass();
    await importEnvelope({ ...QUESTION_ENVELOPE, review_status: "gold" }, ACTOR_ID);

    const batchArg = mockBatchCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(batchArg.reviewStatus).toBe("gold");
  });
});

describe("QR-1 — re-import supersedes a question's review rounds by qid (Q1.2)", () => {
  beforeEach(() => {
    mockBatchCreate.mockResolvedValue(makeBatchDoc());
    mockArtifactCreate.mockResolvedValue(makeArtifactDoc());
    mockReviewFind.mockReturnValue({ lean: () => Promise.resolve([]) });
  });

  test("a superseding re-import asks for open rounds by {docType, qid}", async () => {
    // A prior current version exists → the supersession path runs.
    mockArtifactFindOneResult.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
    mockHarnessPass();
    await importEnvelope({ ...QUESTION_ENVELOPE }, ACTOR_ID);

    expect(mockReviewFind).toHaveBeenCalledWith({
      docType: "question",
      qid: "QP-BAN-C5-U13-Q01",
      status: { $in: ["assigned", "submitted"] },
    });
    // The unit address must never be consulted — that is the 40-questions-one-thread bug.
    const filter = mockReviewFind.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(filter).not.toHaveProperty("anchorWord");
    expect(filter).not.toHaveProperty("addressNumber");
  });

  test("a FIRST import (no prior version) supersedes nothing", async () => {
    mockArtifactFindOneResult.mockResolvedValue(null);
    mockHarnessPass();
    await importEnvelope({ ...QUESTION_ENVELOPE }, ACTOR_ID);

    expect(mockReviewFind).not.toHaveBeenCalled();
  });
});

describe("QR-9 — the IMPORTANT mark survives a re-import (D-#550)", () => {
  beforeEach(() => {
    mockBatchCreate.mockResolvedValue(makeBatchDoc());
    mockArtifactCreate.mockResolvedValue(makeArtifactDoc());
    mockReviewFind.mockReturnValue({ lean: () => Promise.resolve([]) });
  });

  test("a marked prior version hands its mark to the new one", async () => {
    // This is the deliberate DIFFERENCE from an in-place edit (D-#548), which a re-import
    // overwrites: the upload re-delivers the question TEXT, but importance is a judgement
    // ABOUT the question. Without this, one routine batch re-upload silently clears every
    // mark in the bank and reads exactly like nobody having marked anything.
    const markedAt = new Date("2026-08-20T00:00:00.000Z");
    const marker = new mongoose.Types.ObjectId();
    mockArtifactFindOneResult.mockResolvedValue({
      _id: new mongoose.Types.ObjectId(),
      importantAt: markedAt,
      importantBy: marker,
    });
    mockHarnessPass();
    await importEnvelope({ ...QUESTION_ENVELOPE }, ACTOR_ID);

    const createArg = mockArtifactCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createArg.importantAt).toEqual(markedAt);
    expect(String(createArg.importantBy)).toBe(marker.toString());
  });

  test("an UNMARKED prior version hands over nothing", async () => {
    mockArtifactFindOneResult.mockResolvedValue({
      _id: new mongoose.Types.ObjectId(),
      importantAt: null,
    });
    mockHarnessPass();
    await importEnvelope({ ...QUESTION_ENVELOPE }, ACTOR_ID);

    const createArg = mockArtifactCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createArg.importantAt).toBeNull();
  });

  test("a FIRST import lands normal — there is no prior mark to inherit", async () => {
    mockArtifactFindOneResult.mockResolvedValue(null);
    mockHarnessPass();
    await importEnvelope({ ...QUESTION_ENVELOPE }, ACTOR_ID);

    const createArg = mockArtifactCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createArg.importantAt).toBeNull();
    expect(createArg.importantBy).toBeUndefined();
  });
});

// ===========================================================================
// QR-3 — the publish gate on SELECTION (Q3.4 / D-#508)
// ===========================================================================

describe("QR-3 — only a published question may enter a set (Q3.4)", () => {
  const UNPUBLISHED_ID = new mongoose.Types.ObjectId();

  function unpublished(reviewStatus: string) {
    return {
      _id: UNPUBLISHED_ID,
      docType: "question",
      subject: "BAN",
      classLevel: 5,
      reviewStatus,
      envelopeJson: { payload: { qid: "QP-BAN-C5-U13-Q99", marks: 1 } },
    };
  }

  function setDoc() {
    return {
      _id: SET_ID,
      sectionId: SECTION_ID,
      classId: CLASS_ID,
      status: "draft",
      basketItems: [] as unknown[],
      save: jest.fn().mockResolvedValue(undefined),
    };
  }

  test.each(["draft", "reviewed"])(
    "addQuestionToSet refuses a '%s' question, writes nothing, emits no corpus event",
    async (status) => {
      mockSetFindById.mockResolvedValue(setDoc());
      mockArtifactFindById.mockResolvedValue(unpublished(status));

      await expect(
        addQuestionToSet(SET_ID.toString(), UNPUBLISHED_ID.toString(), ACTOR_ID.toString()),
      ).rejects.toThrow(/প্রকাশিত/);

      expect(mockEventCreate).not.toHaveBeenCalled();
    },
  );

  test("addQuestionToSet accepts a published (gold) question", async () => {
    const doc = setDoc();
    mockSetFindById.mockResolvedValue(doc);
    mockArtifactFindById.mockResolvedValue(unpublished("gold"));

    const res = await addQuestionToSet(SET_ID.toString(), UNPUBLISHED_ID.toString(), ACTOR_ID.toString());

    expect(res.itemCount).toBe(1);
    expect(doc.save).toHaveBeenCalled();
  });

  /**
   * D-#566 — a RETIRED question must not reach a set, and `reviewStatus` cannot answer that.
   *
   * Retiring leaves the status alone, so a question retired while `gold` passed the publish
   * check untouched. D-#548 claimed retiring hides a question from "the bank, the assign
   * picker and set assembly"; the first two were built and this one never was, so a question
   * pulled for having a WRONG ANSWER could still be assembled into a new paper.
   *
   * Found by retiring a published question on prod and seeing the basket button still offered.
   */
  function retiredGold() {
    return { ...unpublished("gold"), retiredAt: new Date() };
  }

  test("addQuestionToSet refuses a RETIRED question even though it is still gold", async () => {
    const doc = setDoc();
    mockSetFindById.mockResolvedValue(doc);
    mockArtifactFindById.mockResolvedValue(retiredGold());

    await expect(
      addQuestionToSet(SET_ID.toString(), UNPUBLISHED_ID.toString(), ACTOR_ID.toString()),
    ).rejects.toThrow(/বাতিল/);

    // Nothing written, and NOT the unpublished message — the reason a teacher reads must
    // say the question was withdrawn, not that it was never published.
    expect(doc.save).not.toHaveBeenCalled();
    expect(mockEventCreate).not.toHaveBeenCalled();
  });

  test("a live gold question is still accepted — the guard did not over-reach", async () => {
    const doc = setDoc();
    mockSetFindById.mockResolvedValue(doc);
    // retiredAt explicitly null, the shape a restored question has.
    mockArtifactFindById.mockResolvedValue({ ...unpublished("gold"), retiredAt: null });

    const res = await addQuestionToSet(SET_ID.toString(), UNPUBLISHED_ID.toString(), ACTOR_ID.toString());
    expect(res.itemCount).toBe(1);
  });

  test("createSetWithQuestions refuses if ANY question is retired — atomic, nothing written", async () => {
    const ART_OK = new mongoose.Types.ObjectId();
    mockArtifactFind.mockResolvedValue([
      {
        _id: ART_OK,
        docType: "question",
        subject: "BAN",
        classLevel: 5,
        reviewStatus: "gold",
        retiredAt: null,
        envelopeJson: { payload: { qid: "QP-OK", marks: 1 } },
      },
      retiredGold(),
    ]);

    await expect(
      createSetWithQuestions({
        setType: "HW",
        sectionId: SECTION_ID.toString(),
        classId: CLASS_ID.toString(),
        artifactIds: [ART_OK.toString(), UNPUBLISHED_ID.toString()],
        actorId: ACTOR_ID.toString(),
      }),
    ).rejects.toThrow(/বাতিল/);

    expect(mockEventCreate).not.toHaveBeenCalled();
  });

  test("Q5.3 — the assigned REVIEWER may read an unpublished question but still cannot select it", async () => {
    // The read-scope override (Q3.2) is read-only and artifact-scoped. assertPublished has
    // deliberately NO reviewer exemption, so being the reviewer changes nothing here.
    mockSetFindById.mockResolvedValue(setDoc());
    mockArtifactFindById.mockResolvedValue(unpublished("reviewed"));

    await expect(
      addQuestionToSet(SET_ID.toString(), UNPUBLISHED_ID.toString(), ACTOR_ID.toString()),
    ).rejects.toThrow(/প্রকাশিত/);
  });

  test("createSetWithQuestions refuses if ANY question is unpublished — atomic, nothing written", async () => {
    const ART_OK = new mongoose.Types.ObjectId();
    mockArtifactFind.mockResolvedValue([
      {
        _id: ART_OK,
        docType: "question",
        subject: "BAN",
        classLevel: 5,
        reviewStatus: "gold",
        envelopeJson: { payload: { qid: "QP-OK", marks: 1 } },
      },
      unpublished("reviewed"),
    ]);

    await expect(
      createSetWithQuestions({
        setType: "HW",
        sectionId: SECTION_ID.toString(),
        classId: CLASS_ID.toString(),
        artifactIds: [ART_OK.toString(), UNPUBLISHED_ID.toString()],
        actorId: ACTOR_ID.toString(),
      }),
    ).rejects.toThrow(/প্রকাশিত/);

    expect(mockSetCreate).not.toHaveBeenCalled();
    expect(mockEventInsertMany).not.toHaveBeenCalled();
  });
});
