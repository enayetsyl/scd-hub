/**
 * question_batch import tests — import contract v1.1 (Principal ruling 2026-08-15).
 *
 * DELIBERATELY DIFFERENT from content.test.ts: that file mocks the Python harness to
 * exercise service reactions cheaply. Here the harness is NOT mocked — every envelope
 * goes through the real validate_import.py, because the point of these tests is that a
 * batch element takes the genuine, unchanged single-envelope gate. Only Mongoose is
 * replaced, by a faithful in-memory store that implements the version-key semantics
 * (findOne on current:true → updateOne current:false → create) so row counts can be
 * asserted without touching the shared Atlas DB (AGENTS.md, parallel-sessions rule 3).
 *
 * The 110 envelopes are BUILT in beforeAll by the production builder
 * (build_question_envelopes.py) from the committed LOCKED conformance examples — the
 * seven real QP-BAN-C5-U13-Q0x payloads cycled to 110 fresh sequential qids. No
 * hand-written envelope is used anywhere in this file.
 */
import { execFileSync } from "child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// In-memory Mongoose stand-ins (declared before the service import)
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

const artifacts: Row[] = [];
const batches: Row[] = [];
const events: Row[] = [];

const oid = () => new mongoose.Types.ObjectId();

/** Resolve a possibly-dotted query key against a row (e.g. "envelopeJson.payload.qid"). */
function dotGet(row: Row, key: string): unknown {
  return key.split(".").reduce<any>((acc, k) => (acc == null ? acc : acc[k]), row);
}

function matches(row: Row, query: Row): boolean {
  return Object.entries(query).every(([k, v]) => {
    const actual = k === "_id" ? row._id : dotGet(row, k);
    if (v instanceof mongoose.Types.ObjectId || actual instanceof mongoose.Types.ObjectId) {
      return String(actual) === String(v);
    }
    return actual === v;
  });
}

function makeStore(rows: Row[]) {
  return {
    create: async (doc: Row) => {
      const row = { ...doc, _id: oid() };
      rows.push(row);
      return row;
    },
    findOne: (query: Row) => ({
      lean: async () => rows.find((r) => matches(r, query)) ?? null,
    }),
    updateOne: async (query: Row, update: Row) => {
      const row = rows.find((r) => matches(r, query));
      if (row) Object.assign(row, update.$set ?? {});
      return { acknowledged: true };
    },
  };
}

jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: {
    create: (d: unknown) => (globalThis as any).__artifactStore.create(d),
    findOne: (q: unknown) => (globalThis as any).__artifactStore.findOne(q),
    updateOne: (q: unknown, u: unknown) => (globalThis as any).__artifactStore.updateOne(q, u),
  },
}));

jest.mock("../modules/platform/models/ImportBatch", () => ({
  ImportBatch: {
    create: (d: unknown) => (globalThis as any).__batchStore.create(d),
    findOne: (q: unknown) => (globalThis as any).__batchStore.findOne(q),
    updateOne: (q: unknown, u: unknown) => (globalThis as any).__batchStore.updateOne(q, u),
  },
}));

jest.mock("../modules/corpus/models/CorpusEvent", () => ({
  CorpusEvent: { create: (d: unknown) => (globalThis as any).__eventStore.create(d) },
}));

// A question re-import never touches the review thread (plans only), but the module is
// imported by ContentService — stub its collection so nothing reaches a real driver.
jest.mock("../modules/content/models/ReviewAssignment", () => ({
  ReviewAssignment: {
    find: jest.fn(() => ({ lean: () => Promise.resolve([]) })),
    updateOne: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({}),
  },
}));

(globalThis as any).__artifactStore = makeStore(artifacts);
(globalThis as any).__batchStore = makeStore(batches);
(globalThis as any).__eventStore = makeStore(events);

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { importEnvelope, importQuestionBatch } from "../modules/content/services/ContentService";

// ---------------------------------------------------------------------------
// Fixture: 110 C5 BAN U13 question envelopes, built by the production builder
// ---------------------------------------------------------------------------

const REPO = path.resolve(__dirname, "../../..");
const PYTHON = process.env.PYTHON_BIN ?? (process.platform === "win32" ? "python" : "python3");
const ACTOR = oid();

let ENVELOPES: Record<string, unknown>[] = [];

/** A deep copy, so a mutation in one test cannot leak into the next. */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function wrap(items: Record<string, unknown>[], itemCount = items.length) {
  return {
    envelope_version: "1.0",
    doc_type: "question_batch",
    batch: {
      bank_id: "C5_BAN_U13_QuestionBank",
      bank_version: "v1",
      item_count: itemCount,
      digest: "sha256:test-fixture",
    },
    items,
  };
}

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scd_batch_test_"));
  const examples = JSON.parse(
    fs.readFileSync(path.join(REPO, "docs/examples/LOCKED_QuestionBank_Examples_v1.json"), "utf8"),
  );
  const seeds = examples.questions.filter((q: Row) => String(q.qid).startsWith("QP-BAN-C5-U13-"));
  expect(seeds.length).toBeGreaterThan(0);

  const questions = Array.from({ length: 110 }, (_, i) => {
    const q = clone(seeds[i % seeds.length]);
    q.qid = `QP-BAN-C5-U13-Q${String(i + 1).padStart(3, "0")}`;
    return q;
  });

  const bankPath = path.join(dir, "C5_BAN_U13_QuestionBank_v1.json");
  fs.writeFileSync(bankPath, JSON.stringify({ questions }), "utf8");

  const out = execFileSync(
    PYTHON,
    [
      path.join(REPO, "server/import/build_question_envelopes.py"),
      "--json", bankPath,
      "--curation-tag", "KEEP_AS_IS",
      "--envelope-schema", path.join(REPO, "docs/import-contract.schema.json"),
      "--author", "Project 04",
      "--source-file", "C5_BAN_U13_QuestionBank_v1.json",
    ],
    { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" }, maxBuffer: 40 * 1024 * 1024 },
  );
  ENVELOPES = JSON.parse(out);
  expect(ENVELOPES).toHaveLength(110);
}, 120_000);

beforeEach(() => {
  artifacts.length = 0;
  batches.length = 0;
  events.length = 0;
});

const currentRows = () => artifacts.filter((a) => a.current === true);
const qidOf = (a: Row) => a.envelopeJson?.payload?.qid;

// ---------------------------------------------------------------------------

describe("question_batch — import contract v1.1", () => {
  it("(a) imports all 110 envelopes under one batchId", async () => {
    const res = await importQuestionBatch(wrap(clone(ENVELOPES)), ACTOR);

    expect(res.verdict).toBe("PASS");
    expect(res.itemsTotal).toBe(110);
    expect(res.itemsPassed).toBe(110);
    expect(res.itemsFailed).toBe(0);
    expect(res.batchItems).toHaveLength(110);
    expect(res.batchItems!.every((v) => v.status === "imported")).toBe(true);
    expect(res.bankId).toBe("C5_BAN_U13_QuestionBank");

    // 110 artifacts, all live, all stamped with the SAME single batch id.
    expect(artifacts).toHaveLength(110);
    expect(currentRows()).toHaveLength(110);
    const stamped = new Set(artifacts.map((a) => String(a.importBatchId)));
    expect(stamped.size).toBe(1);
    expect([...stamped][0]).toBe(res.batchId);

    // Distinct qids — the fan-out did not collapse items onto one another.
    expect(new Set(artifacts.map(qidOf)).size).toBe(110);

    // Audit: one batch row + one per-item row, each linked back by parentBatchId.
    const itemRows = batches.filter((b) => b.parentBatchId);
    expect(itemRows).toHaveLength(110);
    expect(itemRows.every((b) => String(b.parentBatchId) === res.batchId)).toBe(true);
  }, 240_000);

  it("(b) re-import applies the found single-import duplicate rule: supersede, no second live row", async () => {
    const first = await importQuestionBatch(wrap(clone(ENVELOPES)), ACTOR);
    expect(first.itemsPassed).toBe(110);

    const second = await importQuestionBatch(wrap(clone(ENVELOPES)), ACTOR);

    expect(second.verdict).toBe("PASS");
    expect(second.itemsPassed).toBe(110);
    expect(second.itemsFailed).toBe(0);
    // The rule READ off persistEnvelope (R-C7): a re-imported qid is a VERSION BUMP.
    expect(second.batchItems!.every((v) => v.status === "imported" && v.superseded === true)).toBe(true);

    // 220 rows total (version history preserved) but still exactly 110 LIVE rows —
    // one current version per qid. No duplicate live rows.
    expect(artifacts).toHaveLength(220);
    expect(currentRows()).toHaveLength(110);
    expect(new Set(currentRows().map(qidOf)).size).toBe(110);

    // Each new live row points at the row it superseded.
    expect(currentRows().every((a) => a.priorVersionId)).toBe(true);

    // A second upload is a second batchId; the live rows now carry it.
    expect(second.batchId).not.toBe(first.batchId);
    expect(currentRows().every((a) => String(a.importBatchId) === second.batchId)).toBe(true);
  }, 480_000);

  it("(c) one corrupted element fails alone — 109 imported, 1 failed with a reason", async () => {
    const items = clone(ENVELOPES);
    // A real gate failure, not a shape typo: an off-registry REF-19 slug is a HARD L4 fail.
    (items[49].payload as Row).ref19_topic_id = "BAN-NOT-A-REAL-SLUG";
    const badQid = (items[49].payload as Row).qid;

    const res = await importQuestionBatch(wrap(items), ACTOR);

    expect(res.verdict).toBe("PASS"); // the batch is not all-or-nothing at item level
    expect(res.itemsPassed).toBe(109);
    expect(res.itemsFailed).toBe(1);

    const failedVerdicts = res.batchItems!.filter((v) => v.status === "failed");
    expect(failedVerdicts).toHaveLength(1);
    expect(failedVerdicts[0].qid).toBe(badQid);
    expect(failedVerdicts[0].reason).toMatch(/REF19/);

    // The 109 good ones landed; the bad one produced no artifact.
    expect(currentRows()).toHaveLength(109);
    expect(artifacts.map(qidOf)).not.toContain(badQid);

    // The failure is still audited (a FAIL row exists for it under this batch).
    const failRows = batches.filter((b) => b.verdict === "FAIL" && b.parentBatchId);
    expect(failRows).toHaveLength(1);
  }, 240_000);

  it("(d) item_count off by one rejects the whole batch — nothing imported", async () => {
    const res = await importQuestionBatch(wrap(clone(ENVELOPES), 111), ACTOR);

    expect(res.verdict).toBe("FAIL");
    expect(res.failChecks.join(" ")).toMatch(/item_count/);
    expect(artifacts).toHaveLength(0);
    expect(batches).toHaveLength(0);
    expect(events).toHaveLength(0);
  }, 60_000);

  it("(d2) the size guard rejects a batch above the 500-item ceiling", async () => {
    // Cheap: the guard fires before any element is gated, so the items need not be distinct.
    const oversized = Array.from({ length: 501 }, () => clone(ENVELOPES[0]));
    const res = await importQuestionBatch(wrap(oversized), ACTOR);

    expect(res.verdict).toBe("FAIL");
    expect(res.failChecks.join(" ")).toMatch(/size guard/);
    expect(artifacts).toHaveLength(0);
  }, 60_000);

  it("(e) the single-envelope import path is untouched", async () => {
    const res = await importEnvelope(clone(ENVELOPES[0]), ACTOR);

    expect(res.verdict).toBe("PASS");
    expect(res.artifactId).toBeTruthy();
    expect(res.batchItems).toBeUndefined();
    expect(artifacts).toHaveLength(1);
    expect(currentRows()).toHaveLength(1);
    // No batch stamping leaks onto a single import.
    expect(artifacts[0].importBatchId).toBeUndefined();
    expect(batches).toHaveLength(1);
    expect(batches[0].parentBatchId).toBeUndefined();
    expect(events).toHaveLength(1);
  }, 60_000);

  it("rejects a NESTED batch whole (the one structural element bar)", async () => {
    const nested = await importQuestionBatch(wrap([wrap(clone(ENVELOPES.slice(0, 2))) as Row]), ACTOR);

    // Nesting is a transport violation, so it is caught by the wrapper's own L1 pass and
    // the upload is rejected entire — not degraded to a single failed element.
    expect(nested.verdict).toBe("FAIL");
    expect(nested.itemsPassed).toBe(0);
    expect(artifacts).toHaveLength(0);
    expect(batches).toHaveLength(0);
  }, 60_000);

  it("fails a junk element ALONE — the element gate is deliberately loose", async () => {
    // The `items` marker bars only nesting, so a malformed element reaches the per-element
    // pass and fails by itself instead of sinking its 2 healthy siblings.
    const items = [clone(ENVELOPES[0]), "not-an-envelope" as unknown as Row, clone(ENVELOPES[1])];
    const res = await importQuestionBatch(wrap(items), ACTOR);

    expect(res.verdict).toBe("PASS");
    expect(res.itemsPassed).toBe(2);
    expect(res.itemsFailed).toBe(1);
    expect(res.batchItems![1].reason).toMatch(/not a JSON object/);
    expect(currentRows()).toHaveLength(2);
  }, 60_000);

  it("gating is parallel but persistence stays ordered — verdicts follow upload order", async () => {
    const items = clone(ENVELOPES.slice(0, 12));
    // A failure in the MIDDLE: if the parallel gate leaked its completion order into the
    // results, this verdict would drift off index 5.
    (items[5].payload as Row).ref19_topic_id = "BAN-NOT-A-REAL-SLUG";
    const badQid = (items[5].payload as Row).qid;

    const res = await importQuestionBatch(wrap(items), ACTOR);

    expect(res.batchItems).toHaveLength(12);
    expect(res.batchItems![5].qid).toBe(badQid);
    expect(res.batchItems![5].status).toBe("failed");
    expect(res.batchItems!.map((v) => v.qid)).toEqual(
      items.map((e) => (e.payload as Row).qid),
    );
    expect(res.itemsPassed).toBe(11);
  }, 120_000);

  it("a duplicate qid INSIDE one batch supersedes in order, leaving one live row", async () => {
    // Ordered persistence is what makes this behave like importing the two back-to-back.
    const dup = clone(ENVELOPES[0]);
    const res = await importQuestionBatch(wrap([clone(ENVELOPES[0]), clone(ENVELOPES[1]), dup]), ACTOR);

    expect(res.itemsPassed).toBe(3);
    expect(res.batchItems![2].superseded).toBe(true); // the 2nd copy saw the 1st
    expect(artifacts).toHaveLength(3);
    expect(currentRows()).toHaveLength(2); // 2 distinct qids live
    expect(new Set(currentRows().map(qidOf)).size).toBe(2);
  }, 120_000);

  it("fails an element missing envelope_version ALONE, not the batch", async () => {
    const items = clone(ENVELOPES.slice(0, 3));
    delete (items[1] as Row).envelope_version;

    const res = await importQuestionBatch(wrap(items), ACTOR);

    expect(res.verdict).toBe("PASS");
    expect(res.itemsPassed).toBe(2);
    expect(res.itemsFailed).toBe(1);
    expect(res.batchItems![1].status).toBe("failed");
    expect(currentRows()).toHaveLength(2);
  }, 60_000);
});
