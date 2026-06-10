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

/** Full import pipeline: validate → persist → audit → corpus event. */
export async function importEnvelope(
  envelope: Record<string, unknown>,
  actorId: Types.ObjectId | string,
): Promise<ImportResult> {
  const gate = await runImportGate(envelope);

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

  // Flip existing current version (J1.9 — supersede-not-overwrite, R-C7)
  const versionKey = {
    docType: envelope.doc_type,
    subject: envelope.subject,
    classLevel: envelope.class_level,
    "address.anchorWord": addr.anchor_word,
    "address.number": addr.number,
    current: true,
  };
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
): Promise<ImportResult> {
  if (!files || files.length === 0) return failResult("No files were provided.");

  const items = files.map(classify);

  // (1) Built-envelope passthrough.
  const envelopeFile = items.find((c) => c.ext === "json" && c.json && "envelope_version" in c.json);
  if (envelopeFile) {
    if (files.length !== 1) return failResult("Upload an import envelope on its own (no paired files).");
    return importEnvelope(envelopeFile.json as Record<string, unknown>, actorId);
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
