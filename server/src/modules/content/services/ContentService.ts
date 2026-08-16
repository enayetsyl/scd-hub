/**
 * ContentService — import-gate orchestration (J1.1–J1.4, ADR-006).
 *
 * Design note: validation is delegated to the LOCKED Python harness
 * (validate_import.py) via child_process.execFile. The harness is the
 * canonical gate — porting it to TS would create a second source of truth
 * with drift risk. Python is required in the runtime environment (see AGENTS.md).
 *
 * On PASS:
 *   1. Flip prior current version (if any) to current=false.
 *   2. Persist ContentArtifact (current=true, priorVersionId set).
 *   3. Write ImportBatch audit row.
 *   4. Write de-identified CorpusEvent (content_imported) — corpus plane, ADR-005.
 *
 * On FAIL: write ImportBatch (verdict=FAIL); nothing else persisted.
 */
import { execFile } from "child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import type { Types } from "mongoose";
import { BATCH_DOC_TYPE, BATCH_MAX_ITEMS } from "@scd/shared";
import { ContentArtifact } from "../models/ContentArtifact";
import { ImportBatch } from "../../platform/models/ImportBatch";
import { CorpusEvent } from "../../corpus/models/CorpusEvent";
import { isPlanDocType, supersedeOpenRoundsForAddress } from "./ReviewService";

/** Wrap execFile in a Promise that always resolves (never throws) — returns {stdout,stderr,code}. */
function execFilePromise(
  file: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      // Force UTF-8 stdio (Bangla content) + a large buffer for big plans/envelopes.
      { env: { ...process.env, PYTHONIOENCODING: "utf-8" }, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err ? ((err as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0;
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code });
      },
    );
  });
}

const HARNESS_PATH = path.resolve(__dirname, "../../../../import/validate_import.py");
const BUILD_ENVELOPE_PATH = path.resolve(__dirname, "../../../../import/build_envelope.py");
const BUILD_QUESTION_ENVELOPES_PATH = path.resolve(__dirname, "../../../../import/build_question_envelopes.py");
const SCHEMA_DIR = path.resolve(__dirname, "../../../../import");
const ENVELOPE_SCHEMA_PATH = path.join(SCHEMA_DIR, "../../docs/import-contract.schema.json");

// The import harness (validate_import.py / build_envelope.py) runs via a Python
// interpreter spawned with execFile. The command name is NOT portable: Linux/macOS
// expose `python3` (a bare `python` is absent on the Ubuntu prod VM), while Windows
// ships only `python`. A hardcoded "python" is why imports passed locally (Windows)
// but FAILed in production (Ubuntu). Default by platform; PYTHON_BIN overrides for
// non-standard environments (e.g. a venv path).
const PYTHON_BIN = process.env.PYTHON_BIN ?? (process.platform === "win32" ? "python" : "python3");

export interface GateOutput {
  verdict: "PASS" | "FAIL";
  failChecks: string[];
  warnings: string[];
  advisories: string[];
  /** Raw stdout from the harness (for debugging). */
  raw: string;
}

export interface ImportResult {
  verdict: "PASS" | "FAIL";
  failChecks: string[];
  warnings: string[];
  advisories: string[];
  artifactId?: string;
  batchId: string;
  /** Set on the auto-wrap path: the envelope the app built from a plan+md pair. */
  wrappedEnvelopeJson?: string;
  /** Set on the question-bank fan-out path: per-item tallies (114 = 14 stimulus + 100 question). */
  itemsTotal?: number;
  itemsPassed?: number;
  itemsFailed?: number;
  /** Set on the question_batch path (contract v1.1): one verdict per element, in upload order. */
  batchItems?: BatchItemVerdict[];
  /** question_batch only: echo of the wrapper's self-description. */
  bankId?: string;
  bankVersion?: string;
}

/**
 * One element's outcome inside a question_batch upload (contract v1.1).
 * `imported` — the element went through the single-envelope path and produced an artifact.
 *   `superseded` marks the duplicate case: a prior current version of the same qid existed and
 *   was demoted (the found single-import rule; see importQuestionBatch's doc comment).
 * `skipped`  — the element was not attempted (reserved; the batch path attempts every element).
 * `failed`   — the element was rejected; `reason` carries the gate's fail lines.
 */
export interface BatchItemVerdict {
  /** payload.qid / payload.stimulus_id, else `item[<index>]`. */
  qid: string;
  status: "imported" | "skipped" | "failed";
  reason?: string;
  artifactId?: string;
  superseded?: boolean;
}

/** Run the Python import harness against an envelope JSON object. */
export async function runImportGate(envelope: Record<string, unknown>): Promise<GateOutput> {
  const tmpFile = path.join(os.tmpdir(), `scd_import_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  try {
    await fs.writeFile(tmpFile, JSON.stringify(envelope), "utf-8");

    // Resolve schema paths the same way the harness does (glob next to validate_import.py)
    const envelopeSchemaPath = path.join(SCHEMA_DIR, "../../docs/import-contract.schema.json");

    const { stdout, stderr, code: exitCode } = await execFilePromise(PYTHON_BIN, [
      HARNESS_PATH,
      tmpFile,
      "--envelope-schema", envelopeSchemaPath,
    ]);

    const combinedOutput = stdout + stderr;
    const isFail = exitCode !== 0 || /RESULT: FAIL/.test(combinedOutput);

    const failChecks = extractLines(combinedOutput, /FAIL\s+\[([^\]]+)\]\s+(.+)/g);
    const warnings = extractLines(combinedOutput, /WARN\s+\[([^\]]+)\]\s+(.+)/g);
    const advisories = extractLines(combinedOutput, /ADVISORY\s+\[([^\]]+)\]\s+(.+)/g);

    return {
      verdict: isFail ? "FAIL" : "PASS",
      failChecks,
      warnings,
      advisories,
      raw: combinedOutput,
    };
  } finally {
    await fs.unlink(tmpFile).catch(() => undefined);
  }
}

function extractLines(output: string, pattern: RegExp): string[] {
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(output)) !== null) {
    results.push(`[${match[1]}] ${match[2].trim()}`);
  }
  return results;
}

/**
 * Persist ONE already-validated envelope: ImportBatch audit row → (on PASS)
 * supersede-not-overwrite ContentArtifact → de-identified CorpusEvent. The gate
 * verdict is passed in so callers can validate first (e.g. the atomic question-bank
 * path validates every item before persisting any). On FAIL only the audit row is written.
 */
async function persistEnvelope(
  envelope: Record<string, unknown>,
  actorId: Types.ObjectId | string,
  gate: GateOutput,
  /** question_batch only (contract v1.1): the one batch id this element arrived under.
   *  Recorded on the item's audit row (parentBatchId) and on its artifact (importBatchId). */
  parentBatchId?: Types.ObjectId,
): Promise<ImportResult & { superseded?: boolean }> {
  const prov = (envelope.provenance ?? {}) as Record<string, unknown>;
  const addr = (envelope.address ?? {}) as Record<string, unknown>;

  const batchDoc = await ImportBatch.create({
    parentBatchId,
    envelopeSnapshot: envelope,
    // A malformed envelope may omit doc_type; the harness already FAILed it, but
    // the audit row must still be written (J1.2), so fall back to a sentinel
    // rather than throwing a validation error on the required field.
    docType: typeof envelope.doc_type === "string" ? envelope.doc_type : "unknown",
    subject: typeof envelope.subject === "string" ? envelope.subject : undefined,
    classLevel: typeof envelope.class_level === "number" ? envelope.class_level : undefined,
    sourceProject: prov.source_project,
    author: prov.author,
    contentVersion: prov.content_version,
    reviewStatus: envelope.review_status,
    verdict: gate.verdict,
    failChecks: gate.failChecks,
    warnings: gate.warnings,
    advisories: gate.advisories,
    importedBy: actorId,
    importedAt: new Date(),
  });

  if (gate.verdict === "FAIL") {
    return {
      verdict: "FAIL",
      failChecks: gate.failChecks,
      warnings: gate.warnings,
      advisories: gate.advisories,
      batchId: batchDoc._id.toString(),
    };
  }

  // Flip existing current version (J1.9 — supersede-not-overwrite, R-C7).
  // The version key is the content item's IDENTITY: a plan is one doc per address, but
  // questions/stimuli are many per address (a whole unit shares one address), so their
  // identity is the qid / stimulus_id — keying on address would make every item in a bank
  // supersede the previous one, leaving only the last as `current`.
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;
  let versionKey: Record<string, unknown>;
  if (envelope.doc_type === "question") {
    versionKey = { docType: "question", "envelopeJson.payload.qid": payload.qid, current: true };
  } else if (envelope.doc_type === "stimulus") {
    versionKey = { docType: "stimulus", "envelopeJson.payload.stimulus_id": payload.stimulus_id, current: true };
  } else {
    versionKey = {
      docType: envelope.doc_type,
      subject: envelope.subject,
      classLevel: envelope.class_level,
      "address.anchorWord": addr.anchor_word,
      "address.number": addr.number,
      current: true,
    };
  }
  const prior = await ContentArtifact.findOne(versionKey).lean();
  if (prior) {
    await ContentArtifact.updateOne({ _id: prior._id }, { $set: { current: false } });
    // Re-import carries the review thread forward (R2.2): a revised plan version
    // supersedes any open review round on the prior version. The next round is then
    // assigned on this new version (born `draft`). Plans only; harmless no-op otherwise.
    if (typeof envelope.doc_type === "string" && isPlanDocType(envelope.doc_type)) {
      await supersedeOpenRoundsForAddress(
        {
          docType: envelope.doc_type,
          subject: String(envelope.subject),
          classLevel: Number(envelope.class_level),
          anchorWord: String(addr.anchor_word),
          addressNumber: String(addr.number),
        },
        "superseded_by_reimport",
        actorId.toString(),
      );
    }
  }

  const artifact = await ContentArtifact.create({
    docType: envelope.doc_type,
    subject: envelope.subject,
    classLevel: envelope.class_level,
    address: {
      anchorWord: addr.anchor_word,
      number: addr.number,
      title: addr.title,
    },
    curationTag: envelope.curation_tag,
    reviewStatus: envelope.review_status,
    pinned_to: envelope.pinned_to,
    tags: envelope.tags,
    provenance: envelope.provenance,
    envelopeJson: envelope,
    renderedMarkdown: envelope.rendered_markdown,
    current: true,
    priorVersionId: prior ? prior._id : undefined,
    importBatchId: parentBatchId,
    importedBy: actorId,
    importedAt: new Date(),
  });

  // Update batch with artifactId
  await ImportBatch.updateOne({ _id: batchDoc._id }, { $set: { artifactId: artifact._id } });

  // De-identified corpus event — NO identity fields (ADR-005)
  const pseudoId = Buffer.from(actorId.toString()).toString("base64");
  await CorpusEvent.create({
    eventKind: "content_imported",
    pseudoActorId: pseudoId,
    occurredAt: new Date(),
    meta: {
      docType: envelope.doc_type,
      subject: envelope.subject,
      classLevel: envelope.class_level,
      // In a question_batch the corpus event carries the ONE upload id, so analytics can
      // count an upload as a unit without a join back to the per-item audit rows.
      batchId: (parentBatchId ?? batchDoc._id).toString(),
    },
  });

  return {
    verdict: "PASS",
    failChecks: [],
    warnings: gate.warnings,
    advisories: gate.advisories,
    artifactId: artifact._id.toString(),
    batchId: batchDoc._id.toString(),
    superseded: Boolean(prior),
  };
}

/**
 * Envelope import entry point. Dispatches on `doc_type` exactly as before, with ONE new
 * branch: a v1.1 `question_batch` wrapper is unwrapped by importQuestionBatch, which then
 * feeds each element back through this same single-envelope pipeline. Every other doc_type
 * takes the untouched path: validate → persist → audit → corpus event.
 */
export async function importEnvelope(
  envelope: Record<string, unknown>,
  actorId: Types.ObjectId | string,
): Promise<ImportResult> {
  if (envelope.doc_type === BATCH_DOC_TYPE) {
    return importQuestionBatch(envelope, actorId);
  }
  const gate = await runImportGate(envelope);
  return persistEnvelope(envelope, actorId, gate);
}

// ---------------------------------------------------------------------------
// Auto-wrap ingest: plan JSON + Markdown -> envelope (build_envelope.py) -> import
// ---------------------------------------------------------------------------

export interface ImportFile {
  filename: string;
  content: string;
}

interface BuildEnvelopeResult {
  ok: boolean;
  envelope?: Record<string, unknown>;
  error?: string;
}

/** Call build_envelope.py on a (plan.json, plan.md) pair; return the built envelope. */
async function buildEnvelopeFromPair(
  stem: string,
  jsonContent: string,
  mdContent: string,
  jsonFilename: string,
  author: string,
): Promise<BuildEnvelopeResult> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scd_wrap_"));
  const jsonPath = path.join(dir, `${stem}.json`);
  const mdPath = path.join(dir, `${stem}.md`);
  try {
    await fs.writeFile(jsonPath, jsonContent, "utf-8");
    await fs.writeFile(mdPath, mdContent, "utf-8");
    const { stdout, stderr, code } = await execFilePromise(PYTHON_BIN, [
      BUILD_ENVELOPE_PATH,
      "--json", jsonPath,
      "--md", mdPath,
      "--envelope-schema", ENVELOPE_SCHEMA_PATH,
      "--author", author,
      "--authored-at", new Date().toISOString(),
      "--source-file", jsonFilename,
    ]);
    if (code !== 0) {
      return { ok: false, error: (stderr || stdout || "build_envelope.py failed").trim() };
    }
    try {
      return { ok: true, envelope: JSON.parse(stdout) as Record<string, unknown> };
    } catch {
      return { ok: false, error: "build_envelope.py produced invalid JSON" };
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function failResult(message: string): ImportResult {
  return { verdict: "FAIL", failChecks: [message], warnings: [], advisories: [], batchId: "n/a" };
}

// ---------------------------------------------------------------------------
// Question-bank fan-out ingest: a COLLECTION ({stimuli,questions}) -> N envelopes
// (one per stimulus + one per question) -> the SAME gate, persisted atomically.
// ---------------------------------------------------------------------------

/** True when a JSON object is a Project-04 question bank (a collection), not an envelope/plan/single item. */
function isQuestionBank(json: Record<string, unknown> | null): boolean {
  if (!json) return false;
  if ("envelope_version" in json || "plan_type" in json) return false;
  return Array.isArray(json.questions) || Array.isArray(json.stimuli);
}

/** Stable reference for a per-item message: the qid / stimulus_id, else the doc_type. */
function envelopeRef(env: Record<string, unknown>): string {
  const payload = (env.payload ?? {}) as Record<string, unknown>;
  return (payload.qid as string) ?? (payload.stimulus_id as string) ?? (env.doc_type as string) ?? "item";
}

/** Call build_question_envelopes.py on a bank JSON; return the fanned-out envelope array. */
async function buildQuestionEnvelopes(
  bankJson: string,
  curationTag: string,
  author: string,
  sourceFilename: string,
  unitTitle?: string,
): Promise<{ ok: boolean; envelopes?: Record<string, unknown>[]; error?: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scd_qbank_"));
  const bankPath = path.join(dir, "bank.json");
  try {
    await fs.writeFile(bankPath, bankJson, "utf-8");
    const argv = [
      BUILD_QUESTION_ENVELOPES_PATH,
      "--json", bankPath,
      "--curation-tag", curationTag,
      "--envelope-schema", ENVELOPE_SCHEMA_PATH,
      "--author", author,
      "--source-file", sourceFilename,
    ];
    if (unitTitle) argv.push("--unit-title", unitTitle);
    const { stdout, stderr, code } = await execFilePromise(PYTHON_BIN, argv);
    if (code !== 0) {
      return { ok: false, error: (stderr || stdout || "build_question_envelopes.py failed").trim() };
    }
    try {
      const parsed = JSON.parse(stdout) as Record<string, unknown>[];
      if (!Array.isArray(parsed)) return { ok: false, error: "build_question_envelopes.py did not produce an array" };
      return { ok: true, envelopes: parsed };
    } catch {
      return { ok: false, error: "build_question_envelopes.py produced invalid JSON" };
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Import a question bank ATOMICALLY (all-or-nothing). The bank is fanned out into N
 * single-doc envelopes (stimuli + questions); EVERY envelope is run through the gate
 * first, and only if all pass is anything persisted. On any failure nothing is stored
 * (mirrors the plan path) and the failing items are returned, each line prefixed by its
 * qid / stimulus_id. Curation is supplied by the importer (the storage model requires it;
 * questions do not carry a curation decision).
 */
export async function importQuestionBank(
  bankJson: string,
  actorId: Types.ObjectId | string,
  author: string,
  curationTag: string,
  sourceFilename: string,
  unitTitle?: string,
): Promise<ImportResult> {
  const built = await buildQuestionEnvelopes(bankJson, curationTag, author, sourceFilename, unitTitle);
  if (!built.ok || !built.envelopes) {
    return failResult(built.error ?? "Could not build envelopes from the question bank.");
  }
  const envelopes = built.envelopes;
  if (envelopes.length === 0) return failResult("The question bank produced no importable items.");

  // Phase 1 — validate EVERY envelope (no persistence yet).
  const gates = await Promise.all(envelopes.map((env) => runImportGate(env)));
  const failChecks: string[] = [];
  const warnings: string[] = [];
  const advisories: string[] = [];
  let failed = 0;
  envelopes.forEach((env, i) => {
    const ref = envelopeRef(env);
    const g = gates[i];
    if (g.verdict === "FAIL") {
      failed += 1;
      for (const f of g.failChecks) failChecks.push(`${ref}: ${f}`);
    }
    for (const w of g.warnings) warnings.push(`${ref}: ${w}`);
    for (const a of g.advisories) advisories.push(`${ref}: ${a}`);
  });

  const total = envelopes.length;

  // Phase 2 — atomic: persist only if every item passed; else store nothing.
  if (failed > 0) {
    return {
      verdict: "FAIL",
      failChecks,
      warnings,
      advisories,
      batchId: "n/a",
      itemsTotal: total,
      itemsPassed: total - failed,
      itemsFailed: failed,
    };
  }

  let lastBatchId = "n/a";
  for (let i = 0; i < envelopes.length; i++) {
    const res = await persistEnvelope(envelopes[i], actorId, gates[i]);
    lastBatchId = res.batchId;
  }

  return {
    verdict: "PASS",
    failChecks: [],
    warnings,
    advisories,
    batchId: lastBatchId,
    itemsTotal: total,
    itemsPassed: total,
    itemsFailed: 0,
  };
}

// ---------------------------------------------------------------------------
// question_batch ingest (import contract v1.1, Principal ruling 2026-08-15):
// ONE upload wrapping N standard question envelopes.
// ---------------------------------------------------------------------------

/** True when a parsed JSON object is a v1.1 question_batch wrapper. */
export function isQuestionBatch(json: Record<string, unknown> | null): boolean {
  return Boolean(json && json.doc_type === BATCH_DOC_TYPE);
}

/**
 * How many envelopes may sit in the gate at once. Each one spawns a Python process, so
 * an unbounded `Promise.all` over a 500-item batch would try to run 500 interpreters —
 * the box thrashes and the whole upload gets slower, not faster. Capped to the machine's
 * cores (minus one for the event loop), within a sane floor/ceiling; override for tuning.
 */
const GATE_CONCURRENCY = (() => {
  const fromEnv = Number(process.env.IMPORT_GATE_CONCURRENCY);
  if (Number.isFinite(fromEnv) && fromEnv >= 1) return Math.floor(fromEnv);
  return Math.max(2, Math.min(12, (os.cpus()?.length ?? 4) - 1));
})();

/**
 * How many elements may be PERSISTED at once. These are DB round-trips, not subprocesses,
 * so the useful cap is higher than the gate's — the limit is the Mongo pool, not the CPU.
 */
const PERSIST_CONCURRENCY = (() => {
  const fromEnv = Number(process.env.IMPORT_PERSIST_CONCURRENCY);
  if (Number.isFinite(fromEnv) && fromEnv >= 1) return Math.floor(fromEnv);
  return 8;
})();

/**
 * The identity a supersede races on — exactly the version key `persistEnvelope` looks up.
 * Two elements sharing this string MUST be persisted in order (read-then-write); two that
 * differ can never touch the same rows and are safe to run concurrently.
 */
function versionKeyOf(env: Record<string, unknown>): string {
  const p = (env.payload ?? {}) as Record<string, unknown>;
  if (env.doc_type === "question") return `q:${String(p.qid)}`;
  if (env.doc_type === "stimulus") return `s:${String(p.stimulus_id)}`;
  const a = (env.address ?? {}) as Record<string, unknown>;
  return `o:${String(env.doc_type)}:${String(env.subject)}:${String(env.class_level)}:${String(a.anchor_word)}:${String(a.number)}`;
}

/**
 * Map with bounded concurrency, preserving INPUT ORDER in the result array.
 * (No dependency added for this — it is eight lines and the repo has no p-limit.)
 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Import a question_batch wrapper (contract v1.1).
 *
 * WRAPPER-LEVEL (whole-batch, nothing imported on failure):
 *   - `items` must be a non-empty array;
 *   - `batch.item_count` must equal `items.length` — the wrapper is self-describing or it is
 *     rejected;
 *   - `items.length` must be within the size guard (BATCH_MAX_ITEMS = 500);
 *   - the wrapper itself must clear the envelope schema (the same Python gate, L1 + L1b).
 *
 * ELEMENT-LEVEL (NOT all-or-nothing): each element is handed to the UNCHANGED single-envelope
 * path (`runImportGate` → `persistEnvelope`). No new per-item validation logic exists here.
 * A bad element fails alone with its reason; the rest still import.
 *
 * DUPLICATE HANDLING — the rule was READ off the existing single-import path
 * (`persistEnvelope`, the R-C7 supersede-not-overwrite block) and is replicated per element,
 * not re-invented: for `doc_type: "question"` the version key is
 * `{docType:"question", envelopeJson.payload.qid, current:true}`. If a current row for that
 * qid exists it is flipped to `current:false` and a NEW artifact is created with
 * `priorVersionId` pointing at it. So a re-imported qid is a VERSION BUMP, never an
 * overwrite and never a second live row: the artifact count grows, the `current:true` count
 * does not. Those elements are reported `imported` with `superseded: true`.
 *
 * The batch gets ONE batchId (the wrapper's own ImportBatch row). It is stamped on every
 * imported item's artifact (`importBatchId`) and on each item's own audit row
 * (`parentBatchId`), so one upload is traceable in both directions.
 */
export async function importQuestionBatch(
  wrapper: Record<string, unknown>,
  actorId: Types.ObjectId | string,
): Promise<ImportResult> {
  const batchMeta = (wrapper.batch ?? {}) as Record<string, unknown>;
  const items = wrapper.items;

  // --- wrapper-level guards. These reject the batch WHOLE; nothing is persisted. ---
  if (!Array.isArray(items) || items.length === 0) {
    return failResult("question_batch: `items` must be a non-empty array — batch rejected, nothing imported.");
  }
  if (items.length > BATCH_MAX_ITEMS) {
    return failResult(
      `question_batch: ${items.length} items exceeds the ${BATCH_MAX_ITEMS}-item size guard — batch rejected, nothing imported. Split the upload.`,
    );
  }
  const declared = batchMeta.item_count;
  if (typeof declared !== "number" || declared !== items.length) {
    return failResult(
      `question_batch: batch.item_count=${JSON.stringify(declared)} does not match items length ${items.length} — batch rejected, nothing imported.`,
    );
  }

  // The wrapper passes through the same Python gate as any other envelope (L1 + L1b).
  const wrapperGate = await runImportGate(wrapper);
  if (wrapperGate.verdict === "FAIL") {
    return {
      verdict: "FAIL",
      failChecks: wrapperGate.failChecks,
      warnings: wrapperGate.warnings,
      advisories: wrapperGate.advisories,
      batchId: "n/a",
      itemsTotal: items.length,
      itemsPassed: 0,
      itemsFailed: 0,
      batchItems: [],
    };
  }

  // --- the ONE batch row: its _id is the batchId carried by every imported item. ---
  const batchRow = await ImportBatch.create({
    // The wrapper snapshot without `items` — the elements get their own audit rows, and a
    // 500-item copy would bloat every batch row for no added traceability.
    envelopeSnapshot: { ...wrapper, items: `[${items.length} items — see parentBatchId rows]` },
    docType: BATCH_DOC_TYPE,
    bankId: typeof batchMeta.bank_id === "string" ? batchMeta.bank_id : undefined,
    bankVersion: typeof batchMeta.bank_version === "string" ? batchMeta.bank_version : undefined,
    itemCount: items.length,
    digest: typeof batchMeta.digest === "string" ? batchMeta.digest : undefined,
    verdict: "PASS",
    failChecks: [],
    warnings: wrapperGate.warnings,
    advisories: wrapperGate.advisories,
    importedBy: actorId,
    importedAt: new Date(),
  });
  const batchId = batchRow._id;

  // --- PHASE 1 (parallel): gate every element. ---
  // Gating is pure — a temp file, a Python process, its stdout — so elements are
  // independent and safe to run concurrently, bounded by GATE_CONCURRENCY. This is the
  // slow half (one interpreter spawn per item); the win scales with the core count.
  type Gated =
    | { ok: false; ref: string; reason: string }
    | { ok: true; ref: string; env: Record<string, unknown>; gate: GateOutput };

  const gated = await mapLimit(items, GATE_CONCURRENCY, async (raw, i): Promise<Gated> => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, ref: `item[${i}]`, reason: "element is not a JSON object" };
    }
    const env = raw as Record<string, unknown>;
    const ref = envelopeRef(env) || `item[${i}]`;
    return { ok: true, ref, env, gate: await runImportGate(env) };
  });

  // --- PHASE 2 (parallel ACROSS version keys, ordered WITHIN one): persist. ---
  // Superseding is a read-then-write (findOne current:true -> updateOne current:false ->
  // create), so two elements sharing a version key would race and could leave two live rows
  // or a broken priorVersionId chain. Elements with DIFFERENT keys touch disjoint rows and
  // cannot interfere, so the batch is partitioned by key: partitions run concurrently, and
  // each partition runs strictly in upload order. A duplicate qid inside one batch therefore
  // still behaves exactly like importing those two envelopes back-to-back on the single path.
  const persisted = new Array<(ImportResult & { superseded?: boolean }) | undefined>(gated.length);
  const partitions = new Map<string, number[]>();
  gated.forEach((g, i) => {
    if (!g.ok) return;
    const key = versionKeyOf(g.env);
    const bucket = partitions.get(key);
    if (bucket) bucket.push(i);
    else partitions.set(key, [i]);
  });

  await mapLimit([...partitions.values()], PERSIST_CONCURRENCY, async (indices) => {
    for (const i of indices) {
      const g = gated[i];
      if (!g.ok) continue;
      persisted[i] = await persistEnvelope(g.env, actorId, g.gate, batchId);
    }
  });

  // Verdicts are assembled by walking the ORIGINAL order, never completion order.
  const verdicts: BatchItemVerdict[] = [];
  const warnings: string[] = [];
  const advisories: string[] = [];
  let imported = 0;
  let failed = 0;

  gated.forEach((g, i) => {
    if (!g.ok) {
      failed += 1;
      verdicts.push({ qid: g.ref, status: "failed", reason: g.reason });
      return;
    }
    const res = persisted[i]!;

    for (const w of res.warnings) warnings.push(`${g.ref}: ${w}`);
    for (const a of res.advisories) advisories.push(`${g.ref}: ${a}`);

    if (res.verdict === "FAIL") {
      failed += 1;
      verdicts.push({
        qid: g.ref,
        status: "failed",
        reason: res.failChecks.join("; ") || "rejected by the import gate",
      });
    } else {
      imported += 1;
      verdicts.push({
        qid: g.ref,
        status: "imported",
        artifactId: res.artifactId,
        superseded: res.superseded,
      });
    }
  });

  // The batch row records the roll-up. Verdict is PASS when at least one element imported —
  // a partially-imported batch is a real, recorded outcome, not a failure of the upload.
  const verdict: "PASS" | "FAIL" = imported > 0 ? "PASS" : "FAIL";
  const failChecks = verdicts.filter((v) => v.status === "failed").map((v) => `${v.qid}: ${v.reason}`);
  await ImportBatch.updateOne({ _id: batchId }, { $set: { verdict, failChecks } });

  return {
    verdict,
    failChecks,
    warnings,
    advisories,
    batchId: batchId.toString(),
    itemsTotal: items.length,
    itemsPassed: imported,
    itemsFailed: failed,
    batchItems: verdicts,
    bankId: typeof batchMeta.bank_id === "string" ? batchMeta.bank_id : undefined,
    bankVersion: typeof batchMeta.bank_version === "string" ? batchMeta.bank_version : undefined,
  };
}

interface ClassifiedFile extends ImportFile {
  stem: string;
  ext: string;
  json: Record<string, unknown> | null;
}

function classify(f: ImportFile): ClassifiedFile {
  const stem = f.filename.replace(/\.[^.]+$/, "");
  const ext = (f.filename.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase();
  let json: Record<string, unknown> | null = null;
  if (ext === "json") {
    try {
      json = JSON.parse(f.content) as Record<string, unknown>;
    } catch {
      json = null;
    }
  }
  return { ...f, stem, ext, json };
}

/**
 * Ingest ONE logical import (J1.1). Accepts one of:
 *   - a built envelope (single .json with envelope_version) -> imported unchanged;
 *   - a plan JSON + its rendered Markdown (matched filename stem) -> auto-wrapped, then imported.
 * Orphans (plan with no .md, .md with no plan) and question/stimulus payloads are rejected with
 * a clear message; nothing is stored on FAIL. Auto-wrapped envelopes still pass through the full
 * gate (validate_import.py via importEnvelope) before persistence — the wrap is convenience, not a
 * bypass. (Question auto-wrap is an intentional future seam.)
 */
export async function importContentFiles(
  files: ImportFile[],
  actorId: Types.ObjectId | string,
  author: string,
  curationTag?: string,
  unitTitle?: string,
): Promise<ImportResult> {
  if (!files || files.length === 0) return failResult("No files were provided.");

  const items = files.map(classify);

  // (1) Built-envelope passthrough.
  const envelopeFile = items.find((c) => c.ext === "json" && c.json && "envelope_version" in c.json);
  if (envelopeFile) {
    if (files.length !== 1) return failResult("Upload an import envelope on its own (no paired files).");
    return importEnvelope(envelopeFile.json as Record<string, unknown>, actorId);
  }

  // (1b) Question-bank fan-out — a single bank JSON (a {stimuli,questions} collection) expands
  // into N stimulus+question envelopes. Questions are app-rendered, so any companion .md/.tsv is
  // a human read-view and is ignored here (the bank JSON is the only thing imported).
  const bankFile = items.find((c) => c.ext === "json" && isQuestionBank(c.json));
  if (bankFile) {
    if (!curationTag) {
      return failResult("Pick a curation tag for the question bank (KEEP_AS_IS / NEEDS_REPLACEMENT / FLEXIBLE).");
    }
    return importQuestionBank(bankFile.content, actorId, author, curationTag, bankFile.filename, unitTitle);
  }

  const jsonFiles = items.filter((c) => c.ext === "json");
  const mdFiles = items.filter((c) => c.ext === "md" || c.ext === "markdown");

  // (2) Orphans.
  if (jsonFiles.length === 1 && mdFiles.length === 0) {
    const j = jsonFiles[0];
    if (j.json && (j.json.question_type || j.json.stimulus_type)) {
      return failResult("Question/stimulus auto-wrap is not supported yet — import a built envelope.");
    }
    if (j.json && j.json.plan_type) {
      return failResult(`Orphan plan JSON '${j.stem}': also upload its rendered Markdown (${j.stem}.md).`);
    }
    return failResult("Unrecognised JSON: not an import envelope and not a Project-03 plan (no plan_type).");
  }
  if (mdFiles.length === 1 && jsonFiles.length === 0) {
    return failResult(`Orphan Markdown '${mdFiles[0].stem}': also upload its plan JSON (${mdFiles[0].stem}.json).`);
  }

  // (3) Plan pair -> auto-wrap.
  if (jsonFiles.length === 1 && mdFiles.length === 1) {
    const j = jsonFiles[0];
    const m = mdFiles[0];
    if (j.stem !== m.stem) {
      return failResult(`Filename-stem mismatch: '${j.filename}' vs '${m.filename}' — pair X.json with X.md.`);
    }
    if (!j.json) return failResult(`'${j.filename}' is not valid JSON.`);
    if ("envelope_version" in j.json) {
      return failResult("An envelope must be imported alone, not paired with Markdown.");
    }
    if (!j.json.plan_type) {
      if (j.json.question_type || j.json.stimulus_type) {
        return failResult("Question/stimulus auto-wrap is not supported yet — import a built envelope.");
      }
      return failResult(`'${j.filename}' is not a Project-03 plan (no plan_type).`);
    }
    const built = await buildEnvelopeFromPair(j.stem, j.content, m.content, j.filename, author);
    if (!built.ok || !built.envelope) {
      return failResult(built.error ?? "Could not build an envelope from the plan + Markdown.");
    }
    const result = await importEnvelope(built.envelope, actorId);
    return { ...result, wrappedEnvelopeJson: JSON.stringify(built.envelope) };
  }

  return failResult("Upload either one import envelope, or one plan .json + its matching .md.");
}
