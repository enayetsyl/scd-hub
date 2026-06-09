/**
 * Slice 1 content-import tests (J1.1–J1.4, J1.9).
 *
 * Uses Jest mocks for Mongoose models and child_process — no Atlas or in-memory
 * DB required. The Python harness is replaced by mock subprocess output so gate
 * logic can be exercised deterministically.
 *
 * What the gate contract does is separately verified by validate_import.py's own
 * Python test suite; here we verify the Node.js service layer reacts correctly to
 * PASS/FAIL/advisory output from the harness.
 */

import * as cp from "child_process";
import mongoose from "mongoose";
import { roleHasPermission } from "@scd/shared";

// ---------------------------------------------------------------------------
// Mock Mongoose model modules BEFORE importing the service under test
// ---------------------------------------------------------------------------

const mockArtifactCreate = jest.fn();
const mockArtifactFindOneResult = jest.fn().mockResolvedValue(null);
const mockArtifactUpdateOne = jest.fn();
const mockBatchCreate = jest.fn();
const mockBatchUpdateOne = jest.fn();
const mockEventCreate = jest.fn();

// findOne must return a query-like object with .lean()
const mockArtifactFindOne = jest.fn((_q?: unknown) => ({ lean: mockArtifactFindOneResult }));

jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: {
    create: (a: unknown) => mockArtifactCreate(a),
    findOne: (a: unknown) => mockArtifactFindOne(a),
    updateOne: (q: unknown, u: unknown) => mockArtifactUpdateOne(q, u),
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

jest.mock("child_process");

// Import AFTER mocks are installed
import { importEnvelope } from "../modules/content/services/ContentService";

const execFileMock = cp.execFile as jest.MockedFunction<typeof cp.execFile>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTOR_ID = new mongoose.Types.ObjectId();
const BATCH_ID = new mongoose.Types.ObjectId();
const ARTIFACT_ID = new mongoose.Types.ObjectId();

function makeBatchDoc(extra: Record<string, unknown> = {}) {
  return { _id: BATCH_ID, ...extra };
}

function makeArtifactDoc(extra: Record<string, unknown> = {}) {
  return { _id: ARTIFACT_ID, current: true, ...extra };
}

function mockHarnessPass(advisories: string[] = [], warnings: string[] = []): void {
  execFileMock.mockImplementationOnce((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: null, stdout: string, stderr: string) => void;
    const advLines = advisories.map((a) => `  ADVISORY [REF21] ${a}`).join("\n");
    const warnLines = warnings.map((w) => `  WARN [PIN] ${w}`).join("\n");
    const stdout = [
      "\n=== test.json ===",
      advLines,
      warnLines,
      `RESULT: PASS (${warnings.length} warn, ${advisories.length} advisory) — importable`,
    ].join("\n");
    cb(null, stdout, "");
    return {} as ReturnType<typeof cp.execFile>;
  });
}

function mockHarnessFail(failChecks: string[]): void {
  execFileMock.mockImplementationOnce((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: null, stdout: string, stderr: string) => void;
    const failLines = failChecks.map((f) => `  FAIL [ENVELOPE] ${f}`).join("\n");
    const stdout = [
      "\n=== test.json ===",
      failLines,
      `RESULT: FAIL (${failChecks.length} fail, 0 warn, 0 advisory) — import REJECTED`,
    ].join("\n");
    const err = Object.assign(new Error("exit 1"), { code: 1, stdout, stderr: "" });
    cb(err as unknown as null, stdout, "");
    return {} as ReturnType<typeof cp.execFile>;
  });
}

const VALID_ENVELOPE = {
  envelope_version: "1.0",
  doc_type: "session_plan",
  subject: "ENG",
  class_level: 5,
  address: { anchor_word: "Unit", number: 9, title: "What is an announcement?" },
  curation_tag: "KEEP_AS_IS",
  review_status: "reviewed",
  pinned_to: { chapter_layout: "v3.2" },
  tags: { bloom_level: "Understand" },
  provenance: { source_project: "P03", author: "Test", content_version: "v1" },
  rendered_markdown: "# পিরিয়ড 1: Test\n\nবাংলা টেক্সট এখানে।",
  payload: { schema_version: "1.0", plan_type: "session_plan", subject: "ENG", class_level: 5 },
};

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  // Default DB mock return values
  mockBatchCreate.mockResolvedValue(makeBatchDoc());
  mockBatchUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  mockArtifactCreate.mockResolvedValue(makeArtifactDoc());
  // findOne returns a query-like; .lean() resolves to null by default (no prior version)
  mockArtifactFindOneResult.mockResolvedValue(null);
  mockArtifactFindOne.mockImplementation(() => ({ lean: mockArtifactFindOneResult }));
  mockArtifactUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  mockEventCreate.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
});

// ---------------------------------------------------------------------------
// J1.4 — RBAC check (does not need DB or harness)
// ---------------------------------------------------------------------------

describe("J1.4 — content:import RBAC (R-AC1/R-AC8)", () => {
  test("TEACHER does not hold content:import (default-deny)", () => {
    expect(roleHasPermission("TEACHER", "content:import")).toBe(false);
  });
  test("PRINCIPAL holds content:import", () => {
    expect(roleHasPermission("PRINCIPAL", "content:import")).toBe(true);
  });
  test("OFFICE holds content:import", () => {
    expect(roleHasPermission("OFFICE", "content:import")).toBe(true);
  });
  test("GUARDIAN does not hold content:import", () => {
    expect(roleHasPermission("GUARDIAN", "content:import")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// J1.1 — import a valid envelope
// ---------------------------------------------------------------------------

describe("J1.1 — import valid envelope", () => {
  test("PASS verdict → ContentArtifact.create called with renderedMarkdown", async () => {
    mockHarnessPass();
    const result = await importEnvelope({ ...VALID_ENVELOPE }, ACTOR_ID);

    expect(result.verdict).toBe("PASS");
    expect(mockArtifactCreate).toHaveBeenCalledTimes(1);

    const createArg = mockArtifactCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createArg.renderedMarkdown).toContain("বাংলা");
    expect(createArg.curationTag).toBe("KEEP_AS_IS");
    expect(createArg.reviewStatus).toBe("reviewed");
    expect(createArg.current).toBe(true);
  });

  test("PASS → ImportBatch.create called with verdict=PASS", async () => {
    mockHarnessPass();
    await importEnvelope({ ...VALID_ENVELOPE }, ACTOR_ID);

    expect(mockBatchCreate).toHaveBeenCalledTimes(1);
    const batchArg = mockBatchCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(batchArg.verdict).toBe("PASS");
  });

  test("PASS → CorpusEvent.create called with content_imported (de-identified)", async () => {
    mockHarnessPass();
    await importEnvelope({ ...VALID_ENVELOPE }, ACTOR_ID);

    expect(mockEventCreate).toHaveBeenCalledTimes(1);
    const eventArg = mockEventCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(eventArg.eventKind).toBe("content_imported");
    // pseudoActorId must NOT equal the raw actor id string (de-identified, ADR-005)
    expect(eventArg.pseudoActorId).not.toBe(ACTOR_ID.toString());
  });

  test("PASS with advisories → advisories surfaced, verdict still PASS (J1.3)", async () => {
    mockHarnessPass(["possible curation trigger 'dance' (music-dance)"]);
    const result = await importEnvelope({ ...VALID_ENVELOPE }, ACTOR_ID);

    expect(result.verdict).toBe("PASS");
    expect(result.advisories.length).toBeGreaterThan(0);
    expect(result.advisories[0]).toMatch(/REF21/);
  });
});

// ---------------------------------------------------------------------------
// J1.2 — reject invalid envelope
// ---------------------------------------------------------------------------

describe("J1.2 — reject invalid envelope", () => {
  test("FAIL verdict → ContentArtifact.create NOT called", async () => {
    mockHarnessFail(["[ENVELOPE] doc_type: 'invalid_type' is not valid"]);
    const result = await importEnvelope({ ...VALID_ENVELOPE, doc_type: "invalid_type" }, ACTOR_ID);

    expect(result.verdict).toBe("FAIL");
    expect(result.failChecks.length).toBeGreaterThan(0);
    expect(mockArtifactCreate).not.toHaveBeenCalled();
  });

  test("FAIL → CorpusEvent.create NOT called", async () => {
    mockHarnessFail(["[ENVELOPE] missing required field"]);
    await importEnvelope({ ...VALID_ENVELOPE }, ACTOR_ID);
    expect(mockEventCreate).not.toHaveBeenCalled();
  });

  test("FAIL → ImportBatch written with verdict=FAIL (nothing else persisted)", async () => {
    mockHarnessFail(["[PAYLOAD] schema error"]);
    const result = await importEnvelope({ ...VALID_ENVELOPE }, ACTOR_ID);

    expect(result.batchId).toBeDefined();
    const batchArg = mockBatchCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(batchArg.verdict).toBe("FAIL");
  });
});

// ---------------------------------------------------------------------------
// J1.3 — REF-21 advisory never blocks (additional coverage)
// ---------------------------------------------------------------------------

describe("J1.3 — REF-21 advisory never blocks import", () => {
  test("envelope with advisory trigger word still yields PASS", async () => {
    mockHarnessPass(["possible curation trigger 'dance' (music-dance)"], []);
    const result = await importEnvelope(
      { ...VALID_ENVELOPE, rendered_markdown: "# Test\n\nThe class will dance together." },
      ACTOR_ID,
    );
    expect(result.verdict).toBe("PASS");
    expect(mockArtifactCreate).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// J1.9 — versioning: supersede-not-overwrite
// ---------------------------------------------------------------------------

describe("J1.9 — versioning: supersede-not-overwrite", () => {
  test("when prior current version exists, updateOne flips current=false", async () => {
    const priorId = new mongoose.Types.ObjectId();
    // Simulate an existing current version
    mockArtifactFindOneResult.mockResolvedValueOnce({ _id: priorId, current: true });
    mockArtifactCreate.mockResolvedValueOnce(
      makeArtifactDoc({ priorVersionId: priorId }),
    );
    mockHarnessPass();
    const result = await importEnvelope({ ...VALID_ENVELOPE }, ACTOR_ID);

    expect(result.verdict).toBe("PASS");
    // Prior version flipped to current=false
    expect(mockArtifactUpdateOne).toHaveBeenCalledWith(
      { _id: priorId },
      { $set: { current: false } },
    );
  });

  test("new artifact gets priorVersionId pointing to old id", async () => {
    const priorId = new mongoose.Types.ObjectId();
    mockArtifactFindOneResult.mockResolvedValueOnce({ _id: priorId, current: true });
    mockArtifactCreate.mockResolvedValueOnce(makeArtifactDoc({ priorVersionId: priorId }));
    mockHarnessPass();
    await importEnvelope({ ...VALID_ENVELOPE }, ACTOR_ID);

    const createArg = mockArtifactCreate.mock.calls[0][0] as Record<string, unknown>;
    expect((createArg.priorVersionId as mongoose.Types.ObjectId).toString()).toBe(priorId.toString());
  });

  test("when no prior version, artifact is created with current=true and no priorVersionId", async () => {
    mockArtifactFindOneResult.mockResolvedValueOnce(null); // no prior
    mockHarnessPass();
    await importEnvelope({ ...VALID_ENVELOPE }, ACTOR_ID);

    const createArg = mockArtifactCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createArg.current).toBe(true);
    expect(createArg.priorVersionId).toBeUndefined();
    expect(mockArtifactUpdateOne).not.toHaveBeenCalled();
  });
});
