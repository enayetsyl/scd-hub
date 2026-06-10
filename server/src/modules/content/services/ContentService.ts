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
import { ContentArtifact } from "../models/ContentArtifact";
import { ImportBatch } from "../../platform/models/ImportBatch";
import { CorpusEvent } from "../../corpus/models/CorpusEvent";

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
}

/** Run the Python import harness against an envelope JSON object. */
export async function runImportGate(envelope: Record<string, unknown>): Promise<GateOutput> {
  const tmpFile = path.join(os.tmpdir(), `scd_import_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  try {
    await fs.writeFile(tmpFile, JSON.stringify(envelope), "utf-8");

    // Resolve schema paths the same way the harness does (glob next to validate_import.py)
    const envelopeSchemaPath = path.join(SCHEMA_DIR, "../../docs/import-contract.schema.json");

    const { stdout, stderr, code: exitCode } = await execFilePromise("python", [
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
): Promise<ImportResult> {
  const prov = (envelope.provenance ?? {}) as Record<string, unknown>;
  const addr = (envelope.address ?? {}) as Record<string, unknown>;

  const batchDoc = await ImportBatch.create({
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
      batchId: batchDoc._id.toString(),
    },
  });

  return {
    verdict: "PASS",
    failChecks: [],
    warnings: gate.warnings,
    advisories: gate.advisories,
    artifactId: artifact._id.toString(),
    batchId: batchDoc._id.toString(),
  };
}

/** Full single-envelope import pipeline: validate → persist → audit → corpus event. */
export async function importEnvelope(
  envelope: Record<string, unknown>,
  actorId: Types.ObjectId | string,
): Promise<ImportResult> {
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
    const { stdout, stderr, code } = await execFilePromise("python", [
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
    const { stdout, stderr, code } = await execFilePromise("python", argv);
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
