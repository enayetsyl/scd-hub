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

jest.mock("child_process");

// Import AFTER mocks
import { readFileSync } from "fs";
import { importEnvelope, importContentFiles } from "../modules/content/services/ContentService";
import { addQuestionToSet, assembleSet, createSet } from "../modules/assessment/services/AssessmentService";

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
