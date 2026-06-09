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
    execFile(file, args, (err, stdout, stderr) => {
      const code = err ? ((err as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0;
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code });
    });
  });
}

const HARNESS_PATH = path.resolve(__dirname, "../../../../import/validate_import.py");
const SCHEMA_DIR = path.resolve(__dirname, "../../../../import");

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
    docType: envelope.doc_type,
    subject: envelope.subject,
    classLevel: envelope.class_level,
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
